import { URL_TESTE } from './soft.js';

/**
 * Sobe a API real (Fastify + Prisma) contra o banco de TESTE e devolve utilitários comuns aos testes de integração.
 * O DATABASE_URL precisa ser definido ANTES de importar src/ (config.ts lê o ambiente na importação) — por isso os imports dinâmicos.
 */
export async function criarAmbiente() {
  process.env.DATABASE_URL = URL_TESTE;
  process.env.JWT_SECRET ??= 'integration-test-secret-integration-test-secret-0123456789';
  const { buildApp } = await import('../../src/app.js');
  const { prisma } = await import('../../src/db.js');
  const { hashPin } = await import('../../src/auth/password.js');
  const { assinar } = await import('../../src/events.js');
  const { invalidarPoliticas } = await import('../../src/regras.js');
  const { limparCacheMetricas } = await import('../../src/metricas/filtros.js');
  const fallback = await import('../../src/jobs/fallback.js');

  const app = buildApp();
  await app.ready();
  const eventos: any[] = [];
  assinar((e) => eventos.push(e));

  const limparBanco = async () => {
    await prisma.$executeRaw`TRUNCATE ordens_manutencao, equipamentos, auditoria RESTART IDENTITY CASCADE`;
    await prisma.usuario.deleteMany({ where: { matricula: { startsWith: 'u' } } });
    eventos.length = 0;
  };

  const pin = await hashPin('1234');
  const mk = (nome: string, perfil: any, matricula: string) => prisma.usuario.create({ data: { nome, perfil, matricula, pinHash: pin } });
  const tok = (u: any) => ({ authorization: 'Bearer ' + app.jwt.sign({ sub: String(u.id), perfil: u.perfil, nome: u.nome }) });
  const call = async (m: any, url: string, u: any, payload?: any) => {
    const r = await app.inject({ method: m, url, headers: tok(u), payload });
    let b: any = null;
    try { b = r.body ? JSON.parse(r.body) : null; } catch { b = r.body; }
    return { s: r.statusCode, b, h: r.headers };
  };
  const hist = (id: string | bigint, ant: string | null, novo: string, quando: Date, u: any | null) =>
    prisma.$executeRaw`INSERT INTO historico_status_ordem (ordem_id, status_anterior, status_novo, usuario_id, criado_em) VALUES (${BigInt(id)}, ${ant}::status_ordem, ${novo}::status_ordem, ${u ? u.id : null}, ${quando}::timestamptz)`;
  const setConfig = async (valores: Record<string, string>) => {
    for (const [k, v] of Object.entries(valores)) await prisma.configuracaoGlobal.update({ where: { chave: k }, data: { valor: v } });
    invalidarPoliticas();
    limparCacheMetricas();
  };

  return {
    app, prisma, eventos, call, mk, tok, hist, setConfig, limparBanco, invalidarPoliticas, limparCacheMetricas, ...fallback,
    PIN: { pin: '1234' },
    fechar: async () => { await app.close(); await prisma.$disconnect(); },
  };
}

export type Ambiente = Awaited<ReturnType<typeof criarAmbiente>>;

/** Valores aprovados na US-12 (metas, zonas e reserva 15/10 min). */
export const US12: Record<string, string> = {
  META_MTTA_MIN_CRITICA: '15', META_MTTA_MIN_ALTA: '30', META_MTTA_MIN_MEDIA: '120', META_MTTA_MIN_BAIXA: '240', META_MTTR_MIN: '60',
  ZONA_META_OK_PCT: '95', ZONA_META_ATENCAO_PCT: '85', ZONA_MTTR_ATENCAO_PCT: '120', OM_RESERVA_ACEITE_MIN: '15', OM_RESERVA_AVISO_MIN: '10',
};
