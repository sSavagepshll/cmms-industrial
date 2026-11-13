import type { Prisma } from './generated/prisma/client.js';
import type { prisma } from './db.js';

// Trilha de auditoria (RN-25). Regra de ouro: NUNCA gravar PIN, senha, token nem valor de segredo.
// Os chamadores já passam só metadados; `limpar` é a rede de segurança caso alguém inclua um campo sensível.
const PROIBIDO = /pin|senha|secret|segredo|token|pass|hash|authorization|cookie|jwt|apikey|api_key|credential|credencial|private_key|chave_privada|__proto__|constructor|prototype/i;
const CARACTERES_CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function limpar(v: unknown, prof = 0): Prisma.InputJsonValue | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v.replace(CARACTERES_CONTROLE, '').slice(0, 500);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (prof >= 4) return null;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => limpar(x, prof + 1)) as Prisma.InputJsonArray;
  if (typeof v === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (PROIBIDO.test(k)) continue; // descarta campos sensíveis
      out[k] = limpar(val, prof + 1);
    }
    return out as Prisma.InputJsonObject;
  }
  return null;
}

export interface EntradaAuditoria {
  atorId: bigint | null; // null = sistema (ex.: fallback)
  atorPerfil?: string | null;
  acao: string;
  alvoTipo: 'USUARIO' | 'OM' | 'PARAMETRO' | 'SETOR' | 'EQUIPAMENTO' | 'GRUPO_ATIVO';
  alvoId: string | bigint;
  emNomeDe?: bigint | null;
  detalhe?: Record<string, unknown>;
}

/** Aceita o client ou uma transação (assim a auditoria entra na mesma transação da ação). */
export async function auditar(db: Pick<typeof prisma, 'auditoria'>, e: EntradaAuditoria): Promise<void> {
  const detalhe = e.detalhe ? limpar(e.detalhe) : null;
  await db.auditoria.create({
    data: {
      atorId: e.atorId,
      atorPerfil: e.atorPerfil ?? null,
      acao: e.acao,
      alvoTipo: e.alvoTipo,
      alvoId: e.alvoId.toString(),
      emNomeDe: e.emNomeDe ?? null,
      ...(detalhe !== null && { detalhe }),
    },
  });
}
