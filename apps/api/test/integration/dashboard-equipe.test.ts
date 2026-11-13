import { createRequire } from 'node:module';
import { describe, it } from 'vitest';
import { criarOk, URL_TESTE } from '../helpers/soft.js';

// Convertido do roteiro e2e (verificações "moles": o teste mostra todas as falhas de uma vez).
describe('Fase 18 — dashboard de equipe e métricas', () => {
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
      const { invalidarPoliticas } = await import('../../src/regras.js');
      const { limparCacheMetricas } = await import('../../src/metricas/filtros.js');
      const app = buildApp(); await app.ready();

      const perto = (a: number | null | undefined, b: number, tol = 0.11) => a !== null && a !== undefined && Math.abs(a - b) <= tol;

      // ---------- cenário ----------
      await prisma.$executeRaw`TRUNCATE ordens_manutencao, equipamentos, auditoria RESTART IDENTITY CASCADE`;
      await prisma.usuario.deleteMany({ where: { matricula: { startsWith: 'm' } } });
      for (const k of ['META_MTTA_MIN_CRITICA', 'META_MTTA_MIN_ALTA', 'META_MTTA_MIN_MEDIA', 'META_MTTA_MIN_BAIXA', 'META_MTTR_MIN']) {
        await prisma.configuracaoGlobal.update({ where: { chave: k }, data: { valor: null } });
      }
      invalidarPoliticas();
      const pin = await hashPin('1234');
      const mk = (nome: string, perfil: any, matricula: string) => prisma.usuario.create({ data: { nome, perfil, matricula, pinHash: pin } });
      const oper = await mk('Oper M', 'OPERADOR', 'm1');
      const ger = await mk('Gerente M', 'GERENTE', 'm2');
      const t1 = await mk('Tec T1', 'TECNICO', 'm3');
      const t2 = await mk('Tec T2', 'TECNICO', 'm4');
      const t3 = await mk('Tec T3', 'TECNICO', 'm5');
      const admin = await prisma.usuario.findFirstOrThrow({ where: { email: 'admin@om.com.br' } });
      const eq = await prisma.equipamento.create({ data: { codigo: 'M-01', nome: 'Maq M', setor: 'Unico' } });
      const tok = (u: any) => ({ authorization: 'Bearer ' + app.jwt.sign({ sub: String(u.id), perfil: u.perfil, nome: u.nome }) });
      const call = async (m: any, url: string, u: any, payload?: any) => {
        const r = await app.inject({ method: m, url, headers: tok(u), payload });
        let b: any = null; try { b = r.body ? JSON.parse(r.body) : null; } catch { b = r.body; }
        return { s: r.statusCode, b, h: r.headers };
      };
      const PIN = { pin: '1234' };
      const novaOm = async (urgente = false) =>
        (await call('POST', '/ordens', oper, { equipamentoId: String(eq.id), maquinaParada: urgente, categoria: 'MECANICO', sintomas: ['x'], tipoAtivo: 'MAQUINA', custoTipo: 'INTERNO', confirmarDuplicidade: true })).b.id as string;

      const agora = Date.now();
      const D = 86_400_000;
      interface C { prio: string; tec: any; mtta: number; liq: number; parada: number; diasAtras: number; reprov?: boolean }
      const concluida = async (o: C) => {
        const id = await novaOm();
        await call('POST', `/ordens/${id}/assumir`, o.tec, PIN);
        await call('POST', `/ordens/${id}/concluir`, o.tec, { causaRaiz: 'x', acaoExecutada: 'y' });
        if (o.reprov) {
          await call('POST', `/ordens/${id}/reprovar`, oper, { pin: '1234', motivo: 'refazer o serviço' });
          await call('POST', `/ordens/${id}/concluir`, o.tec, { causaRaiz: 'x', acaoExecutada: 'y' });
        }
        const ap = await call('POST', `/ordens/${id}/aprovar`, oper, PIN);
        if (ap.s !== 200) throw new Error('aprovar falhou ' + ap.s + JSON.stringify(ap.b));
        const enc = await call('POST', `/ordens/${id}/encerrar`, ger, { ...PIN, custoTipo: 'INTERNO' });
        if (enc.s !== 200) throw new Error('encerrar falhou ' + enc.s + JSON.stringify(enc.b));
        const conclusao = new Date(agora - o.diasAtras * D);
        const abertura = new Date(conclusao.getTime() - o.parada * 1000);
        const inicio = new Date(abertura.getTime() + o.mtta * 1000);
        const aprov = new Date(conclusao.getTime() + 600_000);
        await prisma.$executeRaw`UPDATE ordens_manutencao SET data_abertura = ${abertura}::timestamptz, data_inicio = ${inicio}::timestamptz,
            data_conclusao = ${conclusao}::timestamptz, data_aprovacao = ${aprov}::timestamptz, prioridade = ${o.prio}::prioridade_ordem, responsavel_id = ${o.tec.id} WHERE id = ${BigInt(id)}`;
        await prisma.$executeRaw`DELETE FROM om_apontamentos_tempo WHERE ordem_id = ${BigInt(id)}`;
        await prisma.$executeRaw`INSERT INTO om_apontamentos_tempo (ordem_id, tecnico_id, inicio, fim) VALUES (${BigInt(id)}, ${o.tec.id}, ${inicio}::timestamptz, ${new Date(inicio.getTime() + o.liq * 1000)}::timestamptz)`;
        // Histórico explícito (US-12 §2): MTTA = abertura->aceite; MTTR = aceite->conclusão MENOS o tempo fora do esforço ativo.
        const espera = o.parada - o.mtta - o.liq; // segundos em PAUSADA / AGUARDANDO_PECA / AGUARDANDO_APROVACAO
        const meio = new Date(inicio.getTime() + (o.liq / 2) * 1000), retomada = new Date(meio.getTime() + espera * 1000);
        const hist = async (ant: string | null, novo: string, quando: Date, usr: any) =>
          prisma.$executeRaw`INSERT INTO historico_status_ordem (ordem_id, status_anterior, status_novo, usuario_id, criado_em) VALUES (${BigInt(id)}, ${ant}::status_ordem, ${novo}::status_ordem, ${usr.id}, ${quando}::timestamptz)`;
        await prisma.$executeRaw`DELETE FROM historico_status_ordem WHERE ordem_id = ${BigInt(id)}`;
        await hist(null, 'ABERTA', abertura, oper);
        await hist('ABERTA', 'EM_ANDAMENTO', inicio, o.tec);
        const espStatus = o.reprov ? 'AGUARDANDO_APROVACAO' : (o.diasAtras % 3 === 0 ? 'AGUARDANDO_PECA' : 'PAUSADA');
        await hist('EM_ANDAMENTO', espStatus, meio, o.tec);
        await hist(espStatus, 'EM_ANDAMENTO', retomada, o.reprov ? oper : o.tec);
        await hist('EM_ANDAMENTO', 'AGUARDANDO_APROVACAO', conclusao, o.tec);
        await hist('AGUARDANDO_APROVACAO', 'CONCLUIDA', aprov, oper);
        return id;
      };

      // Período atual (últimos 10 dias): T1 = 6 OMs, T2 = 2 OMs. Anterior: 3 OMs de T1.
      const atual: C[] = [
        { prio: 'MEDIA', tec: t1, mtta: 600, liq: 3600, parada: 7200, diasAtras: 1, reprov: true },
        { prio: 'MEDIA', tec: t1, mtta: 1200, liq: 7200, parada: 9000, diasAtras: 2 },
        { prio: 'ALTA', tec: t1, mtta: 3000, liq: 1800, parada: 5400, diasAtras: 3 },
        { prio: 'CRITICA', tec: t1, mtta: 300, liq: 3000, parada: 3600, diasAtras: 4 },
        { prio: 'BAIXA', tec: t1, mtta: 9000, liq: 3600, parada: 18000, diasAtras: 5 },
        { prio: 'MEDIA', tec: t1, mtta: 1800, liq: 1800, parada: 5400, diasAtras: 6 },
        { prio: 'MEDIA', tec: t2, mtta: 900, liq: 1000, parada: 3000, diasAtras: 7, reprov: true },
        { prio: 'ALTA', tec: t2, mtta: 2700, liq: 2000, parada: 6000, diasAtras: 8 },
      ];
      const anterior: C[] = [
        { prio: 'MEDIA', tec: t1, mtta: 1200, liq: 3600, parada: 6000, diasAtras: 15 },
        { prio: 'MEDIA', tec: t1, mtta: 1200, liq: 3600, parada: 6000, diasAtras: 16 },
        { prio: 'MEDIA', tec: t1, mtta: 2400, liq: 3600, parada: 9000, diasAtras: 17 },
      ];
      for (const c of atual) await concluida(c);
      for (const c of anterior) await concluida(c);

      // Backlog / delegações (todas dentro do período atual)
      const D1 = await novaOm(), D2 = await novaOm(), D3 = await novaOm(), D4 = await novaOm();
      await call('POST', `/ordens/${D1}/atribuir`, ger, { tecnicoId: String(t1.id) });
      await call('POST', `/ordens/${D1}/assumir`, t1, PIN);               // aceita -> EM_ANDAMENTO
      await call('POST', `/ordens/${D1}/play`, t1, {});                    // cronômetro aberto (omAtual)
      await call('POST', `/ordens/${D2}/atribuir`, ger, { tecnicoId: String(t2.id) });
      await call('POST', `/ordens/${D2}/recusar`, t2, { motivo: 'Estou em outra OM agora mesmo' });
      await call('POST', `/ordens/${D3}/atribuir`, ger, { tecnicoId: String(t1.id) });
      await call('POST', `/ordens/${D3}/cancelar-delegacao`, ger, {});
      await call('POST', `/ordens/${D4}/atribuir`, ger, { tecnicoId: String(t2.id) });
      await call('POST', `/ordens/${D4}/atribuir`, ger, { tecnicoId: String(t3.id), motivo: 'Tec T2 está sobrecarregado' }); // reatribuída
      const A1 = await novaOm(true);                                       // CRITICA aberta
      const A2 = await novaOm();
      await prisma.$executeRaw`UPDATE ordens_manutencao SET data_abertura = now() - interval '5 hours', prioridade = 'BAIXA' WHERE id = ${BigInt(A2)}`;
      const P1 = await novaOm();
      await call('POST', `/ordens/${P1}/assumir`, ger, PIN);
      await call('POST', `/ordens/${P1}/play`, ger, {});
      await call('POST', `/ordens/${P1}/pause`, ger, { motivo: 'REFEICAO' });
      const AG1 = await novaOm();
      await call('POST', `/ordens/${AG1}/assumir`, t2, PIN);
      await call('POST', `/ordens/${AG1}/concluir`, t2, { causaRaiz: 'x', acaoExecutada: 'y' });
      await prisma.$executeRaw`UPDATE ordens_manutencao SET categoria = 'LEGADO' WHERE id = ${BigInt(A1)}`;
      limparCacheMetricas();

      const Q = (de: number, ate: number, extra = '') => `de=${new Date(agora - de * D).toISOString()}&ate=${new Date(agora + ate * 3600_000).toISOString()}${extra}`;
      const base = Q(10, 1);

      console.log('--- /metricas/kpis ---');
      let r = await call('GET', `/metricas/kpis?${base}&comparar=true`, ger);
      const k = r.b?.kpis;
      ok('GERENTE acessa (200) e período anterior de mesma duração', r.s === 200 && Math.abs((new Date(r.b.anterior.ate).getTime() - new Date(r.b.anterior.de).getTime()) - (new Date(r.b.periodo.ate).getTime() - new Date(r.b.periodo.de).getTime())) < 5);
      ok('concluídas = 8 (anterior 3, +166.7%)', k.concluidas.valor === 8 && k.concluidas.anterior === 3 && k.concluidas.variacaoPct === 166.7, JSON.stringify(k.concluidas).slice(0, 80));
      ok('MTTR (aceite→conclusão − pausas/espera) = 3000 s (24000/8); amostra 8', perto(k.mttrLiquidoSegundos.valor, 3000) && k.mttrLiquidoSegundos.amostra === 8, String(k.mttrLiquidoSegundos.valor));
      ok('MTTR líquido anterior = 3600 e variação −16.7%', perto(k.mttrLiquidoSegundos.anterior, 3600) && k.mttrLiquidoSegundos.variacaoPct === -16.7, `${k.mttrLiquidoSegundos.anterior} ${k.mttrLiquidoSegundos.variacaoPct}`);
      ok('MTTA = 2437.5 s; anterior 1600; +52.3%', perto(k.mttaSegundos.valor, 2437.5) && perto(k.mttaSegundos.anterior, 1600) && k.mttaSegundos.variacaoPct === 52.3, `${k.mttaSegundos.valor} ${k.mttaSegundos.variacaoPct}`);
      ok('Tempo de parada = 7200 s; anterior 7000', perto(k.tempoParadaSegundos.valor, 7200) && perto(k.tempoParadaSegundos.anterior, 7000));
      ok('Retrabalho = 18.2% (2 reprovações / 11 entradas); anterior 0.0; +18.2 pp', k.retrabalhoPct.valor === 18.2 && k.retrabalhoPct.base === 11 && k.retrabalhoPct.anterior === 0 && k.retrabalhoPct.variacaoPp === 18.2, JSON.stringify({ v: k.retrabalhoPct.valor, b: k.retrabalhoPct.base, a: k.retrabalhoPct.anterior }));
      ok('Recusa = 20.0% (1 recusa / 5 delegações, incl. reatribuição); anterior sem base = null', k.recusaPct.valor === 20 && k.recusaPct.base === 5 && k.recusaPct.anterior === null && k.recusaPct.variacaoPp === null, JSON.stringify(k.recusaPct).slice(0, 90));
      ok('backlog agora: 8 no total, 1 crítica', r.b.backlog.total === 8 && r.b.backlog.criticas === 1, JSON.stringify(r.b.backlog));
      ok('série curta: ≤ 30 pontos, mesmo tamanho em todos os KPIs', Object.values(k).every((x: any) => x.serie.length >= 10 && x.serie.length <= 30 && x.serie.length === k.concluidas.serie.length) && r.b.serieBucketDias === 1);
      ok('série de concluídas soma 8', k.concluidas.serie.reduce((t: number, x: number) => t + x, 0) === 8);
      ok('série do retrabalho tem ponto com 100% ou 0% (taxa por intervalo)', k.retrabalhoPct.serie.some((x: number | null) => x !== null));
      r = await call('GET', `/metricas/kpis?${base}`, ger);
      ok('comparar=false: anterior/variações nulos', r.b.anterior === null && r.b.kpis.concluidas.anterior === null && r.b.kpis.concluidas.variacaoPct === null && r.b.kpis.retrabalhoPct.variacaoPp === null);
      r = await call('GET', `/metricas/kpis?${Q(10, 1, `&tecnicoIds=${t2.id}`)}`, ger);
      ok('filtro tecnicoIds=T2: 2 concluídas, MTTR líq 1500, recusa 1/2 = 50%', r.b.kpis.concluidas.valor === 2 && perto(r.b.kpis.mttrLiquidoSegundos.valor, 1500) && r.b.kpis.recusaPct.valor === 50 && r.b.kpis.recusaPct.base === 2, JSON.stringify(r.b.kpis.recusaPct).slice(0, 80));
      r = await call('GET', `/metricas/kpis?${Q(10, 1, '&prioridade=CRITICA,ALTA')}`, ger);
      ok('filtro prioridade=CRITICA,ALTA: 3 concluídas, MTTA 2000', r.b.kpis.concluidas.valor === 3 && perto(r.b.kpis.mttaSegundos.valor, 2000));
      r = await call('GET', `/metricas/kpis?${Q(10, 1, '&tipo=PREVENTIVA')}`, ger);
      ok('tipo=PREVENTIVA: nada concluído, valores nulos', r.b.kpis.concluidas.valor === 0 && r.b.kpis.mttrLiquidoSegundos.valor === null && r.b.kpis.retrabalhoPct.valor === null);
      ok('tecnicoIds inválido -> 400', (await call('GET', `/metricas/kpis?tecnicoIds=abc`, ger)).s === 400);
      ok('prioridade inválida -> 400', (await call('GET', `/metricas/kpis?prioridade=FOO`, ger)).s === 400);
      ok('de >= ate -> 400', (await call('GET', `/metricas/kpis?de=2026-02-01&ate=2026-01-01`, ger)).s === 400);

      console.log('--- /metricas/backlog (foto de agora) ---');
      r = await call('GET', `/metricas/backlog?de=2020-01-01&ate=2020-01-02&tecnicoIds=${t3.id}`, ger);
      const bl = r.b;
      ok('ignora período e tecnicoIds: total 8', r.s === 200 && bl.total === 8, String(bl.total));
      ok('porStatus: aguardandoTecnico 5 (ABERTA+RESERVADA), emAtendimento 1, pausadas 1, aguardandoAprovacao 1, aguardandoConclusao 0', JSON.stringify(bl.porStatus) === JSON.stringify({ aguardandoTecnico: 5, emAtendimento: 1, pausadas: 1, aguardandoAprovacao: 1, aguardandoConclusao: 0 }), JSON.stringify(bl.porStatus));
      ok('porIdade: 4 faixas fixas; <1h=7, 4-8h=1', bl.porIdade.map((x: any) => x.faixa).join() === '<1h,1-4h,4-8h,>8h' && bl.porIdade[0].n === 7 && bl.porIdade[2].n === 1 && bl.porIdade[1].n === 0 && bl.porIdade[3].n === 0, JSON.stringify(bl.porIdade));
      ok('porPrioridade: CRITICA 1, BAIXA 1, MEDIA 6, ALTA 0', bl.porPrioridade.CRITICA === 1 && bl.porPrioridade.BAIXA === 1 && bl.porPrioridade.MEDIA === 6 && bl.porPrioridade.ALTA === 0, JSON.stringify(bl.porPrioridade));
      r = await call('GET', `/metricas/backlog?prioridade=CRITICA`, ger);
      ok('filtro prioridade vale no backlog (1)', r.b.total === 1);
      const antes = (await call('GET', '/metricas/backlog', ger)).b.total;
      await novaOm();
      ok('evento de OM zera o cache: backlog já mostra +1', (await call('GET', '/metricas/backlog', ger)).b.total === antes + 1);

      console.log('--- /metricas/equipe ---');
      r = await call('GET', `/metricas/equipe?${base}`, ger);
      const eqp = r.b.tecnicos as any[];
      ok('ordenada por NOME (nunca por desempenho)', JSON.stringify(eqp.map((x) => x.nome)) === JSON.stringify([...eqp.map((x) => x.nome)].sort((a, b) => a.localeCompare(b, 'pt-BR'))), eqp.map((x) => x.nome).join(' | '));
      ok('sem campo de ranking/score', !/rank|score|posicao|nota/i.test(JSON.stringify(r.b)));
      const e1 = eqp.find((x) => x.nome === 'Tec T1'), e2 = eqp.find((x) => x.nome === 'Tec T2'), e3 = eqp.find((x) => x.nome === 'Tec T3'), eg = eqp.find((x) => x.nome === 'Gerente M');
      ok('T1 agora: EM_ATENDIMENTO, 1 em atendimento, 0 reservadas, omAtual com início do cronômetro', e1.agora.estado === 'EM_ATENDIMENTO' && e1.agora.emAtendimento === 1 && e1.agora.reservadas === 0 && e1.agora.omAtual?.numero && !!e1.agora.omAtual.inicioCronometro && e1.agora.omAtual.equipamento === 'M-01', JSON.stringify(e1.agora));
      ok('T1 período: 6 concluídas, MTTR líq 3500, MTTA 2650, retrabalho 14.3%', e1.periodo.concluidas === 6 && perto(e1.periodo.mttrLiquidoSegundos, 3500) && perto(e1.periodo.mttaSegundos, 2650) && e1.periodo.retrabalhoPct === 14.3 && e1.periodo.amostraSuficiente === true, JSON.stringify(e1.periodo));
      ok('T1 horas apontadas = 21000 s + cronômetro aberto', e1.periodo.horasApontadasSegundos >= 21000 && e1.periodo.horasApontadasSegundos < 21200 && e1.periodo.retroativoPct === 0);
      ok('T2 (2 concluídas): amostra insuficiente => médias NULAS no servidor', e2.periodo.concluidas === 2 && e2.periodo.amostraSuficiente === false && e2.periodo.mttrLiquidoSegundos === null && e2.periodo.mttaSegundos === null && e2.periodo.retrabalhoPct === null && e2.periodo.horasApontadasSegundos === 3000, JSON.stringify(e2.periodo));
      ok('T2 agora: DISPONIVEL (AG1 aguarda aprovação, não conta carga)', e2.agora.estado === 'DISPONIVEL' && e2.agora.emAtendimento === 0 && e2.agora.pausadas === 0 && e2.agora.omAtual === null);
      ok('T3 agora: COM_RESERVA (reatribuída), 1 reservada', e3.agora.estado === 'COM_RESERVA' && e3.agora.reservadas === 1);
      ok('Gerente que atende aparece (PAUSADO, 1 pausada)', eg && eg.agora.estado === 'PAUSADO' && eg.agora.pausadas === 1);
      ok('admin sem atividade NÃO aparece', !eqp.some((x) => x.nome === admin.nome));
      r = await call('GET', `/metricas/equipe?${base}&tecnicoIds=${t1.id}`, ger);
      ok('filtro tecnicoIds restringe a lista', r.b.tecnicos.length === 1 && r.b.tecnicos[0].nome === 'Tec T1');
      r = await call('GET', `/metricas/equipe?${Q(10, 1, '&prioridade=ALTA')}`, ger);
      ok('filtro de prioridade afeta o período (T1: 1 ALTA, amostra insuficiente)', r.b.tecnicos.find((x: any) => x.nome === 'Tec T1').periodo.concluidas === 1 && r.b.tecnicos.find((x: any) => x.nome === 'Tec T1').periodo.amostraSuficiente === false);

      console.log('--- /metricas/meta ---');
      r = await call('GET', `/metricas/meta?${base}`, ger);
      ok('sem metas: devolve SÓ { configurada: false }', r.s === 200 && JSON.stringify(r.b) === '{"configurada":false}', JSON.stringify(r.b));
      ok('chaves de meta nascem vazias (sem padrão ativo)', (await prisma.configuracaoGlobal.count({ where: { chave: { startsWith: 'META_' }, valor: null } })) === 5);
      ok('PUT meta inválida (abc / 0) -> 400', (await call('PUT', '/configuracoes/META_MTTA_MIN_ALTA', admin, { valor: 'abc' })).s === 400 && (await call('PUT', '/configuracoes/META_MTTA_MIN_ALTA', admin, { valor: '0' })).s === 400);
      ok('GERENTE não altera meta (403)', (await call('PUT', '/configuracoes/META_MTTA_MIN_ALTA', ger, { valor: '60' })).s === 403);
      for (const [kk, v] of [['CRITICA', '15'], ['ALTA', '60'], ['MEDIA', '25'], ['BAIXA', '120']]) await call('PUT', `/configuracoes/META_MTTA_MIN_${kk}`, admin, { valor: v });
      await call('PUT', '/configuracoes/META_MTTR_MIN', admin, { valor: '90' });
      r = await call('GET', `/metricas/meta?${base}&comparar=true`, ger);
      ok('configurada: metas em segundos e MTTR da meta', r.b.configurada === true && r.b.metasMttaSegundos.CRITICA === 900 && r.b.metasMttaSegundos.ALTA === 3600 && r.b.metasMttaSegundos.MEDIA === 1500 && r.b.metasMttaSegundos.BAIXA === 7200 && r.b.metaMttrSegundos === 5400, JSON.stringify(r.b.metasMttaSegundos));
      ok('geral: 6 de 8 dentro da meta = 75.0%; anterior 66.7%', r.b.geral.dentroDaMeta === 6 && r.b.geral.total === 8 && r.b.geral.pct === 75 && r.b.geral.anteriorPct === 66.7, JSON.stringify(r.b.geral));
      ok('porPrioridade (CRITICA→BAIXA): 100 / 100 / 75 / 0', r.b.porPrioridade.map((x: any) => x.prioridade).join() === 'CRITICA,ALTA,MEDIA,BAIXA' && r.b.porPrioridade.map((x: any) => x.pct).join() === '100,100,75,0', r.b.porPrioridade.map((x: any) => `${x.prioridade}:${x.dentroDaMeta}/${x.total}`).join(' '));
      for (const kk of ['CRITICA', 'MEDIA', 'BAIXA']) await call('PUT', `/configuracoes/META_MTTA_MIN_${kk}`, admin, { valor: '' });
      r = await call('GET', `/metricas/meta?${base}`, ger);
      ok('só ALTA configurada: usa só as prioridades com meta (2/2)', r.b.configurada === true && r.b.porPrioridade.length === 1 && r.b.porPrioridade[0].prioridade === 'ALTA' && r.b.geral.total === 2 && r.b.metasMttaSegundos.CRITICA === null, JSON.stringify(r.b.geral));
      await call('PUT', '/configuracoes/META_MTTA_MIN_ALTA', admin, { valor: '' });
      r = await call('GET', `/metricas/meta?${base}`, ger);
      ok('só META_MTTR_MIN restante: configurada=false mas com metaMttrSegundos (velocímetro de MTTR)', r.b.configurada === false && r.b.metaMttrSegundos === 5400);
      await call('PUT', '/configuracoes/META_MTTR_MIN', admin, { valor: '' });
      r = await call('GET', `/metricas/meta?${base}`, ger);
      ok('limpar a última meta volta a { configurada: false }', JSON.stringify(r.b) === '{"configurada":false}');
      await call('PUT', '/configuracoes/META_MTTR_MIN', admin, { valor: '' });
      const cfg = await call('GET', '/configuracoes', admin);
      ok('GET /configuracoes: metas no grupo METAS com unidade/min/max, padrao null', cfg.b.filter((x: any) => x.chave.startsWith('META_')).length === 5 && cfg.b.filter((x: any) => x.chave.startsWith('META_')).every((x: any) => x.grupo === 'METAS' && x.unidade === 'min' && x.min === 1 && x.padrao === null && x.valor === null));

      console.log('--- /metricas/mttr (serie densa, abertas, anterior) ---');
      r = await call('GET', `/metricas/mttr?${base}&comparar=true`, ger);
      const m = r.b;
      const soma = (a: any[], c: string) => a.reduce((t, x) => t + x[c], 0);
      ok('serie densa: um item por dia, todos com abertas e ordensConcluidas', r.s === 200 && m.serie.length >= 10 && m.serie.every((x: any) => 'abertas' in x && 'ordensConcluidas' in x), String(m.serie.length));
      ok('Σ concluídas = 8 e Σ abertas = 17 (por data_abertura)', soma(m.serie, 'ordensConcluidas') === 8 && soma(m.serie, 'abertas') === 17, `${soma(m.serie, 'ordensConcluidas')}/${soma(m.serie, 'abertas')}`);
      ok('anterior alinhado por posição (mesmo tamanho): Σ concluídas 3, Σ abertas 3', Array.isArray(m.anterior) && m.anterior.length === m.serie.length && soma(m.anterior, 'ordensConcluidas') === 3 && soma(m.anterior, 'abertas') === 3, `${m.anterior?.length}/${m.serie.length}`);
      ok('geralAnterior e periodoAnterior presentes', m.geralAnterior.ordensConcluidas === 3 && !!m.periodoAnterior);
      ok('porCategoria / porPrioridade (ordinal) / porTecnico preservados e fecham com o geral', soma(m.porCategoria, 'ordensConcluidas') === 8 && m.porPrioridade.map((x: any) => x.prioridade).join() === 'BAIXA,MEDIA,ALTA,CRITICA' && soma(m.porTecnico, 'ordensConcluidas') === 8 && m.porSetor.length === 1);
      r = await call('GET', `/metricas/mttr?${base}`, ger);
      ok('comparar=false: sem anterior', r.b.anterior === undefined);
      r = await call('GET', `/metricas/mttr?${Q(10, 1, `&tecnicoIds=${t2.id}&prioridade=ALTA`)}`, ger);
      ok('mttr aceita tecnicoIds e prioridade', r.s === 200 && r.b.geral.ordensConcluidas === 1);

      console.log('--- pausas e ofensores: códigos reais ---');
      r = await call('GET', `/metricas/pausas?${base}`, ger);
      ok('pausas: motivos só dos 6 códigos reais (REFEICAO presente)', r.s === 200 && r.b.itens.length >= 1 && r.b.itens.every((x: any) => ['AGUARDANDO_PECA', 'AGUARDANDO_PRODUCAO', 'REFEICAO', 'TROCA_TURNO', 'AGUARDANDO_SUPORTE', 'OUTRO'].includes(x.motivo)) && r.b.itens.some((x: any) => x.motivo === 'REFEICAO'));
      await prisma.$executeRaw`UPDATE historico_status_ordem SET motivo = 'texto legado qualquer' WHERE ordem_id = ${BigInt(P1)} AND status_novo = 'PAUSADA'`;
      limparCacheMetricas();
      r = await call('GET', `/metricas/pausas?${base}`, ger);
      ok('motivo legado/desconhecido é normalizado para OUTRO', r.b.itens.length === 1 && r.b.itens[0].motivo === 'OUTRO');
      r = await call('GET', `/metricas/pausas?${Q(10, 1, `&tecnicoIds=${t3.id}`)}`, ger);
      ok('pausas aceita tecnicoIds (T3 não tem OM com pausa)', r.b.itens.length === 0 && r.b.totalPausas === 0);
      r = await call('GET', `/metricas/ofensores?${base}&agrupar=categoria`, ger);
      const cats = ['MECANICO', 'ELETRICO', 'PNEUMATICO_HIDRAULICO', 'INSTRUMENTACAO', 'SEGURANCA', 'OUTROS'];
      ok('ofensores por categoria: só categorias reais (legada vira OUTROS)', r.s === 200 && r.b.itens.every((x: any) => cats.includes(x.chave)) && r.b.itens.some((x: any) => x.chave === 'OUTROS'), r.b.itens.map((x: any) => x.chave).join());

      console.log('--- permissões ---');
      for (const rota of ['kpis', 'meta', 'equipe', 'backlog', 'mttr']) {
        const a = await call('GET', `/metricas/${rota}`, t1), b = await call('GET', `/metricas/${rota}`, oper);
        ok(`/metricas/${rota}: TECNICO e OPERADOR -> 403`, a.s === 403 && b.s === 403);
      }
      ok('ADMIN também acessa (200)', (await call('GET', '/metricas/kpis', admin)).s === 200);
      const sem = await app.inject({ method: 'GET', url: '/metricas/kpis' });
      ok('sem token -> 401', sem.statusCode === 401);


    } finally {
      // restaura a tabela de configurações (alguns roteiros a esvaziam) e libera conexões
      const { prisma: p } = await import('../../src/db.js');
      if (_cfg.length > 0) { await p.configuracaoGlobal.deleteMany({}); await p.configuracaoGlobal.createMany({ data: _cfg }); }
      await p.$disconnect();
    }
  }, 280_000);
});
