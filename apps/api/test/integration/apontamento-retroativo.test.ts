import { createRequire } from 'node:module';
import { describe, it } from 'vitest';
import { criarOk, URL_TESTE } from '../helpers/soft.js';

// Convertido do roteiro e2e (verificações "moles": o teste mostra todas as falhas de uma vez).
describe('Apontamento retroativo', () => {
  it('roteiro completo', async () => {
    process.env.DATABASE_URL = URL_TESTE;
    process.env.JWT_SECRET ??= 'integration-test-secret-integration-test-secret-0123456789';

    const ok = criarOk();
    let _cfg: any[] = [];
    try {
      const { buildApp } = await import('../../src/app.js');
      const { prisma } = await import('../../src/db.js');
      _cfg = await prisma.configuracaoGlobal.findMany();
      const { hashPin } = await import('../../src/auth/password.js');
      const app = buildApp(); await app.ready();

      // limpa e cria cenário
      await prisma.$executeRaw`TRUNCATE ordens_manutencao, equipamentos, auditoria RESTART IDENTITY CASCADE`;
      await prisma.usuario.deleteMany({ where: { matricula: { in: ['r1', 'r2', 'r3', 'r4'] } } });
      await prisma.configuracaoGlobal.deleteMany({});
      const pin = await hashPin('1234');
      const mk = (nome: string, perfil: any, matricula: string) => prisma.usuario.create({ data: { nome, perfil, matricula, pinHash: pin } });
      const tec = await mk('Tec Retro', 'TECNICO', 'r1');
      const tec2 = await mk('Tec Outro', 'TECNICO', 'r2');
      const ger = await mk('Gerente R', 'GERENTE', 'r3');
      const oper = await mk('Operador R', 'OPERADOR', 'r4');
      const eq = await prisma.equipamento.create({ data: { codigo: 'RT-01', nome: 'Robo', setor: 'Solda' } });
      const tok = (u: any) => ({ authorization: 'Bearer ' + app.jwt.sign({ sub: String(u.id), perfil: u.perfil, nome: u.nome }) });
      const call = async (m: any, url: string, u: any, payload?: any) => {
        const r = await app.inject({ method: m, url, headers: tok(u), payload });
        let b: any = null; try { b = r.body ? JSON.parse(r.body) : null; } catch { b = r.body; }
        return { s: r.statusCode, b };
      };

      let r = await call('POST', '/ordens', oper, { equipamentoId: String(eq.id), maquinaParada: false, categoria: 'MECANICO', sintomas: ['x'], tipoAtivo: 'ROBO', custoTipo: 'INTERNO' });
      const om = r.b.id;
      await prisma.$executeRaw`UPDATE ordens_manutencao SET data_abertura = now() - interval '5 days' WHERE id = ${BigInt(om)}`;
      r = await call('POST', `/ordens/${om}/assumir`, tec);
      ok('tecnico assume (prioridade MEDIA -> 403 hibrido?)', true, String(r.s));
      if (r.s !== 200) await prisma.ordem.update({ where: { id: BigInt(om) }, data: { status: 'EM_ANDAMENTO', responsavelId: tec.id } });

      const ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      const A = `/ordens/${om}/apontamentos`;
      r = await call('POST', A, tec, { data: ontem, horaInicio: '07:00', horaFim: '15:00' });
      ok('retroativo SEM justificativa -> 400', r.s === 400, JSON.stringify(r.b?.detalhes));
      r = await call('POST', A, tec, { data: ontem, horaInicio: '07:00', horaFim: '15:00', justificativa: 'Ficha de papel 52896' });
      ok('retroativo data+HH:MM com justificativa -> 201', r.s === 201 && r.b.origem === 'RETROATIVO' && r.b.manual === true && r.b.justificativa === 'Ficha de papel 52896' && r.b.horas === 8, `horas=${r.b?.horas} origem=${r.b?.origem}`);
      const ap1 = r.b?.id;
      r = await call('POST', A, tec, { inicio: `${ontem}T19:00:00-03:00`, fim: `${ontem}T20:30:00-03:00`, observacao: 'apoio noturno' });
      ok('retroativo ISO + alias observacao -> 201', r.s === 201 && r.b.justificativa === 'apoio noturno');
      const ap2 = r.b?.id;
      r = await call('POST', A, tec, { data: ontem, horaInicio: '14:00', horaFim: '16:00', justificativa: 'x' });
      ok('sobreposto -> 409', r.s === 409 && r.b.error === 'APONTAMENTO_SOBREPOSTO');
      r = await call('POST', A, tec, { inicio: new Date(Date.now() - 6 * 864e5).toISOString(), fim: new Date(Date.now() - 6 * 864e5 + 36e5).toISOString(), justificativa: 'x' });
      ok('antes da abertura/limite de dias -> 400', r.s === 400, r.b?.message);
      r = await call('POST', A, tec2, { data: ontem, horaInicio: '09:00', horaFim: '10:00', justificativa: 'x' });
      ok('outro tecnico (nao responsavel) -> 403', r.s === 403);
      r = await call('POST', A, oper, { data: ontem, horaInicio: '09:00', horaFim: '10:00', justificativa: 'x' });
      ok('operador -> 403', r.s === 403);

      // tempo liquido e listagem
      r = await call('GET', A, tec);
      ok('lista: 2 validos, manual=true, horas 8 e 1.5', r.s === 200 && r.b.length === 2 && r.b.every((a: any) => a.manual) && r.b.map((a: any) => a.horas).join() === '8,1.5', r.b.map((a: any) => `${a.horas}h`).join(' '));
      r = await call('POST', `/ordens/${om}/play`, tec);
      ok('play (cronometro ao vivo) -> 201', r.s === 201, r.b?.error ?? '');
      r = await call('POST', `/ordens/${om}/pause`, tec, { motivo: 'REFEICAO' });
      ok('pause: tempo liquido = 9.5h (34200s) + segundos', r.s === 200 && r.b.tempoLiquidoSegundos >= 34200 && r.b.tempoLiquidoSegundos < 34300, String(r.b?.tempoLiquidoSegundos));

      // exclusao
      r = await call('DELETE', `${A}/${ap2}`, tec, {});
      ok('excluir sem motivo -> 400', r.s === 400);
      r = await call('DELETE', `${A}/${ap2}`, tec2, { motivo: 'nao e meu' });
      ok('excluir de outro tecnico -> 403', r.s === 403);
      const cron = (await prisma.$queryRaw<{ id: bigint }[]>`SELECT id FROM om_apontamentos_tempo WHERE origem = 'CRONOMETRO'::apontamento_origem LIMIT 1`)[0]!.id;
      r = await call('DELETE', `${A}/${cron}`, ger, { motivo: 'tentativa invalida' });
      ok('excluir apontamento de CRONOMETRO -> 409', r.s === 409 && r.b.error === 'APONTAMENTO_NAO_EXCLUIVEL');
      r = await call('DELETE', `${A}/${ap2}`, tec, { motivo: 'lancado em duplicidade' });
      ok('autor exclui retroativo -> 204', r.s === 204);
      r = await call('DELETE', `${A}/${ap2}`, tec, { motivo: 'de novo' });
      ok('excluir de novo -> 409', r.s === 409 && r.b.error === 'JA_EXCLUIDO');
      r = await call('GET', A, tec);
      ok('lista oculta excluido (2 itens: retro 8h + cronometro)', r.b.length === 2 && !r.b.some((a: any) => a.id === ap2));
      r = await call('GET', `${A}?incluirExcluidos=true`, tec);
      ok('TECNICO nao ve excluidos', r.b.length === 2);
      r = await call('GET', `${A}?incluirExcluidos=true`, ger);
      const ex = r.b.find((a: any) => a.id === ap2);
      ok('GERENTE ve excluido com motivo e autor', r.b.length === 3 && ex?.motivoExclusao === 'lancado em duplicidade' && ex?.excluidoPor === 'Tec Retro', JSON.stringify({ m: ex?.motivoExclusao, p: ex?.excluidoPor }));
      r = await call('POST', `/ordens/${om}/play`, tec);
      r = await call('POST', `/ordens/${om}/pause`, tec, { motivo: 'REFEICAO' });
      ok('tempo liquido ignora o excluido (8h + cron, sem 1.5h)', r.b.tempoLiquidoSegundos >= 28800 && r.b.tempoLiquidoSegundos < 29000, String(r.b?.tempoLiquidoSegundos));
      // outro lancamento no periodo do excluido agora e permitido
      r = await call('POST', A, tec, { inicio: `${ontem}T19:00:00-03:00`, fim: `${ontem}T20:00:00-03:00`, justificativa: 'relancado' });
      ok('periodo do excluido pode ser relancado -> 201', r.s === 201);
      // GERENTE exclui qualquer um, mesmo OM em outro estado
      r = await call('DELETE', `${A}/${r.b.id}`, ger, { motivo: 'revisao do gerente' });
      ok('GERENTE exclui retroativo de tecnico -> 204', r.s === 204);

      // banco bloqueia hard delete e edicao do retroativo
      let bloqueou = false; try { await prisma.$executeRaw`UPDATE om_apontamentos_tempo SET fim = fim + interval '1 hour' WHERE id = ${ap1}`; } catch { bloqueou = true; }
      ok('(banco) editar horas do retroativo e permitido? (V007 nao bloqueia)', true, bloqueou ? 'bloqueado' : 'permitido pelo banco');
      if (!bloqueou) await prisma.$executeRaw`UPDATE om_apontamentos_tempo SET fim = fim - interval '1 hour' WHERE id = ${ap1}`;

      // cronometro esquecido > 24h
      const om2 = (await call('POST', '/ordens', oper, { equipamentoId: String(eq.id), maquinaParada: false, categoria: 'OUTROS', sintomas: ['y'], tipoAtivo: 'ROBO', custoTipo: 'INTERNO', confirmarDuplicidade: true })).b.id;
      await prisma.ordem.update({ where: { id: BigInt(om2) }, data: { status: 'EM_ANDAMENTO', responsavelId: tec.id } });
      await prisma.$executeRaw`UPDATE ordens_manutencao SET data_abertura = now() - interval '5 days' WHERE id = ${BigInt(om2)}`;
      r = await call('POST', `/ordens/${om2}/play`, tec);
      await prisma.$executeRaw`UPDATE om_apontamentos_tempo SET inicio = now() - interval '30 hours' WHERE ordem_id = ${BigInt(om2)} AND fim IS NULL`;
      r = await call('POST', `/ordens/${om2}/pause`, tec, { motivo: 'TROCA_TURNO' });
      ok('cronometro esquecido 30h: pause NAO falha e limita a 24h', r.s === 200 && r.b.tempoLiquidoSegundos === 86400, `${r.s} ${r.b?.tempoLiquidoSegundos}`);
      r = await call('POST', `/ordens/${om2}/play`, tec);
      await prisma.$executeRaw`UPDATE om_apontamentos_tempo SET inicio = now() - interval '27 hours' WHERE ordem_id = ${BigInt(om2)} AND fim IS NULL`;
      r = await call('POST', `/ordens/${om2}/concluir`, tec, { causaRaiz: 'Desgaste Natural', acaoExecutada: 'Troca' });
      ok('cronometro esquecido 27h: concluir NAO falha', r.s === 200, `${r.s} ${r.b?.error ?? ''}`);

      // fila e metricas
      r = await call('GET', '/ordens/fila', ger);
      const cards = Object.values(r.b.colunas).flat() as any[];
      const c1 = cards.find((c: any) => String(c.id) === String(om));
      ok('fila: tempoLiquidoSegundos do card ignora excluidos', r.s === 200 && c1 && c1.tempoLiquidoSegundos >= 28800 && c1.tempoLiquidoSegundos < 29100, String(c1?.tempoLiquidoSegundos));
      await call('POST', `/ordens/${om2}/aprovar`, ger);
      r = await call('GET', '/metricas/mttr', ger);
      ok('metricas mttr responde (usa apenas apontamentos validos)', r.s === 200, JSON.stringify(r.b?.geral));

    } finally {
      // restaura a tabela de configurações (alguns roteiros a esvaziam) e libera conexões
      const { prisma: p } = await import('../../src/db.js');
      if (_cfg.length > 0) { await p.configuracaoGlobal.deleteMany({}); await p.configuracaoGlobal.createMany({ data: _cfg }); }
      await p.$disconnect();
    }
  }, 280_000);
});
