import { createRequire } from 'node:module';
import { describe, it } from 'vitest';
import { criarOk, URL_TESTE } from '../helpers/soft.js';

// Convertido do roteiro e2e (verificações "moles": o teste mostra todas as falhas de uma vez).
describe('Fase 17 etapa 2 — tema, fila, aprovações', () => {
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


      await prisma.$executeRaw`TRUNCATE ordens_manutencao, equipamentos, auditoria RESTART IDENTITY CASCADE`;
      await prisma.usuario.deleteMany({ where: { matricula: { startsWith: 'g' } } });
      for (const [chave, valor] of [['TEMA_TOTEM_MODO', 'AUTO'], ['TEMA_TOTEM_ESCURO_INICIO', '18:00'], ['TEMA_TOTEM_ESCURO_FIM', '06:00']]) {
        await prisma.configuracaoGlobal.update({ where: { chave: chave! }, data: { valor: valor! } });
      }
      const pin = await hashPin('1234');
      const mk = (nome: string, perfil: any, matricula: string) => prisma.usuario.create({ data: { nome, perfil, matricula, pinHash: pin } });
      const oper = await mk('Oper G1', 'OPERADOR', 'g1');
      const lider = await mk('Lider G2', 'LIDER_PRODUCAO', 'g2');
      const tec1 = await mk('Tec G3', 'TECNICO', 'g3');
      const tec2 = await mk('Tec G4', 'TECNICO', 'g4');
      const ger = await mk('Gerente G5', 'GERENTE', 'g5');
      const admin = await prisma.usuario.findFirstOrThrow({ where: { email: 'admin@om.com.br' } });
      const eq = await prisma.equipamento.create({ data: { codigo: 'G-01', nome: 'Maq G', setor: 'Unico' } });
      await prisma.equipamento.create({ data: { codigo: 'G-02', nome: 'Maq G2', setor: 'Unico' } });
      await prisma.equipamento.create({ data: { codigo: 'G-03', nome: 'Maq G3 inativa', setor: 'Outro', status: 'INATIVO' } });
      const tok = (u: any) => ({ authorization: 'Bearer ' + app.jwt.sign({ sub: String(u.id), perfil: u.perfil, nome: u.nome }) });
      const call = async (m: any, url: string, u: any | null, payload?: any) => {
        const r = await app.inject({ method: m, url, headers: u ? tok(u) : {}, payload });
        let b: any = null; try { b = r.body ? JSON.parse(r.body) : null; } catch { b = r.body; }
        return { s: r.statusCode, b, h: r.headers };
      };
      const PIN = { pin: '1234' };
      const novaOm = async (urgente: boolean, categoria = 'MECANICO') =>
        (await call('POST', '/ordens', oper, { equipamentoId: String(eq.id), maquinaParada: urgente, categoria, sintomas: ['x'], tipoAtivo: 'MAQUINA', custoTipo: 'INTERNO', confirmarDuplicidade: true })).b.id as string;

      console.log('--- 2) GET /config/publica ---');
      let r = await call('GET', '/config/publica', null);
      ok('sem autenticação responde 200', r.s === 200);
      ok('campos exatos: temaModo, escuroInicio, escuroFim, setoresCount (+fuso)', Object.keys(r.b).sort().join() === 'escuroFim,escuroInicio,fuso,setoresCount,temaModo', Object.keys(r.b).join());
      ok('padrões AUTO / 18:00 / 06:00', r.b.temaModo === 'AUTO' && r.b.escuroInicio === '18:00' && r.b.escuroFim === '06:00');
      ok('setoresCount = setores de equipamentos ATIVOS (inativos não contam)', r.b.setoresCount === 1, String(r.b.setoresCount));
      ok('sem segredos (nada de SMTP/senha/PIN)', !/smtp|senha|pin|token|segredo/i.test(JSON.stringify(r.b)));
      ok('Cache-Control: no-store', String(r.h['cache-control']).includes('no-store'));
      r = await call('PUT', '/configuracoes/TEMA_TOTEM_MODO', admin, { valor: 'ROXO' });
      ok('modo inválido -> 400', r.s === 400 && r.b.error === 'VALOR_INVALIDO');
      r = await call('PUT', '/configuracoes/TEMA_TOTEM_ESCURO_INICIO', admin, { valor: '25:00' });
      ok('horário inválido -> 400', r.s === 400);
      r = await call('PUT', '/configuracoes/TEMA_TOTEM_ESCURO_INICIO', admin, { valor: '06:00' });
      ok('início = fim -> 400', r.s === 400 && /iguais/.test(r.b.message));
      ok('GERENTE não altera parâmetro (403)', (await call('PUT', '/configuracoes/TEMA_TOTEM_MODO', ger, { valor: 'ESCURO' })).s === 403);
      r = await call('PUT', '/configuracoes/TEMA_TOTEM_MODO', admin, { valor: 'HORARIO' });
      await call('PUT', '/configuracoes/TEMA_TOTEM_ESCURO_INICIO', admin, { valor: '19:30' });
      r = await call('GET', '/config/publica', null);
      ok('alteração aparece na hora (cache invalidado)', r.b.temaModo === 'HORARIO' && r.b.escuroInicio === '19:30');
      const cfg = await call('GET', '/configuracoes', admin);
      const mm = cfg.b.find((x: any) => x.chave === 'TEMA_TOTEM_MODO'), mi = cfg.b.find((x: any) => x.chave === 'TEMA_TOTEM_ESCURO_INICIO');
      ok('GET /configuracoes traz opcoes/formato do tema', mm?.opcoes?.join() === 'AUTO,CLARO,ESCURO,HORARIO' && mi?.formato === 'HH:mm' && mm.grupo === 'TEMA');
      await prisma.configuracaoGlobal.update({ where: { chave: 'TEMA_TOTEM_MODO' }, data: { valor: 'XYZ' } });
      (await import('../../src/routes/publico.js')).invalidarConfigPublica();
      r = await call('GET', '/config/publica', null);
      ok('valor inválido no banco cai no padrão (AUTO)', r.b.temaModo === 'AUTO');
      await prisma.configuracaoGlobal.update({ where: { chave: 'TEMA_TOTEM_MODO' }, data: { valor: 'AUTO' } });
      (await import('../../src/routes/publico.js')).invalidarConfigPublica();

      console.log('--- 3) GET /ordens com responsavel/reservadoPara ---');
      const A = await novaOm(true), B = await novaOm(false);
      await call('POST', `/ordens/${A}/atribuir`, ger, { tecnicoId: String(tec1.id) });
      let l = await call('GET', '/ordens?limit=50', ger);
      let a = l.b.find((x: any) => x.id === A);
      ok('RESERVADA: reservadoPara + reservadoEm + delegadoPor, responsavel=null', a.status === 'RESERVADA' && a.reservadoPara?.nome === 'Tec G3' && !!a.reservadoEm && a.delegadoPor?.nome === 'Gerente G5' && a.responsavel === null, JSON.stringify({ rp: a.reservadoPara, resp: a.responsavel }));
      await call('POST', `/ordens/${A}/assumir`, tec1, PIN);
      l = await call('GET', '/ordens?limit=50', ger); a = l.b.find((x: any) => x.id === A);
      ok('após aceite: responsavel preenchido, reservadoPara=null', a.status === 'EM_ANDAMENTO' && a.responsavel?.nome === 'Tec G3' && a.reservadoPara === null);
      const b1 = l.b.find((x: any) => x.id === B);
      ok('ABERTA sem dono: responsavel e reservadoPara nulos, devolvida=false', b1.responsavel === null && b1.reservadoPara === null && b1.devolvida === false);
      l = await call('GET', `/ordens?equipamentoId=${eq.id}`, oper);
      ok('OPERADOR (totem) não recebe responsavel/reservadoPara', l.s === 200 && l.b.length >= 2 && l.b.every((x: any) => !('responsavel' in x) && !('reservadoPara' in x) && !('delegadoPor' in x)));
      l = await call('GET', `/ordens?equipamentoId=${eq.id}`, lider);
      ok('LIDER (totem) idem', l.b.every((x: any) => !('responsavel' in x)));

      console.log('--- 5) GET /ordens/devolvidas ---');
      const C = await novaOm(true), D = await novaOm(false);
      await call('POST', `/ordens/${C}/atribuir`, ger, { tecnicoId: String(tec2.id) });
      await call('POST', `/ordens/${D}/atribuir`, ger, { tecnicoId: String(tec2.id) });
      await call('POST', `/ordens/${D}/recusar`, tec2, { motivo: 'Fora do meu turno de trabalho' });
      await call('POST', `/ordens/${C}/recusar`, tec2, { motivo: 'Sem habilidade para este serviço' });
      r = await call('GET', '/ordens/devolvidas', ger);
      ok('GERENTE lista as 2 devolvidas, urgente primeiro', r.s === 200 && r.b.length === 2 && r.b[0].id === C && r.b[1].id === D, r.b.map((x: any) => x.numero).join(' '));
      const dv = r.b[0];
      ok('item: recusadoPor, recusadoEm, motivoRecusa, prioridade, equipamento', dv.recusadoPor?.nome === 'Tec G4' && !!dv.recusadoEm && dv.motivoRecusa === 'Sem habilidade para este serviço' && dv.prioridade === 'CRITICA' && dv.urgente === true && dv.equipamento?.codigo === 'G-01');
      ok('urgente tem liberaEmSegundos (~600); não urgente null', dv.liberaEmSegundos > 500 && dv.liberaEmSegundos <= 600 && r.b[1].liberaEmSegundos === null, `${dv.liberaEmSegundos}/${r.b[1].liberaEmSegundos}`);
      ok('TECNICO / OPERADOR não acessam (403)', (await call('GET', '/ordens/devolvidas', tec1)).s === 403 && (await call('GET', '/ordens/devolvidas', oper)).s === 403);
      await call('POST', `/ordens/${D}/assumir`, ger, PIN);
      r = await call('GET', '/ordens/devolvidas', ger);
      ok('após assumir/redelegar sai da lista', r.b.length === 1 && r.b[0].id === C);
      await call('POST', `/ordens/${C}/atribuir`, ger, { tecnicoId: String(tec1.id) });
      r = await call('GET', '/ordens/devolvidas', admin);
      ok('redelegada sai da lista (ADMIN também vê)', r.s === 200 && r.b.length === 0);

      console.log('--- 4) MTTR por categoria / prioridade / técnico ---');
      const concluir = async (urgente: boolean, categoria: string, tec: any) => {
        const id = await novaOm(urgente, categoria);
        if (urgente) await call('POST', `/ordens/${id}/atribuir`, ger, { tecnicoId: String(tec.id) });
        await call('POST', `/ordens/${id}/assumir`, tec, PIN);
        await call('POST', `/ordens/${id}/play`, tec, {});
        await call('POST', `/ordens/${id}/concluir`, tec, { causaRaiz: 'x', acaoExecutada: 'y' });
        const ap = await call('POST', `/ordens/${id}/aprovar`, oper, PIN);
        const enc = await call('POST', `/ordens/${id}/encerrar`, ger, { ...PIN, custoTipo: 'INTERNO' });
        return { id, ap: ap.s, enc: enc.s };
      };
      const f1 = await concluir(false, 'MECANICO', tec1);
      const f2 = await concluir(false, 'ELETRICO', tec1);
      const f3 = await concluir(true, 'MECANICO', tec2);
      ok('3 OMs concluídas, aprovadas e encerradas', f1.ap === 200 && f1.enc === 200 && f2.ap === 200 && f2.enc === 200 && f3.ap === 200 && f3.enc === 200, `${f1.ap}/${f2.ap}/${f3.ap}`);
      await prisma.$executeRaw`UPDATE ordens_manutencao SET data_abertura = now() - interval '3 hours' WHERE id = ${BigInt(f1.id)}`;
      r = await call('GET', '/metricas/mttr', ger);
      const m = r.b;
      const campos = ['ordensConcluidas', 'mttrLiquidoSegundos', 'mttrTotalSegundos'];
      const temCampos = (arr: any[]) => arr.every((x) => campos.every((c) => c in x));
      ok('GERENTE acessa /metricas/mttr (200)', r.s === 200);
      ok('porCategoria: MECANICO=2, ELETRICO=1', temCampos(m.porCategoria) && m.porCategoria.find((x: any) => x.categoria === 'MECANICO')?.ordensConcluidas === 2 && m.porCategoria.find((x: any) => x.categoria === 'ELETRICO')?.ordensConcluidas === 1, JSON.stringify(m.porCategoria.map((x: any) => [x.categoria, x.ordensConcluidas])));
      ok('porPrioridade em ordem ordinal (MEDIA antes de CRITICA)', temCampos(m.porPrioridade) && m.porPrioridade.map((x: any) => x.prioridade).join() === 'MEDIA,CRITICA' && m.porPrioridade[0].ordensConcluidas === 2, JSON.stringify(m.porPrioridade.map((x: any) => [x.prioridade, x.ordensConcluidas])));
      ok('porTecnico: Tec G3=2, Tec G4=1, com id e nome', temCampos(m.porTecnico) && m.porTecnico.find((x: any) => x.tecnico === 'Tec G3')?.ordensConcluidas === 2 && m.porTecnico.find((x: any) => x.tecnico === 'Tec G4')?.ordensConcluidas === 1 && m.porTecnico.every((x: any) => x.tecnicoId), JSON.stringify(m.porTecnico.map((x: any) => [x.tecnico, x.ordensConcluidas])));
      const soma = (arr: any[]) => arr.reduce((t, x) => t + x.ordensConcluidas, 0);
      ok('somas por dimensão = geral (3)', m.geral.ordensConcluidas === 3 && soma(m.porCategoria) === 3 && soma(m.porPrioridade) === 3 && soma(m.porTecnico) === 3 && soma(m.porSetor) === 3);
      ok('mantém serie, porSetor e geral', Array.isArray(m.serie) && m.serie.length >= 1 && m.porSetor[0]?.setor === 'Unico');
      ok('mttrTotal da OM aberta há 3h reflete no porCategoria MECANICO (> 1h)', m.porCategoria.find((x: any) => x.categoria === 'MECANICO').mttrTotalSegundos > 3600);
      ok('porTecnico ordenado do pior para o melhor (mttrTotal desc)', m.porTecnico[0].mttrTotalSegundos >= m.porTecnico[m.porTecnico.length - 1].mttrTotalSegundos);
      ok('TECNICO não acessa métricas (403)', (await call('GET', '/metricas/mttr', tec1)).s === 403);
      r = await call('GET', '/metricas/mttr?setor=Inexistente', ger);
      ok('sem dados: listas vazias, geral zerado', r.s === 200 && r.b.porCategoria.length === 0 && r.b.porTecnico.length === 0 && r.b.geral.ordensConcluidas === 0);

      console.log('--- 1) aprovações: Líder global + liberaEm ---');
      const P = await novaOm(false, 'OUTROS');
      await call('POST', `/ordens/${P}/assumir`, tec1, PIN);
      await call('POST', `/ordens/${P}/concluir`, tec1, { causaRaiz: 'x', acaoExecutada: 'y' });
      const oper2 = await mk('Oper G6', 'OPERADOR', 'g6');
      const Q = (await call('POST', '/ordens', oper2, { equipamentoId: String(eq.id), maquinaParada: false, categoria: 'OUTROS', sintomas: ['z'], tipoAtivo: 'MAQUINA', custoTipo: 'INTERNO', confirmarDuplicidade: true })).b.id;
      await call('POST', `/ordens/${Q}/assumir`, tec2, PIN);
      await call('POST', `/ordens/${Q}/concluir`, tec2, { causaRaiz: 'x', acaoExecutada: 'y' });
      let ap = await call('GET', '/ordens/aprovacoes', lider);
      ok('líder vê TODAS (de operadores diferentes), sem filtro de equipe', ap.b.length === 2 && new Set(ap.b.map((x: any) => x.solicitante.id)).size === 2);
      ok('liberaEm (ISO ~30 min) e aprovaEmSegundos em cada item', ap.b.every((x: any) => typeof x.liberaEm === 'string' && Math.abs(new Date(x.liberaEm).getTime() - Date.now() - 1_800_000) < 20_000 && x.aprovaEmSegundos > 1700 && x.podeAprovar === false), ap.b[0]?.liberaEm);
      ap = await call('GET', '/ordens/aprovacoes', oper);
      ok('operador: só a própria, liberaEm=null, podeAprovar', ap.b.length === 1 && ap.b[0].liberaEm === null && ap.b[0].podeAprovar === true);
      ap = await call('GET', '/ordens/aprovacoes', ger);
      ok('gerente: não acessa aprovações (403); ADMIN vê todas', ap.s === 403 && (await call('GET', '/ordens/aprovacoes', admin)).b.length === 2);
      r = await call('POST', `/ordens/${P}/aprovar`, lider, PIN);
      ok('líder antes do prazo: 403 AGUARDE_OPERADOR', r.s === 403 && r.b.error === 'AGUARDE_OPERADOR');
      await prisma.$executeRaw`UPDATE ordens_manutencao SET prazo_aprovacao = now() - interval '1 minute' WHERE id = ${BigInt(P)}`;
      ap = await call('GET', '/ordens/aprovacoes', lider);
      const itP = ap.b.find((x: any) => x.id === P);
      ok('liberada: liberaEm no passado, podeAprovar e decideEmNomeDe', new Date(itP.liberaEm).getTime() < Date.now() && itP.podeAprovar === true && itP.decideEmNomeDe === 'Oper G1' && itP.aprovaEmSegundos === 0);
      r = await call('POST', `/ordens/${P}/aprovar`, lider, PIN);
      ok('líder aprova OM de qualquer operador após o prazo (global)', r.s === 200 && r.b.emNomeDe === String(oper.id));
      r = await call('POST', `/ordens/${Q}/aprovar`, oper, PIN);
      ok('operador não aprova OM de outro (403)', r.s === 403);
      r = await call('POST', `/ordens/${Q}/aprovar`, tec2, PIN);
      ok('RN-24/RBAC: técnico executante não aprova (403)', r.s === 403);


    } finally {
      // restaura a tabela de configurações (alguns roteiros a esvaziam) e libera conexões
      const { prisma: p } = await import('../../src/db.js');
      if (_cfg.length > 0) { await p.configuracaoGlobal.deleteMany({}); await p.configuracaoGlobal.createMany({ data: _cfg }); }
      await p.$disconnect();
    }
  }, 280_000);
});
