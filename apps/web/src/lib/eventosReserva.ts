import type { EventoSse } from "./sse";

/**
 * Eventos de reserva (contrato US-12): o SSE entrega `event: om` com `data` = {tipo, ordemId, numero, statusKanban, tecnicoId?}.
 *  - om.reserva_aviso   : faltam poucos minutos para o aceite (10 min de 15); `tecnicoId` = quem deve ser alertado.
 *  - om.reserva_expirada: a reserva foi desfeita (15 min); `tecnicoId` = quem perdeu a reserva.
 * Qualquer evento de OM continua invalidando a fila; aqui só se extrai o que é pessoal do técnico logado.
 */
export type TipoAvisoReserva = "aviso" | "expirada";
export interface AvisoReserva { tipo: TipoAvisoReserva; numero: string; ordemId: string }

export function avisoParaUsuario(e: EventoSse, userId: string): AvisoReserva | null {
  if (e.event !== "om") return null;
  let d: { tipo?: string; ordemId?: string | number; numero?: string; tecnicoId?: string | number };
  try { d = JSON.parse(e.data); } catch { return null; }
  if (d.tecnicoId === undefined || String(d.tecnicoId) !== String(userId)) return null;
  const tipo = d.tipo === "om.reserva_aviso" ? "aviso" : d.tipo === "om.reserva_expirada" ? "expirada" : null;
  return tipo ? { tipo, numero: d.numero ?? "", ordemId: String(d.ordemId ?? "") } : null;
}
