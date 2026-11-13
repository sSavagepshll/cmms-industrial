import { createRequire } from 'node:module';
import { describe, it } from 'vitest';
import { criarOk, URL_TESTE } from '../helpers/soft.js';

// Convertido do roteiro e2e (verificações "moles": o teste mostra todas as falhas de uma vez).
describe('Fase 18b — pausas, ofensores e tendências', () => {
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
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      await prisma.$executeRaw`TRUNCATE ordens_manutencao, equipamentos, auditoria RESTART IDENTITY CASCADE`;
      await prisma.usuario.deleteMany({ where: { matricula: { startsWith: 'n' } } });
      const CH = ['META_MTTA_MIN_CRITICA', 'META_MTTA_MIN_ALTA', 'META_MTTA_MIN_MEDIA', 'META_MTTA_MIN_BAIXA', 'META_MTTR_MIN', 'ZONA_META_OK_PCT', 'ZONA_META_ATENCAO_PCT', 'ZONA_MTTR_ATENCAO_PCT'];
      const limpaConfig = async () => { for (const k of CH) await prisma.configuracaoGlobal.update({ where: { chave: k }, data: { valor: null } }); invalidarPoliticas(); limparCacheMetricas(); };
      await limpaConfig();
      const pin = await hashPin('1234');
      const mk = (nome: string, perfil: any, matricula: string) => prisma.usuario.create({ data: { nome, perfil, matricula, pinHash: pin } });
      const oper = await mk('Oper N', 'OPERADOR', 'n1');
      const ger = await mk('Gerente N', 'GERENTE', 'n2');
      const t1 = await mk('Tec N1', 'TECNICO', 'n3');
      const t2 = await mk('Tec N2', 'TECNICO', 'n4');
      const admin = await prisma.usuario.findFirstOrThrow({ where: { email: 'admin@om.com.br' } });
      const eq = await prisma.equipamento.create({ data: { codigo: 'N-01', nome: 'Maq N', setor: 'Unico' } });
      const tok = (u: any) => ({ authorization: 'Bearer ' + app.jwt.sign({ sub: String(u.id), perfil: u.perfil, nome: u.nome }) });
      const call = async (m: any, url: string, u: any, payload?: any) => {
        const r = await app.inject({ method: m, url, headers: tok(u), payload });
        let b: any = null; try { b = r.body ? JSON.parse(r.body) : null; } catch { b = r.body; }
        return { s: r.statusCode, b, h: r.headers };
      };
      const PIN = { pin: '1234' };
      const nova = async (urgente = false) =>
        (await call('POST', '/ordens', oper, { equipamentoId: String(eq.id), maquinaParada: urgente, categoria: 'MECANICO', sintomas: ['x'], tipoAtivo: 'MAQUINA', custoTipo: 'INTERNO', confirmarDuplicidade: true })).b.id as string;
      const abertura = (id: string, seg: number) => prisma.$executeRaw`UPDATE ordens_manutencao SET data_abertura = now() - make_interval(secs => ${seg}::float8) WHERE id = ${BigInt(id)}`;

      // ---------- cenário "Atenção agora" ----------
      const X1 = await nova(true); await abertura(X1, 120);            // CRITICA sem responsável, 2 min
      const X2 = await nova(true); await abertura(X2, 1800);           // CRITICA sem responsável, 30 min
      const X6 = await nova(true); await abertura(X6, 36000);          // CRITICA sem responsável, 10 h (também >8h: tipo mais grave vence)
      const X3 = await nova(); await call('POST', `/ordens/${X3}/atribuir`, ger, { tecnicoId: String(t1.id) });
      await prisma.$executeRaw`UPDATE ordens_manutencao SET delegado_em = now() - interval '20 minutes' WHERE id = ${BigInt(X3)}`;   // reserva sem aceite 20 min
      const X4 = await nova(); await call('POST', `/ordens/${X4}/atribuir`, ger, { tecnicoId: String(t2.id) });                       // reserva recente: não entra
      const X8 = await nova(); await call('POST', `/ordens/${X8}/atribuir`, ger, { tecnicoId: String(t2.id) });
      await prisma.$executeRaw`UPDATE ordens_manutencao SET delegado_em = now() - interval '25 minutes' WHERE id = ${BigInt(X8)}`;
      await abertura(X8, 9 * 3600);                                    // reserva sem aceite + >8h: tipo RESERVA_SEM_ACEITE vence
      const X5 = await nova(); await call('POST', `/ordens/${X5}/assumir`, t1, PIN); await abertura(X5, 9 * 3600);   // em andamento há 9 h
      const X7 = await nova(); await abertura(X7, 3600);               // 1 h: não entra
      // concluída (X9) com apontamento de 1800 s, para o velocímetro de MTTR
      const X9 = await nova(); await call('POST', `/ordens/${X9}/assumir`, t2, PIN);
      await call('POST', `/ordens/${X9}/concluir`, t2, { causaRaiz: 'x', acaoExecutada: 'y' });
      await call('POST', `/ordens/${X9}/aprovar`, oper, PIN);
      await call('POST', `/ordens/${X9}/encerrar`, ger, { ...PIN, custoTipo: 'INTERNO' });
      const concl = new Date(Date.now() - 3600_000), abr = new Date(concl.getTime() - 12 * 3600_000), ini = new Date(abr.getTime() + 600_000);
      await prisma.$executeRaw`UPDATE ordens_manutencao SET data_abertura = ${abr}::timestamptz, data_inicio = ${ini}::timestamptz, data_conclusao = ${concl}::timestamptz, data_aprovacao = ${new Date(concl.getTime() + 60_000)}::timestamptz, responsavel_id = ${t2.id} WHERE id = ${BigInt(X9)}`;
      await prisma.$executeRaw`DELETE FROM historico_status_ordem WHERE ordem_id = ${BigInt(X9)}`;
      const hx = (ant: string | null, nv: string, q: Date, u: any) => prisma.$executeRaw`INSERT INTO historico_status_ordem (ordem_id, status_anterior, status_novo, usuario_id, criado_em) VALUES (${BigInt(X9)}, ${ant}::status_ordem, ${nv}::status_ordem, ${u.id}, ${q}::timestamptz)`;
      await hx(null, 'ABERTA', abr, oper); await hx('ABERTA', 'EM_ANDAMENTO', ini, t2);
      await hx('EM_ANDAMENTO', 'AGUARDANDO_PECA', new Date(ini.getTime() + 900_000), t2); await hx('AGUARDANDO_PECA', 'EM_ANDAMENTO', new Date(ini.getTime() + 41_700_000), t2);   // 40800 s fora do esforço ativo
      await hx('EM_ANDAMENTO', 'AGUARDANDO_APROVACAO', concl, t2); await hx('AGUARDANDO_APROVACAO', 'CONCLUIDA', new Date(concl.getTime() + 60_000), oper);
      await prisma.$executeRaw`DELETE FROM om_apontamentos_tempo WHERE ordem_id = ${BigInt(X9)}`;
      await prisma.$executeRaw`INSERT INTO om_apontamentos_tempo (ordem_id, tecnico_id, inicio, fim) VALUES (${BigInt(X9)}, ${t2.id}, ${ini}::timestamptz, ${new Date(ini.getTime() + 1800_000)}::timestamptz)`;
      limparCacheMetricas();

      const base = `de=${new Date(Date.now() - 10 * 86_400_000).toISOString()}&ate=${new Date(Date.now() + 3600_000).toISOString()}`;

      console.log('--- D7: GET /metricas/atencao ---');
      let r = await call('GET', '/metricas/atencao', ger);
      const ids = (r.b.itens as any[]).map((x) => x.id);
      ok('GERENTE acessa (200); total antes do corte = 6; itens ≤ 5', r.s === 200 && r.b.total === 6 && r.b.itens.length === 5, `total=${r.b.total} itens=${r.b.itens.length}`);
      ok('ordem por gravidade e idade: CRITICA (10h, 30m, 2m) → RESERVA (25m, 20m)', JSON.stringify(ids) === JSON.stringify([X6, X2, X1, X8, X3]), r.b.itens.map((x: any) => `${x.tipo}:${x.idadeSegundos}`).join(' | '));
      const it = r.b.itens[0];
      ok('item: tipo, id, numero, equipamento (TAG), idadeSegundos', it.tipo === 'CRITICA_SEM_RESPONSAVEL' && /^OM-\d{4}-\d{6}$/.test(it.numero) && it.equipamento === 'N-01' && it.equipamentoNome === 'Maq N' && perto(it.idadeSegundos, 36000, 5) && it.prioridade === 'CRITICA', JSON.stringify(it));
      ok('OM de 10 h e CRITICA aparece como CRITICA_SEM_RESPONSAVEL (não duplica em MAIS_DE_8H)', r.b.itens.filter((x: any) => x.id === X6).length === 1 && r.b.itens[0].tipo === 'CRITICA_SEM_RESPONSAVEL');
      const r8 = r.b.itens.find((x: any) => x.id === X8);
      ok('reserva sem aceite: idade medida desde a DELEGAÇÃO (25 min), e vence MAIS_DE_8H', r8.tipo === 'RESERVA_SEM_ACEITE' && perto(r8.idadeSegundos, 1500, 5), String(r8.idadeSegundos));
      ok('reserva recente (2 min), OM de 1 h e OM concluída não entram', !ids.includes(X4) && !ids.includes(X7) && !ids.includes(X9));
      r = await call('GET', '/metricas/atencao?limit=2', ger);
      ok('limit=2 corta, mas total continua 6 (a TV mostra "+4")', r.b.itens.length === 2 && r.b.total === 6);
      ok('limit=6 -> 400 (máximo 5)', (await call('GET', '/metricas/atencao?limit=6', ger)).s === 400);
      r = await call('GET', '/metricas/atencao', ger);
      ok('MAIS_DE_8H aparece quando há espaço (limit=5 com 6 itens: 6º é X5)', (await call('GET', '/metricas/atencao?limit=5', admin)).b.total === 6);
      ok('TECNICO / OPERADOR -> 403; sem token -> 401', (await call('GET', '/metricas/atencao', t1)).s === 403 && (await call('GET', '/metricas/atencao', oper)).s === 403 && (await app.inject({ method: 'GET', url: '/metricas/atencao' })).statusCode === 401);
      // OM em andamento >8h entra como MAIS_DE_8H quando as demais saem da lista
      await prisma.$executeRaw`UPDATE ordens_manutencao SET data_abertura = now() WHERE id IN (${BigInt(X1)}, ${BigInt(X2)}, ${BigInt(X6)}, ${BigInt(X8)}, ${BigInt(X3)})`;
      await prisma.$executeRaw`UPDATE ordens_manutencao SET delegado_em = now() WHERE id IN (${BigInt(X3)}, ${BigInt(X8)})`;
      limparCacheMetricas();
      r = await call('GET', '/metricas/atencao', ger);
      const x5 = r.b.itens.find((x: any) => x.id === X5);
      ok('zeradas as idades: CRITICA sem responsável segue na lista (tipo não depende da idade) e X5 entra como MAIS_DE_8H (9 h)', r.b.total === 4 && r.b.itens.filter((x: any) => x.tipo === 'CRITICA_SEM_RESPONSAVEL').length === 3 && x5?.tipo === 'MAIS_DE_8H' && perto(x5.idadeSegundos, 32400, 5) && r.b.itens[3].id === X5, JSON.stringify(r.b.itens.map((x: any) => x.tipo)));

      console.log('--- D8: geradoEm (header X-Gerado-Em e corpo) ---');
      limparCacheMetricas();
      const rotas = ['kpis', 'equipe', 'backlog', 'atencao', 'mttr', 'ofensores', 'pausas'];
      for (const rota of rotas) {
        const x = await call('GET', `/metricas/${rota}?${base}`, ger);
        const h = x.h['x-gerado-em'] as string | undefined;
        ok(`/metricas/${rota}: header X-Gerado-Em e corpo.geradoEm iguais e recentes`, x.s === 200 && !!h && x.b.geradoEm === h && Math.abs(Date.now() - new Date(h).getTime()) < 15_000, String(h));
      }
      let m0 = await call('GET', '/metricas/meta', ger);
      ok('/metricas/meta sem nada configurado: corpo EXATAMENTE {"configurada":false}, com header X-Gerado-Em', JSON.stringify(m0.b) === '{"configurada":false}' && !!m0.h['x-gerado-em']);
      const g1 = (await call('GET', `/metricas/kpis?${base}`, ger)).h['x-gerado-em'];
      await sleep(1100);
      const g2 = (await call('GET', `/metricas/kpis?${base}`, ger)).h['x-gerado-em'];
      ok('dado em cache mantém o instante ORIGINAL (a TV detecta defasagem)', g1 === g2);
      await nova();   // evento de OM: invalida o cache
      const g3 = (await call('GET', `/metricas/kpis?${base}`, ger)).h['x-gerado-em'];
      ok('após evento de OM o dado é regerado (geradoEm novo)', g3 !== g2 && new Date(g3 as string).getTime() > new Date(g2 as string).getTime());
      const cors = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:3000' } });
      ok('CORS expõe X-Gerado-Em ao navegador', String(cors.headers['access-control-expose-headers']).includes('X-Gerado-Em'));

      console.log('--- D1: kpis.abertas ---');
      r = await call('GET', `/metricas/kpis?${base}&comparar=true`, ger);
      const ab = r.b.kpis.abertas;
      ok('abertas: valor = 10 (9 do cenário + 1 criada), anterior 0, variação nula (sem base)', ab.valor === 10 && ab.anterior === 0 && ab.variacaoPct === null, JSON.stringify(ab).slice(0, 90));
      ok('abertas.serie com os mesmos pontos dos demais KPIs e soma 10', ab.serie.length === r.b.kpis.concluidas.serie.length && ab.serie.reduce((t: number, x: number) => t + x, 0) === 10);
      r = await call('GET', `/metricas/kpis?${base}&prioridade=CRITICA`, ger);
      ok('abertas respeita prioridade (3 críticas)', r.b.kpis.abertas.valor === 3);
      r = await call('GET', `/metricas/kpis?${base}&tecnicoIds=${t1.id}`, ger);
      ok('abertas ignora tecnicoIds (fluxo é da equipe)', r.b.kpis.abertas.valor === 10);

      console.log('--- D2/D3: meta de MTTR + zonas (vazias até aprovação) ---');
      ok('ZONA_*: chaves existem, vazias, grupo METAS', (await prisma.configuracaoGlobal.count({ where: { chave: { startsWith: 'ZONA_' }, valor: null, grupo: 'METAS' } })) === 3);
      await call('PUT', '/configuracoes/META_MTTR_MIN', admin, { valor: '60' });
      r = await call('GET', `/metricas/meta?${base}&comparar=true`, ger);
      ok('só META_MTTR_MIN: configurada=false, mas devolve metaMttrSegundos e o bloco mttr (valor ÷ meta)', r.b.configurada === false && r.b.metaMttrSegundos === 3600 && r.b.mttr.metaSegundos === 3600 && r.b.mttr.valorSegundos === 1800 && r.b.mttr.pctDaMeta === 50 && r.b.mttr.amostra === 1, JSON.stringify(r.b.mttr));
      ok('zonas todas null (limiares não aprovados) e sem campos de MTTA', JSON.stringify(r.b.zonas) === '{"metaOkPct":null,"metaAtencaoPct":null,"mttrAtencaoPct":null}' && r.b.porPrioridade === undefined && !!r.b.geradoEm);
      ok('PUT ZONA_META_OK_PCT=80 e ATENCAO=50', (await call('PUT', '/configuracoes/ZONA_META_OK_PCT', admin, { valor: '80' })).s === 200 && (await call('PUT', '/configuracoes/ZONA_META_ATENCAO_PCT', admin, { valor: '50' })).s === 200);
      ok('ATENCAO >= OK -> 400 (e OK <= ATENCAO -> 400)', (await call('PUT', '/configuracoes/ZONA_META_ATENCAO_PCT', admin, { valor: '90' })).s === 400 && (await call('PUT', '/configuracoes/ZONA_META_OK_PCT', admin, { valor: '40' })).s === 400);
      ok('ZONA_MTTR_ATENCAO_PCT < 100 -> 400; 125 ok; fora de faixa/abc -> 400', (await call('PUT', '/configuracoes/ZONA_MTTR_ATENCAO_PCT', admin, { valor: '50' })).s === 400 && (await call('PUT', '/configuracoes/ZONA_MTTR_ATENCAO_PCT', admin, { valor: 'abc' })).s === 400 && (await call('PUT', '/configuracoes/ZONA_MTTR_ATENCAO_PCT', admin, { valor: '125' })).s === 200);
      ok('GERENTE não altera zona (403)', (await call('PUT', '/configuracoes/ZONA_META_OK_PCT', ger, { valor: '70' })).s === 403);
      await call('PUT', '/configuracoes/META_MTTA_MIN_MEDIA', admin, { valor: '30' });
      r = await call('GET', `/metricas/meta?${base}`, ger);
      ok('com MTTA e MTTR: configurada=true, zonas {80,50,125}, mttr e porPrioridade juntos', r.b.configurada === true && JSON.stringify(r.b.zonas) === '{"metaOkPct":80,"metaAtencaoPct":50,"mttrAtencaoPct":125}' && r.b.mttr.pctDaMeta === 50 && Array.isArray(r.b.porPrioridade) && r.b.metaMttrSegundos === 3600, JSON.stringify(r.b.zonas));
      const cfg = await call('GET', '/configuracoes', admin);
      const zk = cfg.b.find((x: any) => x.chave === 'ZONA_MTTR_ATENCAO_PCT');
      ok('GET /configuracoes: zona com unidade %, min/max', zk.unidade === '%' && zk.min === 100 && zk.max === 1000 && zk.padrao === null);
      await limpaConfig();
      m0 = await call('GET', '/metricas/meta', ger);
      ok('limpar tudo volta a { configurada:false } exato', JSON.stringify(m0.b) === '{"configurada":false}');

      console.log('--- D4: pausas?top=N (soma feita no servidor) ---');
      const mot: [string, number][] = [['REFEICAO', 3600], ['AGUARDANDO_PECA', 1800], ['TROCA_TURNO', 900], ['OUTRO', 300], ['AGUARDANDO_SUPORTE', 60]];
      let t = Date.now() - 3 * 86_400_000;
      for (const [m, dur] of mot) {
        await prisma.$executeRaw`INSERT INTO historico_status_ordem (ordem_id, status_anterior, status_novo, usuario_id, motivo, criado_em) VALUES (${BigInt(X7)}, 'EM_ANDAMENTO', 'PAUSADA', ${ger.id}, ${m}, ${new Date(t)}::timestamptz)`;
        t += dur * 1000;
        await prisma.$executeRaw`INSERT INTO historico_status_ordem (ordem_id, status_anterior, status_novo, usuario_id, criado_em) VALUES (${BigInt(X7)}, 'PAUSADA', 'EM_ANDAMENTO', ${ger.id}, ${new Date(t)}::timestamptz)`;
        t += 60_000;
      }
      limparCacheMetricas();
      r = await call('GET', `/metricas/pausas?${base}`, ger);
      ok('sem top: 5 motivos, outros=null', r.b.itens.length === 5 && r.b.outros === null && r.b.totalPausas === 5 && r.b.itens.map((x: any) => x.motivo).join() === 'REFEICAO,AGUARDANDO_PECA,TROCA_TURNO,OUTRO,AGUARDANDO_SUPORTE');
      r = await call('GET', `/metricas/pausas?${base}&top=3`, ger);
      const soma = r.b.itens.reduce((a: number, x: any) => a + x.percentualDoTempo, 0) + (r.b.outros?.percentualDoTempo ?? 0);
      ok('top=3: 3 maiores por TEMPO + outros somado (2 motivos, 2 pausas, 360 s)', r.b.itens.map((x: any) => x.motivo).join() === 'REFEICAO,AGUARDANDO_PECA,TROCA_TURNO' && r.b.outros?.motivos === 2 && r.b.outros.pausas === 2 && r.b.outros.tempoTotalSegundos === 360, JSON.stringify(r.b.outros));
      ok('percentuais sobre o TOTAL: as 4 fatias fecham em 100 (±0,2)', Math.abs(soma - 100) <= 0.2 && r.b.outros.percentualDoTempo === 5.4 && r.b.tempoTotalPausadoSegundos === 6660, `${soma} / ${r.b.outros?.percentualDoTempo}`);
      r = await call('GET', `/metricas/pausas?${base}&top=10`, ger);
      ok('top maior que o nº de motivos: outros=null', r.b.itens.length === 5 && r.b.outros === null);
      ok('top=0 / top=11 -> 400', (await call('GET', `/metricas/pausas?top=0`, ger)).s === 400 && (await call('GET', `/metricas/pausas?top=11`, ger)).s === 400);

      await limpaConfig();

    } finally {
      // restaura a tabela de configurações (alguns roteiros a esvaziam) e libera conexões
      const { prisma: p } = await import('../../src/db.js');
      if (_cfg.length > 0) { await p.configuracaoGlobal.deleteMany({}); await p.configuracaoGlobal.createMany({ data: _cfg }); }
      await p.$disconnect();
    }
  }, 280_000);
});
