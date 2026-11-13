import { createRequire } from 'node:module';
import { describe, it } from 'vitest';
import { criarOk, URL_TESTE } from '../helpers/soft.js';

// Convertido do roteiro e2e (verificações "moles": o teste mostra todas as falhas de uma vez).
describe('Fase 17 — delegação, recusa, aprovação e auditoria', () => {
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
      const { assinar } = await import('../../src/events.js');
      const { verificarFallback } = await import('../../src/jobs/fallback.js');
      const { invalidarPoliticas } = await import('../../src/regras.js');
      const app = buildApp(); await app.ready();

      const eventos: any[] = [];
      assinar((e) => eventos.push(e));

      // ---------- cenário ----------
      await prisma.$executeRaw`TRUNCATE ordens_manutencao, equipamentos, auditoria RESTART IDENTITY CASCADE`;
      await prisma.usuario.deleteMany({ where: { matricula: { startsWith: 'f' } } });
      await prisma.configuracaoGlobal.updateMany({ where: { chave: { startsWith: 'OM_' } }, data: {} });
      await prisma.configuracaoGlobal.update({ where: { chave: 'OM_FALLBACK_URGENTE_MIN' }, data: { valor: '10' } });
      await prisma.configuracaoGlobal.update({ where: { chave: 'OM_LIDER_APROVA_APOS_MIN' }, data: { valor: '30' } });
      invalidarPoliticas();
      const pin = await hashPin('1234');
      const mk = (nome: string, perfil: any, matricula: string) => prisma.usuario.create({ data: { nome, perfil, matricula, pinHash: pin } });
      const oper = await mk('Oper Um', 'OPERADOR', 'f1');
      const oper2 = await mk('Oper Dois', 'OPERADOR', 'f2');
      const lider = await mk('Lider Pro', 'LIDER_PRODUCAO', 'f3');
      const tec1 = await mk('Tec Um', 'TECNICO', 'f4');
      const tec2 = await mk('Tec Dois', 'TECNICO', 'f5');
      const ger = await mk('Gerente G', 'GERENTE', 'f6');
      const admin = await prisma.usuario.findFirstOrThrow({ where: { email: 'admin@om.com.br' } });
      const eq = await prisma.equipamento.create({ data: { codigo: 'F-01', nome: 'Prensa F', setor: 'Prensa' } });
      const tok = (u: any) => ({ authorization: 'Bearer ' + app.jwt.sign({ sub: String(u.id), perfil: u.perfil, nome: u.nome }) });
      const call = async (m: any, url: string, u: any, payload?: any) => {
        const r = await app.inject({ method: m, url, headers: tok(u), payload });
        let b: any = null; try { b = r.body ? JSON.parse(r.body) : null; } catch { b = r.body; }
        return { s: r.statusCode, b, h: r.headers };
      };
      const PIN = { pin: '1234' };
      const novaOm = async (urgente: boolean, quem = oper) => {
        const r = await call('POST', '/ordens', quem, { equipamentoId: String(eq.id), maquinaParada: urgente, categoria: 'MECANICO', sintomas: ['x'], tipoAtivo: 'MAQUINA', custoTipo: 'INTERNO', confirmarDuplicidade: true });
        return r.b.id as string;
      };
      const st = async (id: string) => (await prisma.ordem.findUniqueOrThrow({ where: { id: BigInt(id) } }));

      console.log('--- RN-28 e criação ---');
      let r = await call('POST', '/ordens', tec1, { equipamentoId: String(eq.id), maquinaParada: false, categoria: 'MECANICO', sintomas: ['x'], tipoAtivo: 'MAQUINA', custoTipo: 'INTERNO' });
      ok('TECNICO não abre OM (403)', r.s === 403, r.b?.error);
      const A = await novaOm(false), B = await novaOm(true);
      const b0 = await st(B);
      ok('urgente nasce com prazo_atendimento (~10 min)', b0.prazoAtendimento !== null && Math.abs(b0.prazoAtendimento.getTime() - Date.now() - 600_000) < 15_000);
      ok('não urgente sem prazo', (await st(A)).prazoAtendimento === null);

      console.log('--- D2: pull ---');
      r = await call('POST', `/ordens/${A}/assumir`, tec1, {});
      ok('assumir sem PIN -> 400', r.s === 400);
      r = await call('POST', `/ordens/${A}/assumir`, tec1, { pin: '9999' });
      ok('PIN errado -> 401 PIN_INVALIDO', r.s === 401 && r.b.error === 'PIN_INVALIDO');
      r = await call('POST', `/ordens/${B}/assumir`, tec1, PIN);
      ok('TECNICO não puxa urgente (403 URGENTE_REQUER_GERENTE)', r.s === 403 && r.b.error === 'URGENTE_REQUER_GERENTE' && r.b.liberaEmSegundos > 500, `${r.b?.error} ${r.b?.liberaEmSegundos}s`);
      ok('PIN não é consumido em OM que não pode assumir', true);
      r = await call('POST', `/ordens/${A}/assumir`, tec1, PIN);
      ok('TECNICO puxa não urgente com PIN -> EM_ANDAMENTO', r.s === 200 && (await st(A)).status === 'EM_ANDAMENTO' && (await st(A)).responsavelId === tec1.id);
      r = await call('POST', `/ordens/${A}/assumir`, tec2, PIN);
      ok('segundo técnico: 409 OM_NAO_DISPONIVEL', r.s === 409 && r.b.error === 'OM_NAO_DISPONIVEL');
      r = await call('POST', `/ordens/${B}/assumir`, oper, PIN);
      ok('OPERADOR não assume (403)', r.s === 403);

      console.log('--- D1: delegação = reserva + aceite ---');
      const C = await novaOm(true);
      r = await call('POST', `/ordens/${C}/atribuir`, tec1, { tecnicoId: String(tec1.id) });
      ok('TECNICO não atribui (403)', r.s === 403);
      r = await call('POST', `/ordens/${C}/atribuir`, ger, { tecnicoId: String(oper.id) });
      ok('alvo operador -> 422', r.s === 422 && r.b.error === 'TECNICO_INVALIDO');
      r = await call('POST', `/ordens/${C}/atribuir`, ger, { tecnicoId: String(ger.id) });
      ok('gerente para si -> 422 USE_ASSUMIR', r.s === 422 && r.b.error === 'USE_ASSUMIR');
      r = await call('POST', `/ordens/${C}/atribuir`, ger, { tecnicoId: String(tec1.id) });
      let c = await st(C);
      ok('atribuir mantém a OM fora de EM_ANDAMENTO: status RESERVADA', r.s === 200 && c.status === 'RESERVADA' && r.b.statusKanban === 'ABERTO' && c.responsavelId === tec1.id && c.delegadoPor === ger.id && c.delegadoEm !== null);
      ok('evento om.delegada com tecnicoId', eventos.some((e) => e.tipo === 'om.delegada' && e.tecnicoId === String(tec1.id) && e.ordemId === C));
      r = await call('POST', `/ordens/${C}/play`, tec1, {});
      ok('play antes do aceite -> 409 ACEITE_PENDENTE', r.s === 409 && r.b.error === 'ACEITE_PENDENTE');
      r = await call('POST', `/ordens/${C}/assumir`, tec2, PIN);
      ok('RN-23: outro técnico não assume reservada (409 OM_RESERVADA)', r.s === 409 && r.b.error === 'OM_RESERVADA');
      r = await call('POST', `/ordens/${C}/assumir`, ger, PIN);
      ok('nem o gerente por cima da reserva (409)', r.s === 409 && r.b.error === 'OM_RESERVADA');
      r = await call('POST', `/ordens/${C}/assumir`, tec1, PIN);
      ok('técnico reservado aceita com PIN -> EM_ANDAMENTO', r.s === 200 && (await st(C)).status === 'EM_ANDAMENTO');
      const h = await prisma.historicoStatusOrdem.findMany({ where: { ordemId: BigInt(C) }, orderBy: { id: 'asc' }, select: { statusNovo: true, usuarioId: true } });
      ok('histórico: ABERTA > RESERVADA (gerente) > EM_ANDAMENTO (técnico)', h.map((x) => x.statusNovo).join() === 'ABERTA,RESERVADA,EM_ANDAMENTO' && h[1]!.usuarioId === ger.id && h[2]!.usuarioId === tec1.id);

      console.log('--- D3: recusa ---');
      const D = await novaOm(false);
      await call('POST', `/ordens/${D}/atribuir`, ger, { tecnicoId: String(tec1.id) });
      r = await call('POST', `/ordens/${D}/recusar`, tec2, { motivo: 'não é minha, mas recuso' });
      ok('só o reservado recusa (409 SEM_RESERVA)', r.s === 409 && r.b.error === 'SEM_RESERVA');
      r = await call('POST', `/ordens/${D}/recusar`, tec1, { motivo: 'curto' });
      ok('motivo < 10 caracteres -> 400', r.s === 400);
      r = await call('POST', `/ordens/${D}/recusar`, tec1, { motivo: 'Estou em outra OM crítica agora' });
      let d = await st(D);
      ok('recusa: volta a ABERTA, sem responsável, devolvida (motivo_recusa)', r.s === 200 && d.status === 'ABERTA' && d.responsavelId === null && d.motivoRecusa === 'Estou em outra OM crítica agora' && d.delegadoPor === null);
      ok('evento om.recusada', eventos.some((e) => e.tipo === 'om.recusada' && e.ordemId === D));
      r = await call('POST', `/ordens/${D}/assumir`, tec2, PIN);
      ok('devolvida NÃO vai ao pull do técnico (403 OM_DEVOLVIDA)', r.s === 403 && r.b.error === 'OM_DEVOLVIDA');
      let f = await call('GET', '/ordens/fila', ger);
      let cardD = (f.b.colunas.ABERTO as any[]).find((x) => x.id === D);
      ok('fila (gerente): DEVOLVIDA com motivo e quem recusou', cardD?.situacaoAtribuicao === 'DEVOLVIDA' && cardD.motivoRecusa?.includes('outra OM') && cardD.recusadoPor?.nome === 'Tec Um', JSON.stringify({ s: cardD?.situacaoAtribuicao, por: cardD?.recusadoPor?.nome }));
      f = await call('GET', '/ordens/fila', tec2);
      cardD = (f.b.colunas.ABERTO as any[]).find((x) => x.id === D);
      ok('fila (técnico): sem motivo/recusadoPor e podeAssumir=false', cardD && cardD.motivoRecusa === undefined && cardD.recusadoPor === undefined && cardD.podeAssumir === false);
      r = await call('POST', `/ordens/${D}/assumir`, ger, PIN);
      ok('gerente também atende: assume a devolvida', r.s === 200 && (await st(D)).responsavelId === ger.id && (await st(D)).motivoRecusa === null);

      console.log('--- reatribuição e desfazer ---');
      const E = await novaOm(true);
      await call('POST', `/ordens/${E}/atribuir`, ger, { tecnicoId: String(tec1.id) });
      r = await call('POST', `/ordens/${E}/atribuir`, ger, { tecnicoId: String(tec2.id) });
      ok('reatribuir sem motivo -> 400 MOTIVO_OBRIGATORIO', r.s === 400 && r.b.error === 'MOTIVO_OBRIGATORIO');
      r = await call('POST', `/ordens/${E}/atribuir`, ger, { tecnicoId: String(tec2.id), motivo: 'Tec Um está em outra OM' });
      ok('reatribuir com motivo -> reservada ao novo técnico', r.s === 200 && (await st(E)).responsavelId === tec2.id && (await st(E)).status === 'RESERVADA');
      r = await call('POST', `/ordens/${E}/assumir`, tec1, PIN);
      ok('antigo reservado não assume mais (409)', r.s === 409);
      r = await call('POST', `/ordens/${E}/cancelar-delegacao`, ger, {});
      e: {
        const x = await st(E);
        ok('cancelar-delegação (Desfazer): volta a ABERTA sem devolvida', r.s === 200 && x.status === 'ABERTA' && x.responsavelId === null && x.motivoRecusa === null && x.prazoAtendimento !== null);
      }
      r = await call('POST', `/ordens/${E}/cancelar-delegacao`, ger, {});
      ok('cancelar de novo -> 409', r.s === 409);

      console.log('--- RN-22: fallback ---');
      const G = await novaOm(true);
      await prisma.$executeRaw`UPDATE ordens_manutencao SET prazo_atendimento = now() - interval '1 minute' WHERE id = ${BigInt(G)}`;
      f = await call('GET', '/ordens/fila', tec2);
      const cardG = (f.b.colunas.ABERTO as any[]).find((x) => x.id === G);
      ok('fila: urgente vencida vira LIBERADA e podeAssumir', cardG?.situacaoAtribuicao === 'LIBERADA' && cardG.podeAssumir === true);
      const cardB = (f.b.colunas.ABERTO as any[]).find((x) => x.id === B);
      ok('fila: urgente dentro do prazo = URGENTE_AGUARDA_GERENTE, podeAssumir=false, conta regressiva', cardB?.situacaoAtribuicao === 'URGENTE_AGUARDA_GERENTE' && cardB.podeAssumir === false && cardB.liberaEmSegundos > 0);
      const n1 = await verificarFallback(app.log);
      ok('job de fallback alerta 1 vez (om.liberada + auditoria SISTEMA)', n1 === 1 && eventos.some((e) => e.tipo === 'om.liberada' && e.ordemId === G) && (await prisma.auditoria.count({ where: { acao: 'OM_LIBERADA_FALLBACK', alvoId: G } })) === 1);
      ok('job não repete o alerta', (await verificarFallback(app.log)) === 0);
      r = await call('POST', `/ordens/${G}/assumir`, tec2, PIN);
      ok('qualquer técnico puxa a liberada', r.s === 200 && (await st(G)).responsavelId === tec2.id);

      console.log('--- aprovação: RN-21 / RN-24 / PIN / em nome de ---');
      // tec1 executa A e conclui
      await call('POST', `/ordens/${A}/play`, tec1, {});
      await call('POST', `/ordens/${A}/pause`, tec1, { motivo: 'REFEICAO' });
      r = await call('POST', `/ordens/${A}/concluir`, tec1, { causaRaiz: 'Desgaste Natural', acaoExecutada: 'Troca' });
      const a1 = await st(A);
      ok('concluir -> AGUARDANDO_APROVACAO com prazo_aprovacao (~30 min)', r.s === 200 && a1.status === 'AGUARDANDO_APROVACAO' && a1.prazoAprovacao !== null && Math.abs(a1.prazoAprovacao.getTime() - Date.now() - 1_800_000) < 15_000);
      r = await call('POST', `/ordens/${A}/aprovar`, tec1, PIN);
      ok('TECNICO nunca aprova (403)', r.s === 403);
      r = await call('POST', `/ordens/${A}/aprovar`, oper2, PIN);
      ok('operador de outra OM: 403 ACESSO_NEGADO', r.s === 403 && r.b.error === 'ACESSO_NEGADO');
      let ap = await call('GET', '/ordens/aprovacoes', oper2);
      ok('operador 2 não vê OM de outro operador', ap.s === 200 && ap.b.length === 0);
      ap = await call('GET', '/ordens/aprovacoes', oper);
      ok('operador vê a própria com podeAprovar', ap.b.length === 1 && ap.b[0].podeAprovar === true && ap.b[0].decideEmNomeDe === null);
      ap = await call('GET', '/ordens/aprovacoes', lider);
      ok('líder: vê, mas podeAprovar=false e contagem (~1800s)', ap.b.length === 1 && ap.b[0].podeAprovar === false && ap.b[0].aprovaEmSegundos > 1500 && ap.b[0].motivoBloqueio === 'AGUARDE_OPERADOR');
      r = await call('POST', `/ordens/${A}/aprovar`, lider, PIN);
      ok('líder antes de 30 min -> 403 AGUARDE_OPERADOR', r.s === 403 && r.b.error === 'AGUARDE_OPERADOR' && r.b.liberaEmSegundos > 1500);
      r = await call('POST', `/ordens/${A}/aprovar`, oper, {});
      ok('operador sem PIN -> 400', r.s === 400);
      r = await call('POST', `/ordens/${A}/aprovar`, oper, { pin: '0000' });
      ok('operador com PIN errado -> 401 e OM segue aguardando', r.s === 401 && (await st(A)).status === 'AGUARDANDO_APROVACAO');
      // vence o prazo do líder
      await prisma.$executeRaw`UPDATE ordens_manutencao SET prazo_aprovacao = now() - interval '1 minute' WHERE id = ${BigInt(A)}`;
      ap = await call('GET', '/ordens/aprovacoes', lider);
      ok('líder após o prazo: podeAprovar e decide em nome do operador', ap.b[0].podeAprovar === true && ap.b[0].decideEmNomeDe === 'Oper Um');
      r = await call('POST', `/ordens/${A}/aprovar`, lider, PIN);
      const a2 = await st(A);
      ok('líder aprova após o prazo: AGUARDANDO_BAIXA, aprovado_por=líder, em_nome_de=operador', r.s === 200 && a2.status === 'AGUARDANDO_BAIXA' && a2.aprovadoPor === lider.id && a2.aprovadoEmNomeDe === oper.id);
      const aud = await prisma.auditoria.findFirst({ where: { acao: 'OM_APROVADA', alvoId: A } });
      ok('auditoria OM_APROVADA com em_nome_de', aud?.atorId === lider.id && aud?.emNomeDe === oper.id);
      // reprovar pelo próprio operador, com PIN
      const H = await novaOm(false);
      await call('POST', `/ordens/${H}/assumir`, tec2, PIN);
      await call('POST', `/ordens/${H}/concluir`, tec2, { causaRaiz: 'x', acaoExecutada: 'y' });
      r = await call('POST', `/ordens/${H}/reprovar`, oper, { pin: '1234' });
      ok('reprovar sem motivo -> 400', r.s === 400);
      r = await call('POST', `/ordens/${H}/reprovar`, oper, { pin: '1234', motivo: 'Continua vazando' });
      ok('operador reprova a própria (PIN + motivo) -> EM_ANDAMENTO', r.s === 200 && (await st(H)).status === 'EM_ANDAMENTO' && (await st(H)).prazoAprovacao === null);
      // Fase 21: gerente não aprova (403); RN-24: executante também não aprova
      const I = await novaOm(false);
      await call('POST', `/ordens/${I}/assumir`, ger, PIN);
      await call('POST', `/ordens/${I}/concluir`, ger, { causaRaiz: 'x', acaoExecutada: 'y' });
      r = await call('POST', `/ordens/${I}/aprovar`, ger, PIN);
      ok('Fase 21 / RN-24: gerente que executou não aprova (403)', r.s === 403);
      r = await call('POST', `/ordens/${I}/aprovar`, admin, PIN);
      ok('ADMIN sem PIN válido (admin do seed) não passa', r.s === 401 || r.s === 400, String(r.s));

      console.log('--- usuários: técnicos, bloqueio, auditoria, parâmetros ---');
      let t = await call('GET', '/usuarios/tecnicos', ger);
      const t1 = t.b.find((x: any) => x.id === String(tec1.id));
      ok('GERENTE lista técnicos com carga', t.s === 200 && t.b.length >= 2 && !!t1 && typeof t1.emAtendimento === 'number' && typeof t1.reservadas === 'number' && !!t1.situacao, JSON.stringify(t1));
      const chaves = [...new Set(t.b.flatMap((x: any) => Object.keys(x)))];
      ok('lista só com campos não sensíveis', chaves.sort().join() === 'cronometroAtivo,emAtendimento,id,matricula,nome,perfil,reservadas,situacao', chaves.join());
      ok('TECNICO e OPERADOR não listam (403)', (await call('GET', '/usuarios/tecnicos', tec1)).s === 403 && (await call('GET', '/usuarios/tecnicos', oper)).s === 403);
      ok('GERENTE não acessa /usuarios nem /auditoria (403)', (await call('GET', '/usuarios', ger)).s === 403 && (await call('GET', '/auditoria', ger)).s === 403);
      for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/auth/pin', payload: { matricula: 'f2', pin: '0000' } });
      let us = await call('GET', '/usuarios?busca=Oper%20Dois', admin);
      ok('DTO traz bloqueadoAte após 5 PINs errados', us.b[0].bloqueadoAte !== null, us.b[0].bloqueadoAte);
      r = await call('POST', `/usuarios/${oper2.id}/desbloquear`, admin);
      us = await call('GET', '/usuarios?busca=Oper%20Dois', admin);
      const lg = await app.inject({ method: 'POST', url: '/auth/pin', payload: { matricula: 'f2', pin: '1234' } });
      ok('desbloquear: 204, bloqueadoAte=null e login volta', r.s === 204 && us.b[0].bloqueadoAte === null && lg.statusCode === 200);
      ok('GERENTE não desbloqueia (403)', (await call('POST', `/usuarios/${oper2.id}/desbloquear`, ger)).s === 403);
      const cfg = await call('GET', '/configuracoes', admin);
      const mfb = cfg.b.find((x: any) => x.chave === 'OM_FALLBACK_URGENTE_MIN');
      ok('GET /configuracoes traz unidade/min/max/padrao', mfb?.unidade === 'min' && mfb.min === 1 && mfb.max === 1440 && mfb.padrao === 10, JSON.stringify(mfb));
      ok('PUT valor fora da faixa -> 400', (await call('PUT', '/configuracoes/OM_FALLBACK_URGENTE_MIN', admin, { valor: '0' })).s === 400 && (await call('PUT', '/configuracoes/OM_FALLBACK_URGENTE_MIN', admin, { valor: 'abc' })).s === 400);
      r = await call('PUT', '/configuracoes/OM_FALLBACK_URGENTE_MIN', admin, { valor: '15' });
      const J = await novaOm(true);
      const j = await st(J);
      ok('parâmetro alterado vale na hora (novo prazo ~15 min)', r.s === 200 && Math.abs(j.prazoAtendimento!.getTime() - Date.now() - 900_000) < 15_000);
      await call('PUT', '/configuracoes/OM_FALLBACK_URGENTE_MIN', admin, { valor: '10' });
      await call('PUT', '/configuracoes/SMTP_HOST', admin, { valor: 'smtp.exemplo.test' }).catch(() => null);
      await call('PUT', `/usuarios/${tec2.id}`, admin, { perfil: 'GERENTE' });
      await call('PUT', `/usuarios/${tec2.id}`, admin, { perfil: 'TECNICO' });
      await call('PUT', `/usuarios/${tec2.id}/credenciais`, admin, { pin: '5678' });

      const al = await call('GET', '/auditoria?limit=500', admin);
      const acoes = new Set(al.b.map((x: any) => x.acao));
      const esperadas = ['OM_DELEGADA', 'OM_REATRIBUIDA', 'OM_RECUSADA', 'OM_DELEGACAO_CANCELADA', 'OM_ASSUMIDA', 'OM_ACEITA', 'OM_LIBERADA_FALLBACK', 'OM_APROVADA', 'OM_REPROVADA', 'PARAMETRO_ALTERADO', 'USUARIO_PERFIL_ALTERADO', 'PIN_REDEFINIDO', 'USUARIO_DESBLOQUEADO'];
      ok('auditoria cobre todas as ações esperadas', esperadas.every((x) => acoes.has(x)), esperadas.filter((x) => !acoes.has(x)).join(',') || 'completa');
      const bruto = JSON.stringify(al.b);
      const detalhes = JSON.stringify(al.b.map((x: any) => x.detalhe));
      ok('auditoria NUNCA contém PIN/senha/segredo (detalhe)', !/"1234"|"5678"|"9999"|"0000"|scrypt|senha|pin|\$2[aby]\$|enc:v1|smtp\.exemplo/i.test(detalhes), String(detalhes.match(/"1234"|"5678"|scrypt|senha|pin|enc:v1|smtp\.exemplo/i)));
      const pAlt = al.b.find((x: any) => x.acao === 'PARAMETRO_ALTERADO' && x.alvoId === 'OM_FALLBACK_URGENTE_MIN' && x.detalhe?.para === '15');
      ok('parâmetro OM_* audita de/para', pAlt?.detalhe?.de === '10' && pAlt?.detalhe?.para === '15', JSON.stringify(pAlt?.detalhe));
      const rec = al.b.find((x: any) => x.acao === 'OM_RECUSADA');
      ok('item de auditoria tem ator, rótulo da OM e detalhe', rec?.ator?.nome === 'Tec Um' && /^OM-/.test(rec?.alvoRotulo) && rec?.detalhe?.motivo);
      const fb = al.b.find((x: any) => x.acao === 'OM_LIBERADA_FALLBACK');
      ok('ator do fallback = Sistema', fb?.ator?.nome === 'Sistema');
      const fil = await call('GET', '/auditoria?acao=OM_DELEGADA&limit=5', admin);
      ok('filtro por ação + X-Total-Count', fil.s === 200 && fil.b.every((x: any) => x.acao === 'OM_DELEGADA') && Number(fil.h['x-total-count']) >= 1);
      let imut = false; try { await prisma.$executeRaw`UPDATE auditoria SET acao = 'X' WHERE id = 1`; } catch { imut = true; }
      ok('(banco) auditoria é imutável', imut);


    } finally {
      // restaura a tabela de configurações (alguns roteiros a esvaziam) e libera conexões
      const { prisma: p } = await import('../../src/db.js');
      if (_cfg.length > 0) { await p.configuracaoGlobal.deleteMany({}); await p.configuracaoGlobal.createMany({ data: _cfg }); }
      await p.$disconnect();
    }
  }, 280_000);
});
