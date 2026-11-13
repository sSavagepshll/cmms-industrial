import { Prisma } from './generated/prisma/client.js';

/** Violação de unicidade (P2002 ou 23505 vindo do adapter), inclusive em índices de expressão (lower(nome)). */
export function ehUnico(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return e.code === 'P2002' || JSON.stringify(e.meta ?? {}).includes('23505');
}

/** FK RESTRICT (P2003; 23001/23503 vindos do adapter): corrida com inclusão de filho entre a checagem e o DELETE. */
export function ehFk(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code === 'P2003') return true;
  const m = JSON.stringify(e.meta ?? {});
  return m.includes('23001') || m.includes('23503');
}
