import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, US12, type Ambiente } from '../helpers/ambiente.js';

/**
 * US-12 (definição final): "Retrabalho" = estritamente REPROVAÇÃO (AGUARDANDO_APROVACAO -> EM_ANDAMENTO).
 * O enum status_ordem não tem o valor REPROVADA; a reprovação é a transição registrada em historico_status_ordem.
 * Taxa = reprovações ÷ entradas em AGUARDANDO_APROVACAO. Retomar de PAUSADA / AGUARDANDO_PECA NÃO é retrabalho. CANCELADA fica fora.
 */
describe('retrabalho = reprovação', () => {
  let A: Ambiente;
  let oper: any, ger: any, tA: any, tB: any, eq: any;
  const t0 = () => new Date(Date.now() - 3600_000);
  const at = (min: number) => new Date(t0().getTime() + min * 60_000);

  const nova = async () =>
    (await A.call('POST', '/ordens', oper, { equipamentoId: String(eq.id), maquinaParada: false, categoria: 'MECANICO', sintomas: ['x'], tipoAtivo: 'MAQUINA', custoTipo: 'INTERNO', confirmarDuplicidade: true })).b.id as string;
  /** OM com histórico totalmente controlado pelo teste (o trigger de status é apagado depois do UPDATE). */
  const omComHistorico = async (tec: any, status: string, passos: [string | null, string, number][]) => {
    const id = await nova();
    const fim = status === 'CANCELADA' ? null : at(40);
    await A.prisma.$executeRaw`UPDATE ordens_manutencao SET status = ${status}::status_ordem, responsavel_id = ${tec.id}, data_abertura = ${at(0)}::timestamptz, data_inicio = ${at(5)}::timestamptz, data_conclusao = ${fim}::timestamptz WHERE id = ${BigInt(id)}`;
    await A.prisma.$executeRaw`DELETE FROM historico_status_ordem WHERE ordem_id = ${BigInt(id)}`;
    for (const [ant, novo, min] of passos) await A.hist(id, ant, novo, at(min), tec);
    return id;
  };
  const kpis = async (tec: any) => {
    A.limparCacheMetricas();
    const q = `de=${new Date(Date.now() - 86_400_000).toISOString()}&ate=${new Date(Date.now() + 3600_000).toISOString()}&tecnicoIds=${tec.id}`;
    const r = await A.call('GET', `/metricas/kpis?${q}`, ger);
    expect(r.s).toBe(200);
    return r.b.kpis.retrabalhoPct;
  };

  beforeAll(async () => {
    A = await criarAmbiente();
    await A.limparBanco();
    await A.setConfig(US12);
    oper = await A.mk('Oper R', 'OPERADOR', 'u1');
    ger = await A.mk('Gerente R', 'GERENTE', 'u2');
    tA = await A.mk('Tec RA', 'TECNICO', 'u3');
    tB = await A.mk('Tec RB', 'TECNICO', 'u4');
    eq = await A.prisma.equipamento.create({ data: { codigo: 'R-01', nome: 'Maq R', setor: 'Unico' } });
  });
  afterAll(async () => { await A.fechar(); });

  it('sem nenhuma entrada em aprovação a taxa é nula (não 0%)', async () => {
    const k = await kpis(tA);
    expect(k.valor).toBeNull();
  });

  it('pausa e espera de peça NÃO contam como retrabalho', async () => {
    await omComHistorico(tA, 'CONCLUIDA', [
      [null, 'ABERTA', 0], ['ABERTA', 'EM_ANDAMENTO', 5],
      ['EM_ANDAMENTO', 'PAUSADA', 10], ['PAUSADA', 'EM_ANDAMENTO', 20],
      ['EM_ANDAMENTO', 'AGUARDANDO_PECA', 25], ['AGUARDANDO_PECA', 'EM_ANDAMENTO', 35],
      ['EM_ANDAMENTO', 'AGUARDANDO_APROVACAO', 40], ['AGUARDANDO_APROVACAO', 'CONCLUIDA', 45],
    ]);
    const k = await kpis(tA);
    expect(k.valor).toBe(0); // 0 reprovações ÷ 1 entrada
  });

  it('só a reprovação conta: 1 reprovação em 3 entradas = 33,3%', async () => {
    await omComHistorico(tA, 'CONCLUIDA', [
      [null, 'ABERTA', 0], ['ABERTA', 'EM_ANDAMENTO', 5],
      ['EM_ANDAMENTO', 'AGUARDANDO_APROVACAO', 10], ['AGUARDANDO_APROVACAO', 'EM_ANDAMENTO', 15], // reprovada
      ['EM_ANDAMENTO', 'AGUARDANDO_APROVACAO', 20], ['AGUARDANDO_APROVACAO', 'CONCLUIDA', 25],
    ]);
    const k = await kpis(tA);
    expect(k.valor).toBe(33.3); // 1 ÷ (1 + 2)
  });

  it('OM cancelada não entra, mesmo com reprovação no histórico', async () => {
    await omComHistorico(tA, 'CANCELADA', [
      [null, 'ABERTA', 0], ['ABERTA', 'EM_ANDAMENTO', 5],
      ['EM_ANDAMENTO', 'AGUARDANDO_APROVACAO', 10], ['AGUARDANDO_APROVACAO', 'EM_ANDAMENTO', 15], ['EM_ANDAMENTO', 'CANCELADA', 20],
    ]);
    const k = await kpis(tA);
    expect(k.valor).toBe(33.3);
  });

  it('reprovação feita pela API (POST /reprovar) entra na taxa e é isolada por técnico', async () => {
    const id = await nova();
    expect((await A.call('POST', `/ordens/${id}/assumir`, tB, A.PIN)).s).toBe(200);
    await A.prisma.$executeRaw`UPDATE ordens_manutencao SET status = 'AGUARDANDO_APROVACAO', data_conclusao = now() WHERE id = ${BigInt(id)}`;
    const r = await A.call('POST', `/ordens/${id}/reprovar`, oper, { ...A.PIN, motivo: 'Vazamento persiste' });
    expect(r.s).toBe(200);
    const h = await A.prisma.historicoStatusOrdem.findMany({ where: { ordemId: BigInt(id) }, orderBy: { id: 'asc' }, select: { statusAnterior: true, statusNovo: true } });
    expect(h.some((x) => x.statusAnterior === 'AGUARDANDO_APROVACAO' && x.statusNovo === 'EM_ANDAMENTO')).toBe(true);

    const kb = await kpis(tB);
    expect(kb.valor).toBe(100); // 1 reprovação ÷ 1 entrada
    const ka = await kpis(tA);
    expect(ka.valor).toBe(33.3); // Tec A não muda
  });

  it('/metricas/equipe usa a mesma definição (com amostra mínima)', async () => {
    A.limparCacheMetricas();
    const q = `de=${new Date(Date.now() - 86_400_000).toISOString()}&ate=${new Date(Date.now() + 3600_000).toISOString()}&tecnicoIds=${tB.id}`;
    const r = await A.call('GET', `/metricas/equipe?${q}`, ger);
    expect(r.s).toBe(200);
    const t = r.b.tecnicos.find((x: any) => x.id === String(tB.id));
    expect(t).toBeTruthy();
    // amostra insuficiente (1 entrada): a taxa individual não é divulgada, para não punir com n pequeno
    expect(t.periodo.retrabalhoPct).toBeNull();
  });
});
