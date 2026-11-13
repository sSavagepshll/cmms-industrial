import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db.js';
import { DUMMY_HASH, verifyPin } from './password.js';
import { limparFalhas, registrarFalha, segundosBloqueado } from './lockout.js';

export interface FalhaPin { status: number; body: { error: string; message: string; retryAfterSegundos?: number }; retryAfter?: number }

/**
 * Reconfirma o PIN do PRÓPRIO usuário logado (aceite de OM, aprovação, reprovação).
 * Usa o mesmo contador de falhas do login (chave = matrícula): essas rotas não viram atalho de força bruta,
 * e o PIN errado nunca é logado. Retorna null quando o PIN confere.
 */
export async function confirmarPin(userId: bigint, pin: string, log: FastifyBaseLogger): Promise<FalhaPin | null> {
  const u = await prisma.usuario.findUnique({ where: { id: userId }, select: { matricula: true, pinHash: true, ativo: true } });
  if (!u?.ativo) return { status: 403, body: { error: 'ACESSO_NEGADO', message: 'Usuário inativo.' } };
  const chave = u.matricula ?? `id:${userId}`;
  const espera = segundosBloqueado(chave);
  if (espera > 0) {
    return {
      status: 429, retryAfter: espera,
      body: { error: 'CONTA_BLOQUEADA_TEMPORARIAMENTE', message: 'Muitas tentativas de PIN. Aguarde para tentar novamente.', retryAfterSegundos: espera },
    };
  }
  // Sempre roda um scrypt (real ou dummy): tempo de resposta uniforme.
  const ok = await verifyPin(pin, u.pinHash ?? DUMMY_HASH);
  if (!u.pinHash || !ok) {
    registrarFalha(chave);
    log.warn({ evento: 'pin_confirmacao_falhou', usuarioId: userId.toString() });
    return { status: 401, body: { error: 'PIN_INVALIDO', message: 'PIN incorreto.' } };
  }
  limparFalhas(chave);
  return null;
}
