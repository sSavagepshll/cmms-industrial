import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, US12, type Ambiente } from '../helpers/ambiente.js';

/** US-12 (definição final): aviso prévio da RESERVA_SEM_ACEITE aos 10 min (faltando 5 para expirar aos 15). */
describe('aviso prévio da reserva sem aceite (10 min) e expiração (15 min)', () => {
  let A: Ambiente;
  let oper: any, ger: any, tA: any, tB: any, eq: any, admin: any;

  const nova = async (urgente = false) =>
    (await A.call('POST', '/ordens', oper, { equipamentoId: String(eq.id), maquinaParada: urgente, categoria: 'MECANICO', sintomas: ['x'], tipoAtivo: 'MAQUINA', custoTipo: 'INTERNO', confirmarDuplicidade: true })).b.id as string;
  const reservar = async (tec: any) => { const id = await nova(); const r = await A.call('POST', `/ordens/${id}/atribuir`, ger, { tecnicoId: String(tec.id) }); expect(r.s).toBe(200); return id; };
  const idade = (id: string, min: number) => A.prisma.$executeRaw`UPDATE ordens_manutencao SET delegado_em = now() - make_interval(mins => ${min}) WHERE id = ${BigInt(id)}`;
  const avisos = () => A.eventos.filter((e) => e.tipo === 'om.reserva_aviso');

  beforeAll(async () => {
    A = await criarAmbiente();
    await A.limparBanco();
    await A.setConfig(US12);
    oper = await A.mk('Oper U', 'OPERADOR', 'u1');
    ger = await A.mk('Gerente U', 'GERENTE', 'u2');
    tA = await A.mk('Tec A', 'TECNICO', 'u3');
    tB = await A.mk('Tec B', 'TECNICO', 'u4');
    admin = await A.prisma.usuario.findFirstOrThrow({ where: { email: 'admin@om.com.br' } });
    eq = await A.prisma.equipamento.create({ data: { codigo: 'U-01', nome: 'Maq U', setor: 'Unico' } });
  });
  afterAll(async () => { await A.setConfig(US12); await A.fechar(); });

  it('padrões gravados: aviso 10 min, prazo de aceite 15 min', async () => {
    const cfg = await A.call('GET', '/configuracoes', admin);
    const val = (k: string) => cfg.b.find((x: any) => x.chave === k)?.valor;
    expect(val('OM_RESERVA_AVISO_MIN')).toBe('10');
    expect(val('OM_RESERVA_ACEITE_MIN')).toBe('15');
  });

  it('antes dos 10 min não avisa; aos 10 min avisa uma única vez (claim atômico)', async () => {
    const id = await reservar(tA);
    await idade(id, 9);
    expect(await A.avisarReservas(A.app.log)).toBe(0);
    expect(avisos()).toHaveLength(0);

    await idade(id, 10);
    expect(await A.avisarReservas(A.app.log)).toBe(1);
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0]).toMatchObject({ ordemId: id, tecnicoId: String(tA.id) });

    // rodadas seguintes (job a cada 30 s) não repetem
    expect(await A.avisarReservas(A.app.log)).toBe(0);
    await idade(id, 12);
    expect(await A.avisarReservas(A.app.log)).toBe(0);
    expect(avisos()).toHaveLength(1);
    const om = await A.prisma.ordem.findUniqueOrThrow({ where: { id: BigInt(id) } });
    expect(om.reservaAvisoEm).not.toBeNull();
    expect(om.status).toBe('RESERVADA'); // aviso não expira nada
  });

  it('chamadas concorrentes do job avisam só uma vez', async () => {
    A.eventos.length = 0;
    const id = await reservar(tB);
    await idade(id, 11);
    const r = await Promise.all([A.avisarReservas(A.app.log), A.avisarReservas(A.app.log), A.avisarReservas(A.app.log)]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(1);
    expect(avisos().filter((e) => e.ordemId === id)).toHaveLength(1);
  });

  it('reatribuição abre nova reserva e novo aviso', async () => {
    A.eventos.length = 0;
    const id = await reservar(tA);
    await idade(id, 11);
    expect(await A.avisarReservas(A.app.log)).toBe(1);
    // gerente troca o técnico: delegado_em volta a "agora"
    const sem = await A.call('POST', `/ordens/${id}/atribuir`, ger, { tecnicoId: String(tB.id) });
    expect(sem.s).toBe(400); // reatribuição exige motivo
    const r = await A.call('POST', `/ordens/${id}/atribuir`, ger, { tecnicoId: String(tB.id), motivo: 'Tec A em outra frente' });
    expect(r.s).toBe(200);
    expect(await A.avisarReservas(A.app.log)).toBe(0); // reserva nova, ainda com ~0 min
    // "viaja no tempo" a reserva nova: o aviso antigo (da reserva anterior) também fica no passado, como seria de fato
    await A.prisma.$executeRaw`UPDATE ordens_manutencao SET delegado_em = now() - interval '10 minutes', reserva_aviso_em = now() - interval '20 minutes' WHERE id = ${BigInt(id)}`;
    expect(await A.avisarReservas(A.app.log)).toBe(1);
    const ev = avisos().filter((e) => e.ordemId === id);
    expect(ev).toHaveLength(2);
    expect(ev[1]).toMatchObject({ tecnicoId: String(tB.id) });
  });

  it('reserva já expirada (≥15 min) não é avisada: o job de expiração a devolve ao pull', async () => {
    A.eventos.length = 0;
    const id = await reservar(tA);
    await idade(id, 16);
    expect(await A.avisarReservas(A.app.log)).toBe(0);
    expect(avisos()).toHaveLength(0);
    expect(await A.expirarReservas(A.app.log)).toBeGreaterThanOrEqual(1);
    expect((await A.prisma.ordem.findUniqueOrThrow({ where: { id: BigInt(id) } })).status).toBe('ABERTA');
  });

  it('reserva aceita (assumida) deixa de ser candidata a aviso', async () => {
    A.eventos.length = 0;
    const id = await reservar(tA);
    await idade(id, 11);
    const r = await A.call('POST', `/ordens/${id}/assumir`, tA, A.PIN);
    expect(r.s).toBe(200);
    expect(await A.avisarReservas(A.app.log)).toBe(0);
    expect(avisos().filter((e) => e.ordemId === id)).toHaveLength(0);
  });

  it('fila: cards RESERVADA trazem reservaExpiraEmSegundos e reservaAvisando (só após 10 min)', async () => {
    const cedo = await reservar(tA);
    await idade(cedo, 4);
    const tarde = await reservar(tA);
    await idade(tarde, 11);
    const f = await A.call('GET', '/ordens/fila', tA);
    const col = f.b.colunas.ABERTO as any[];
    const c1 = col.find((x) => x.id === cedo), c2 = col.find((x) => x.id === tarde);
    expect(c1.situacaoAtribuicao).toBe('RESERVADA');
    expect(c1.reservaAvisando).toBe(false);
    expect(c1.reservaExpiraEmSegundos).toBeGreaterThan(10 * 60);
    expect(c1.reservaExpiraEmSegundos).toBeLessThanOrEqual(11 * 60);
    expect(c2.reservaAvisando).toBe(true);
    expect(c2.reservaExpiraEmSegundos).toBeGreaterThan(0);
    expect(c2.reservaExpiraEmSegundos).toBeLessThanOrEqual(4 * 60);
  });

  it('/metricas/atencao: RESERVA_SEM_ACEITE entra aos 10 min, com expiraEmSegundos', async () => {
    const a = await reservar(tA);
    await idade(a, 9);
    const b = await reservar(tB);
    await idade(b, 11);
    A.limparCacheMetricas();
    const r = await A.call('GET', '/metricas/atencao', ger);
    expect(r.s).toBe(200);
    const itens = r.b.itens as any[];
    expect(itens.some((x) => x.id === a && x.tipo === 'RESERVA_SEM_ACEITE')).toBe(false);
    const item = itens.find((x) => x.id === b && x.tipo === 'RESERVA_SEM_ACEITE');
    expect(item).toBeTruthy();
    expect(item.expiraEmSegundos).toBeGreaterThan(0);
    expect(item.expiraEmSegundos).toBeLessThanOrEqual(4 * 60);
  });

  it('parâmetros: aviso deve ser menor que o prazo de aceite (validação cruzada, em ambos os sentidos)', async () => {
    expect((await A.call('PUT', '/configuracoes/OM_RESERVA_AVISO_MIN', admin, { valor: '15' })).s).toBe(400);
    expect((await A.call('PUT', '/configuracoes/OM_RESERVA_AVISO_MIN', admin, { valor: '20' })).s).toBe(400);
    expect((await A.call('PUT', '/configuracoes/OM_RESERVA_ACEITE_MIN', admin, { valor: '10' })).s).toBe(400);
    expect((await A.call('PUT', '/configuracoes/OM_RESERVA_ACEITE_MIN', admin, { valor: '5' })).s).toBe(400);
    expect((await A.call('PUT', '/configuracoes/OM_RESERVA_AVISO_MIN', admin, { valor: '0' })).s).toBe(400);
    // ordem correta de ajuste: primeiro o aviso, depois o prazo
    expect((await A.call('PUT', '/configuracoes/OM_RESERVA_AVISO_MIN', admin, { valor: '3' })).s).toBe(200);
    expect((await A.call('PUT', '/configuracoes/OM_RESERVA_ACEITE_MIN', admin, { valor: '5' })).s).toBe(200);
    // novo prazo vale na hora: reserva de 3 min já está na janela de aviso (3..5)
    const id = await reservar(tA);
    await idade(id, 3);
    A.eventos.length = 0;
    expect(await A.avisarReservas(A.app.log)).toBeGreaterThanOrEqual(1);
    expect(avisos().some((e) => e.ordemId === id)).toBe(true);
    await A.setConfig(US12);
  });

  it('GERENTE não altera o parâmetro (403)', async () => {
    expect((await A.call('PUT', '/configuracoes/OM_RESERVA_AVISO_MIN', ger, { valor: '8' })).s).toBe(403);
  });
});
