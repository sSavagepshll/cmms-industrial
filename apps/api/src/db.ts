import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { config } from './config.js';

export const prisma = new PrismaClient({
  // timezone=UTC na sessão: o adapter envia timestamptz sem offset; se o servidor estiver em outro fuso
  // (ex.: Postgres instalado no Windows em America/Sao_Paulo) os instantes seriam gravados deslocados.
  adapter: new PrismaPg({ connectionString: config.DATABASE_URL, options: '-c timezone=UTC' }),
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Executa `fn` numa transação em que `app.usuario_id` está definido (V004: o trigger de histórico de
 * status lê esse valor). set_config(..., true) equivale a SET LOCAL (vale só até o fim da transação,
 * não vaza para outras requisições do pool) e aceita parâmetro, ao contrário de SET LOCAL.
 * TODA escrita que altere ordens_manutencao.status deve passar por aqui.
 */
export async function comUsuario<T>(usuarioId: bigint | string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.usuario_id', ${usuarioId.toString()}, true)`;
    return fn(tx);
  });
}

/** Status em que a OM ainda está "em aberto" (RN-04 e contadores). AGUARDANDO_APROVACAO só encerra com o aceite do supervisor. */
export const STATUS_ATIVOS = ['ABERTA', 'RESERVADA', 'EM_ANDAMENTO', 'PAUSADA', 'AGUARDANDO_PECA', 'AGUARDANDO_APROVACAO'] as const;
