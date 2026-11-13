import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

// Barramento em memória (instância única). Com várias instâncias da API, trocar por Postgres LISTEN/NOTIFY ou Redis pub/sub.
export type TipoEvento =
  | 'om.criada'
  | 'om.assumida'
  | 'om.delegada'
  | 'om.delegacao_cancelada'
  | 'om.recusada'
  | 'om.liberada'
  | 'om.reserva_aviso'
  | 'om.reserva_expirada'
  | 'om.play'
  | 'om.pause'
  | 'om.concluida'
  | 'om.aprovada'
  | 'om.encerrada' // conclusão final pelo gestor (AGUARDANDO_BAIXA -> CONCLUIDA); 'om.concluida' é a finalização técnica
  | 'om.reprovada'
  | 'om.nota'
  | 'om.material'
  | 'om.apontamento'
  | 'om.teste';

export interface EventoOm {
  tipo: TipoEvento;
  ordemId: string;
  numero?: string;
  statusKanban?: string;
  tecnicoId?: string; // técnico alvo (delegação/recusa): a UI destaca para ele
  em: string; // ISO
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

/** Payload propositalmente mínimo (sem dados sensíveis): o cliente refaz GET /ordens/fila. */
export function publicar(e: Omit<EventoOm, 'em' | 'ordemId'> & { ordemId: bigint | string }): void {
  bus.emit('om', { ...e, ordemId: e.ordemId.toString(), em: new Date().toISOString() } satisfies EventoOm);
}

export function assinar(fn: (e: EventoOm) => void): () => void {
  bus.on('om', fn);
  return () => bus.off('om', fn);
}

// ---- Tickets de uso único para o EventSource (que não envia header Authorization) ----
const TTL_MS = 30_000;
const MAX_TICKETS = 5_000;
const tickets = new Map<string, { sub: string; exp: number; tid?: string; sessaoExp?: number }>();

/** `tid`/`sessaoExp`: sessão de totem (Device ID e fim absoluto do JWT, em segundos epoch). O stream herda os dois. */
export function emitirTicket(sub: string, vinculo?: { tid?: string; sessaoExp?: number }): { ticket: string; expiraEmSegundos: number } {
  const agora = Date.now();
  if (tickets.size >= MAX_TICKETS) {
    for (const [k, v] of tickets) if (v.exp <= agora) tickets.delete(k);
    if (tickets.size >= MAX_TICKETS) throw new Error('tickets_excedidos');
  }
  const ticket = randomBytes(24).toString('base64url');
  tickets.set(ticket, { sub, exp: agora + TTL_MS, ...(vinculo?.tid !== undefined && { tid: vinculo.tid }), ...(vinculo?.sessaoExp !== undefined && { sessaoExp: vinculo.sessaoExp }) });
  return { ticket, expiraEmSegundos: TTL_MS / 1000 };
}

/** Consome (uso único). Retorna o usuário (e o vínculo de totem, se houver) ou null. */
export function consumirTicket(ticket: string): { sub: string; tid?: string; sessaoExp?: number } | null {
  const t = tickets.get(ticket);
  tickets.delete(ticket);
  if (!t || t.exp <= Date.now()) return null;
  return { sub: t.sub, ...(t.tid !== undefined && { tid: t.tid }), ...(t.sessaoExp !== undefined && { sessaoExp: t.sessaoExp }) };
}
