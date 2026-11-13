import { z } from 'zod';

/**
 * Cursor opaco de paginação (keyset): base64url de `{"i":"<id>"}`. Guarda só o id da última linha devolvida; a posição exata
 * (inclusive microssegundos de timestamptz) é resolvida pelo banco via `cursor: { id }` do Prisma, sem perda por arredondamento de Date.
 */
export const codificarCursor = (id: bigint | string | number): string =>
  Buffer.from(JSON.stringify({ i: id.toString() })).toString('base64url');

/** Schema Zod: string opaca -> bigint. Cursor adulterado vira 400 (VALIDACAO). */
export const cursorSchema = z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9_-]+$/, 'cursor inválido').transform((v, ctx) => {
  try {
    const o = JSON.parse(Buffer.from(v, 'base64url').toString('utf8')) as { i?: unknown };
    if (typeof o.i === 'string' && /^\d{1,18}$/.test(o.i)) return BigInt(o.i);
  } catch { /* cai no erro abaixo */ }
  ctx.addIssue({ code: 'custom', message: 'cursor inválido' });
  return z.NEVER;
});

/** Recorta a página (consultamos limit+1) e devolve o cursor da próxima, se houver. */
export function recortarPagina<T extends { id: bigint }>(linhas: T[], limit: number): { itens: T[]; proximo: string | null } {
  const mais = linhas.length > limit;
  const itens = mais ? linhas.slice(0, limit) : linhas;
  const ultimo = itens[itens.length - 1];
  return { itens, proximo: mais && ultimo ? codificarCursor(ultimo.id) : null };
}
