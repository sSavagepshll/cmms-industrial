import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, US12, type Ambiente } from '../helpers/ambiente.js';

/** US-12: metas/zonas gravadas, definição de MTTA/MTTR (vw_om_tempos), zonas nos limites exatos e expiração da reserva (15 min). */
describe('US-12 — métricas, zonas e reserva', () => {
  let A: Ambiente;
  let oper: any, ger: any, admin: any, tA: any, tB: any, tC: any, tD: any, tE: any, eq: any;
  const perto = (a: number | null | undefined, b: number, tol = 0.11) => a !== null && a !== undefined && Math.abs(a - b) <= tol;

  const nova = async (urgente = false) =>
    (await A.call('POST', '/ordens', oper, { equipamentoId: String(eq.id), maquinaParada: urgente, categoria: 'MECANICO', sintomas: ['x'], tipoAtivo: 'MAQUINA', custoTipo: 'INTERNO', confirmarDuplicidade: true })).b.id as string;
  const tempos = async (id: string) => (await A.prisma.$queryRaw<any[]>`SELECT mtta_segundos, mttr_segundos, parada_segundos FROM vw_om_tempos WHERE ordem_id = ${BigInt(id)}`)[0];

  beforeAll(async () => {
    A = await criarAmbiente();
    await A.limparBanco();
    await A.setConfig(US12);
    oper = await A.mk('Oper U', 'OPERADOR', 'u1');
    ger = await A.mk('Gerente U', 'GERENTE', 'u2');
    tA = await A.mk('Tec A', 'TECNICO', 'u3'); tB = await A.mk('Tec B', 'TECNICO', 'u4'); tC = await A.mk('Tec C', 'TECNICO', 'u5');
    tD = await A.mk('Tec D', 'TECNICO', 'u6'); tE = await A.mk('Tec E', 'TECNICO', 'u7');
    admin = await A.prisma.usuario.findFirstOrThrow({ where: { email: 'admin@om.com.br' } });
    eq = await A.prisma.equipamento.create({ data: { codigo: 'U-01', nome: 'Maq U', setor: 'Unico' } });
  });
  afterAll(async () => { await A.setConfig(US12); await A.fechar(); });

  it('valores aprovados gravados e /metricas/meta sai configurada (em segundos)', async () => {
    const cfg = await A.call('GET', '/configuracoes', admin);
    const val = (k: string) => cfg.b.find((x: any) => x.chave === k)?.valor;
    expect(['META_MTTA_MIN_CRITICA', 'META_MTTA_MIN_ALTA', 'META_MTTA_MIN_MEDIA', 'META_MTTA_MIN_BAIXA', 'META_MTTR_MIN'].map(val)).toEqual(['15', '30', '120', '240', '60']);
    expect(['ZONA_META_OK_PCT', 'ZONA_META_ATENCAO_PCT', 'ZONA_MTTR_ATENCAO_PCT', 'OM_RESERVA_ACEITE_MIN', 'OM_RESERVA_AVISO_MIN'].map(val)).toEqual(['95', '85', '120', '15', '10']);
    const rm = await A.call('GET', '/metricas/meta?de=2020-01-01&ate=2020-02-01', ger);
    expect(rm.b.configurada).toBe(true);
    expect(rm.b.metasMttaSegundos).toEqual({ CRITICA: 900, ALTA: 1800, MEDIA: 7200, BAIXA: 14400 });
    expect(rm.b.metaMttrSegundos).toBe(3600);
    expect(rm.b.zonas).toEqual({ metaOkPct: 95, metaAtencaoPct: 85, mttrAtencaoPct: 120 });
  });

  describe('definição de MTTA e MTTR (vw_om_tempos)', () => {
    const base0 = Date.now() - 5 * 3600_000;
    let Y1: string, Y2: string, Y3: string;

    it('MTTA = abertura → ACEITE; MTTR = aceite → conclusão − PAUSADA − AGUARDANDO_PECA', async () => {
      Y1 = await nova();
      const abr = new Date(base0), ace = new Date(base0 + 600_000), concl = new Date(base0 + 6_000_000), aprov = new Date(base0 + 6_600_000);
      await A.prisma.$executeRaw`DELETE FROM historico_status_ordem WHERE ordem_id = ${BigInt(Y1)}`;
      await A.prisma.$executeRaw`UPDATE ordens_manutencao SET status = 'CONCLUIDA', data_abertura = ${abr}::timestamptz, data_inicio = ${new Date(base0 + 2_000_000)}::timestamptz, data_conclusao = ${concl}::timestamptz, data_aprovacao = ${aprov}::timestamptz, aprovado_por = ${oper.id}, responsavel_id = ${tA.id} WHERE id = ${BigInt(Y1)}`;
      await A.prisma.$executeRaw`DELETE FROM historico_status_ordem WHERE ordem_id = ${BigInt(Y1)}`;
      await A.hist(Y1, null, 'ABERTA', abr, oper); await A.hist(Y1, 'ABERTA', 'EM_ANDAMENTO', ace, tA);
      await A.hist(Y1, 'EM_ANDAMENTO', 'PAUSADA', new Date(base0 + 1_200_000), tA); await A.hist(Y1, 'PAUSADA', 'EM_ANDAMENTO', new Date(base0 + 4_200_000), tA); // 3000 s
      await A.hist(Y1, 'EM_ANDAMENTO', 'AGUARDANDO_PECA', new Date(base0 + 5_400_000), tA); await A.hist(Y1, 'AGUARDANDO_PECA', 'EM_ANDAMENTO', new Date(base0 + 5_700_000), tA); // 300 s
      await A.hist(Y1, 'EM_ANDAMENTO', 'AGUARDANDO_APROVACAO', concl, tA); await A.hist(Y1, 'AGUARDANDO_APROVACAO', 'CONCLUIDA', aprov, oper);
      const v = await tempos(Y1);
      expect.soft(perto(v.mtta_segundos, 600), `mtta ${v.mtta_segundos}`).toBe(true);        // e não o 1º play (2000 s)
      expect.soft(perto(v.mttr_segundos, 2100), `mttr ${v.mttr_segundos}`).toBe(true);       // 6000−600−3000−300
      expect.soft(perto(v.parada_segundos, 6000), `parada ${v.parada_segundos}`).toBe(true);
    });

    it('reprovação: a espera em AGUARDANDO_APROVACAO dentro do intervalo é subtraída', async () => {
      Y3 = await nova();
      const abr = new Date(base0), ace = new Date(base0 + 300_000), cf = new Date(base0 + 3_300_000), ap = new Date(base0 + 3_600_000);
      await A.prisma.$executeRaw`UPDATE ordens_manutencao SET status = 'CONCLUIDA', data_abertura = ${abr}::timestamptz, data_inicio = ${ace}::timestamptz, data_conclusao = ${cf}::timestamptz, data_aprovacao = ${ap}::timestamptz, aprovado_por = ${oper.id}, responsavel_id = ${tA.id} WHERE id = ${BigInt(Y3)}`;
      await A.prisma.$executeRaw`DELETE FROM historico_status_ordem WHERE ordem_id = ${BigInt(Y3)}`;
      await A.hist(Y3, null, 'ABERTA', abr, oper); await A.hist(Y3, 'ABERTA', 'EM_ANDAMENTO', ace, tA);
      await A.hist(Y3, 'EM_ANDAMENTO', 'AGUARDANDO_APROVACAO', new Date(base0 + 1_300_000), tA); await A.hist(Y3, 'AGUARDANDO_APROVACAO', 'EM_ANDAMENTO', new Date(base0 + 2_300_000), oper); // 1000 s
      await A.hist(Y3, 'EM_ANDAMENTO', 'AGUARDANDO_APROVACAO', cf, tA); await A.hist(Y3, 'AGUARDANDO_APROVACAO', 'CONCLUIDA', ap, oper);
      const v = await tempos(Y3);
      expect(perto(v.mttr_segundos, 2000), String(v.mttr_segundos)).toBe(true); // 3300−300−1000
    });

    it('OM legada (sem histórico): aceite = data_inicio', async () => {
      Y2 = await nova();
      await A.prisma.$executeRaw`DELETE FROM historico_status_ordem WHERE ordem_id = ${BigInt(Y2)}`;
      await A.prisma.$executeRaw`UPDATE ordens_manutencao SET status = 'CONCLUIDA', data_abertura = ${new Date(base0)}::timestamptz, data_inicio = ${new Date(base0 + 900_000)}::timestamptz, data_conclusao = ${new Date(base0 + 4_500_000)}::timestamptz, data_aprovacao = ${new Date(base0 + 4_600_000)}::timestamptz, aprovado_por = ${oper.id}, responsavel_id = ${tA.id} WHERE id = ${BigInt(Y2)}`;
      const v = await tempos(Y2);
      expect(perto(v.mtta_segundos, 900) && perto(v.mttr_segundos, 3600), `${v.mtta_segundos}/${v.mttr_segundos}`).toBe(true);
    });

    it('endpoints /kpis, /mttr e /equipe usam a mesma definição', async () => {
      // desloca as 3 OMs para dentro da janela consultada
      await A.prisma.$executeRaw`UPDATE ordens_manutencao SET data_conclusao = data_conclusao + interval '2 hours', data_aprovacao = data_aprovacao + interval '2 hours', data_abertura = data_abertura + interval '2 hours', data_inicio = data_inicio + interval '2 hours' WHERE id IN (${BigInt(Y1)}, ${BigInt(Y2)}, ${BigInt(Y3)})`;
      await A.prisma.$executeRaw`UPDATE historico_status_ordem SET criado_em = criado_em + interval '2 hours' WHERE ordem_id IN (${BigInt(Y1)}, ${BigInt(Y2)}, ${BigInt(Y3)})`;
      A.limparCacheMetricas();
      const q = `de=${new Date(Date.now() - 2 * 86_400_000).toISOString()}&ate=${new Date(Date.now() + 3600_000).toISOString()}&tecnicoIds=${tA.id}`;
      const kp = await A.call('GET', `/metricas/kpis?${q}`, ger);
      expect.soft(perto(kp.b.kpis.mttrLiquidoSegundos.valor, 2566.7, 0.2), String(kp.b.kpis.mttrLiquidoSegundos.valor)).toBe(true); // (2100+3600+2000)/3
      expect.soft(perto(kp.b.kpis.mttaSegundos.valor, 600), String(kp.b.kpis.mttaSegundos.valor)).toBe(true);                         // (600+900+300)/3
      const mt = await A.call('GET', `/metricas/mttr?${q}`, ger);
      expect.soft(perto(mt.b.geral.mttrLiquidoSegundos, 2566.7, 0.2)).toBe(true);
      expect.soft(perto(mt.b.porTecnico[0].mttrLiquidoSegundos, 2566.7, 0.2)).toBe(true);
      const eqp = await A.call('GET', `/metricas/equipe?${q}`, ger);
      expect.soft(eqp.b.tecnicos[0].periodo.concluidas).toBe(3);
      expect.soft(eqp.b.tecnicos[0].periodo.mttrLiquidoSegundos).toBeNull(); // amostra < 5
    });
  });

  describe('zonas nos limites exatos', () => {
    let seq = 0;
    const concluida = async (tec: any, mtta: number, mttr: number) => {
      const conclusao = new Date(Date.now() - (3600 + (seq++ % 40) * 600) * 1000);
      const aceite = new Date(conclusao.getTime() - mttr * 1000);
      const abertura = new Date(aceite.getTime() - mtta * 1000);
      const r = await A.prisma.$queryRaw<{ id: bigint }[]>`
        INSERT INTO ordens_manutencao (equipamento_id, solicitante_id, responsavel_id, tipo, prioridade, status, titulo, data_abertura, data_inicio, data_conclusao, data_aprovacao, aprovado_por)
        VALUES (${eq.id}, ${oper.id}, ${tec.id}, 'CORRETIVA', 'MEDIA', 'CONCLUIDA', 'zona', ${abertura}::timestamptz, ${aceite}::timestamptz, ${conclusao}::timestamptz, ${new Date(conclusao.getTime() + 1000)}::timestamptz, ${oper.id})
        RETURNING id`;
      const id = r[0]!.id;
      await A.prisma.$executeRaw`DELETE FROM historico_status_ordem WHERE ordem_id = ${id}`;
      await A.hist(id, null, 'ABERTA', abertura, oper); await A.hist(id, 'ABERTA', 'EM_ANDAMENTO', aceite, tec);
      await A.hist(id, 'EM_ANDAMENTO', 'AGUARDANDO_APROVACAO', conclusao, tec); await A.hist(id, 'AGUARDANDO_APROVACAO', 'CONCLUIDA', new Date(conclusao.getTime() + 1000), oper);
    };
    const lote = async (tec: any, dentro: number, mttr: number) => { for (let i = 0; i < 20; i++) await concluida(tec, i < dentro ? 600 : 9000, mttr); };
    const z = async (t: any, prefixo = '') => {
      const q = `de=${new Date(Date.now() - 3 * 86_400_000).toISOString()}&ate=${new Date(Date.now() + 3600_000).toISOString()}&tecnicoIds=${t.id}${prefixo}`;
      return (await A.call('GET', `/metricas/meta?${q}`, ger)).b;
    };

    beforeAll(async () => {
      await lote(tB, 19, 3600);  // 95% (limite OK); MTTR 100% da meta (limite OK)
      await lote(tC, 17, 4320);  // 85% (limite ATENÇÃO); MTTR 120% (limite ATENÇÃO)
      await lote(tD, 16, 5000);  // 80% (crítica); MTTR 138,9%
      await lote(tE, 18, 4000);  // 90% (atenção); MTTR 111,1%
      A.limparCacheMetricas();
    });

    it('MTTA: 95% = OK, 85% = ATENÇÃO, 80% = CRÍTICA, 90% = ATENÇÃO', async () => {
      const [b, c, d, e] = [await z(tB), await z(tC), await z(tD), await z(tE)];
      expect([b, c, d, e].map((x) => `${x.geral.pct}:${x.geral.zona}`)).toEqual(['95:OK', '85:ATENCAO', '80:CRITICA', '90:ATENCAO']);
    });
    it('MTTR: 100% = OK, 120% = ATENÇÃO, 138,9% = CRÍTICA, 111,1% = ATENÇÃO', async () => {
      const [b, c, d, e] = [await z(tB), await z(tC), await z(tD), await z(tE)];
      expect([b, c, d, e].map((x) => `${x.mttr.pctDaMeta}:${x.mttr.zona}`)).toEqual(['100:OK', '120:ATENCAO', '138.9:CRITICA', '111.1:ATENCAO']);
    });
    it('sem limiar = sem zona (null)', async () => {
      await A.call('PUT', '/configuracoes/ZONA_META_OK_PCT', admin, { valor: '' });
      await A.call('PUT', '/configuracoes/ZONA_MTTR_ATENCAO_PCT', admin, { valor: '' });
      const b = await z(tB);
      expect(b.geral.zona).toBeNull();
      expect(b.mttr.zona).toBeNull();
      expect(b.zonas.metaOkPct).toBeNull();
      await A.setConfig(US12);
    });
    it('filtro sem OM da prioridade: total 0, pct e zona nulos', async () => {
      const m = await z(tD, '&prioridade=CRITICA');
      expect(m.geral).toMatchObject({ total: 0, pct: null, zona: null });
    });
  });

  describe('reserva expira aos 15 min', () => {
    it('expira só > 15 min; sem marca de recusa; urgente nasce LIBERADA; histórico/auditoria/evento do SISTEMA', async () => {
      A.eventos.length = 0;
      const Z1 = await nova(); await A.call('POST', `/ordens/${Z1}/atribuir`, ger, { tecnicoId: String(tA.id) });
      const Z2 = await nova(true); await A.call('POST', `/ordens/${Z2}/atribuir`, ger, { tecnicoId: String(tB.id) });
      const Z3 = await nova(); await A.call('POST', `/ordens/${Z3}/atribuir`, ger, { tecnicoId: String(tC.id) });
      await A.prisma.$executeRaw`UPDATE ordens_manutencao SET delegado_em = now() - interval '16 minutes' WHERE id IN (${BigInt(Z1)}, ${BigInt(Z2)})`;
      await A.prisma.$executeRaw`UPDATE ordens_manutencao SET delegado_em = now() - interval '14 minutes' WHERE id = ${BigInt(Z3)}`;
      expect(await A.expirarReservas(A.app.log)).toBe(2);
      const get = (id: string) => A.prisma.ordem.findUniqueOrThrow({ where: { id: BigInt(id) } });
      const [z1, z2, z3] = [await get(Z1), await get(Z2), await get(Z3)];
      expect([z1.status, z2.status, z3.status]).toEqual(['ABERTA', 'ABERTA', 'RESERVADA']);
      expect(z3.responsavelId).toBe(tC.id);
      expect(z1).toMatchObject({ responsavelId: null, delegadoPor: null, delegadoEm: null, motivoRecusa: null });
      expect(z1.prazoAtendimento).toBeNull();
      expect(Math.abs(z2.prazoAtendimento!.getTime() - Date.now())).toBeLessThan(20_000);

      const hx = await A.prisma.historicoStatusOrdem.findMany({ where: { ordemId: BigInt(Z1) }, orderBy: { id: 'asc' }, select: { statusNovo: true, usuarioId: true, motivo: true } });
      expect(hx.map((x) => x.statusNovo)).toEqual(['ABERTA', 'RESERVADA', 'ABERTA']);
      expect(hx[2]).toMatchObject({ usuarioId: null, motivo: null });
      const au = await A.prisma.auditoria.findMany({ where: { acao: 'OM_RESERVA_EXPIRADA' } });
      expect(au).toHaveLength(2);
      expect(au.every((a) => a.atorId === null && a.atorPerfil === 'SISTEMA')).toBe(true);
      expect((au[0]!.detalhe as any).minutos).toBe(15);
      const ev = A.eventos.filter((e) => e.tipo === 'om.reserva_expirada');
      expect(ev).toHaveLength(2);
      expect(ev.some((e) => e.tecnicoId === String(tA.id))).toBe(true);

      // fila e fallback para a urgente liberada
      const f = await A.call('GET', '/ordens/fila', tD);
      const c1 = f.b.colunas.ABERTO.find((x: any) => x.id === Z1), c2 = f.b.colunas.ABERTO.find((x: any) => x.id === Z2);
      expect([c1.situacaoAtribuicao, c1.podeAssumir, c2.situacaoAtribuicao, c2.podeAssumir]).toEqual(['PARA_PUXAR', true, 'LIBERADA', true]);
      expect(await A.verificarFallback(A.app.log)).toBe(1);
      expect(A.eventos.some((e) => e.tipo === 'om.liberada' && e.ordemId === Z2)).toBe(true);
      expect((await A.call('POST', `/ordens/${Z2}/assumir`, tD, A.PIN)).s).toBe(200);
      expect((await A.call('POST', `/ordens/${Z1}/assumir`, tB, A.PIN)).s).toBe(200);
      expect(await A.expirarReservas(A.app.log)).toBe(0); // idempotente
    });

    it('prazo editável (validado, só ADMIN) e vale na hora', async () => {
      for (const v of ['0', '1441', 'abc']) expect((await A.call('PUT', '/configuracoes/OM_RESERVA_ACEITE_MIN', admin, { valor: v })).s).toBe(400);
      const Z4 = await nova(); await A.call('POST', `/ordens/${Z4}/atribuir`, ger, { tecnicoId: String(tE.id) });
      await A.prisma.$executeRaw`UPDATE ordens_manutencao SET delegado_em = now() - interval '6 minutes' WHERE id = ${BigInt(Z4)}`;
      expect(await A.expirarReservas(A.app.log)).toBe(0);
      // aviso (10) precisa ser menor que o novo prazo (5): ajusta na ordem correta
      expect((await A.call('PUT', '/configuracoes/OM_RESERVA_AVISO_MIN', admin, { valor: '3' })).s).toBe(200);
      expect((await A.call('PUT', '/configuracoes/OM_RESERVA_ACEITE_MIN', admin, { valor: '5' })).s).toBe(200);
      await A.expirarReservas(A.app.log);
      expect((await A.prisma.ordem.findUniqueOrThrow({ where: { id: BigInt(Z4) } })).status).toBe('ABERTA');
      await A.setConfig(US12);
      expect((await A.call('PUT', '/configuracoes/OM_RESERVA_ACEITE_MIN', ger, { valor: '30' })).s).toBe(403);
    });
  });
});
