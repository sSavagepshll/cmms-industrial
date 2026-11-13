import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';

// Filtros comuns de TODOS os endpoints de métricas (Fase 18) e os trechos de SQL correspondentes.

export const DIA_MS = 86_400_000;
export const MAX_PERIODO_DIAS = 366;
export const PRIORIDADES = ['BAIXA', 'MEDIA', 'ALTA', 'CRITICA'] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

const csv = z.string().optional().transform((v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean));

const schema = z
  .object({
    de: z.coerce.date().optional(),
    ate: z.coerce.date().optional(),
    setor: z.string().trim().min(1).max(100).optional(),
    tecnicoIds: csv.pipe(z.array(z.string().regex(/^\d{1,18}$/, 'id inválido')).max(50)).transform((a) => a.map((x) => BigInt(x))),
    prioridade: csv.pipe(z.array(z.enum(PRIORIDADES)).max(4)),
    tipo: z.enum(['PREVENTIVA', 'CORRETIVA', 'PREDITIVA']).default('CORRETIVA'),
    comparar: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  })
  .transform((q, ctx) => {
    const ate = q.ate ?? new Date();
    const de = q.de ?? new Date(ate.getTime() - 30 * DIA_MS);
    if (de >= ate) ctx.addIssue({ code: 'custom', path: ['de'], message: '"de" deve ser anterior a "ate"' });
    if (ate.getTime() - de.getTime() > MAX_PERIODO_DIAS * DIA_MS) {
      ctx.addIssue({ code: 'custom', path: ['de'], message: `Período máximo de ${MAX_PERIODO_DIAS} dias` });
    }
    // Período anterior: mesma duração, imediatamente antes.
    const anterior = q.comparar ? { de: new Date(de.getTime() - (ate.getTime() - de.getTime())), ate: de } : null;
    return {
      de, ate, anterior,
      setor: q.setor ?? null,
      tecnicoIds: [...new Set(q.tecnicoIds)],
      prioridades: [...new Set(q.prioridade)] as Prioridade[],
      tipo: q.tipo,
      comparar: q.comparar,
    };
  });

export type Filtros = z.infer<typeof schema>;
export const parseFiltros = (query: unknown): Filtros => schema.parse(query);

/** Trechos de SQL para OMs com alias `o` (ordens_manutencao). Valores sempre parametrizados. */
export function trechos(f: Pick<Filtros, 'tecnicoIds' | 'prioridades'>, opts: { tecnico?: boolean } = {}) {
  const tec = opts.tecnico !== false && f.tecnicoIds.length > 0
    ? Prisma.sql`AND o.responsavel_id IN (${Prisma.join(f.tecnicoIds)})` : Prisma.empty;
  const pri = f.prioridades.length > 0
    ? Prisma.sql`AND o.prioridade::text IN (${Prisma.join(f.prioridades)})` : Prisma.empty;
  return { tec, pri };
}

/** Variação percentual (null se não houver base). */
export const variacaoPct = (atual: number | null, anterior: number | null): number | null =>
  atual === null || anterior === null || anterior === 0 ? null : Math.round(((atual - anterior) / anterior) * 1000) / 10;
/** Variação em pontos percentuais (para taxas). */
export const variacaoPp = (atual: number | null, anterior: number | null): number | null =>
  atual === null || anterior === null ? null : Math.round((atual - anterior) * 10) / 10;
export const r1 = (v: number | null | undefined): number | null => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
export const pct = (parte: number, total: number): number | null => (total > 0 ? Math.round((parte / total) * 1000) / 10 : null);

/** Cache curto de 30 s (limpo a cada evento de OM: o cliente invalida pelo SSE e relê dado fresco). */
const TTL_MS = 30_000;
const cache = new Map<string, { em: number; valor: unknown }>();
export const limparCacheMetricas = () => cache.clear();
export async function comCache<T>(chave: string, calc: () => Promise<T>): Promise<T> {
  const c = cache.get(chave);
  if (c && Date.now() - c.em < TTL_MS) return c.valor as T;
  const valor = await calc();
  cache.set(chave, { em: Date.now(), valor });
  if (cache.size > 500) cache.delete(cache.keys().next().value!); // limite de memória
  return valor;
}
/** Chave estável a partir da query string crua (ordenada). */
export const chaveQuery = (rota: string, query: unknown): string =>
  `${rota}|${JSON.stringify(Object.entries((query ?? {}) as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))}`;
