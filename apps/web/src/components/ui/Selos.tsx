"use client";
import type { ReactNode } from "react";
import { useContagem, tempoCurto } from "@/hooks/useContagem";
import { haQuanto } from "@/lib/kanban";
import type { OmKanban } from "@/lib/types";
import { Icone, type NomeIcone } from "./Icones";

const TONS = {
  brand: "bg-brand-50 text-primary-fg ring-2 ring-primary-fg",
  neutro: "bg-panel text-muted ring-1 ring-line",
  ambar: "bg-amber-100 text-amber-900 ring-2 ring-amber-600",
} as const;

export function Selo({ tom, icone, grande = false, children }: { tom: keyof typeof TONS; icone: NomeIcone; grande?: boolean; children: ReactNode }) {
  return (
    <span className={`flex items-start gap-2 rounded-xl px-3 py-2 font-bold ${grande ? "text-xl" : "text-lg"} ${TONS[tom]}`}>
      <Icone nome={icone} className={grande ? "mt-0.5 h-6 w-6" : "mt-0.5 h-5 w-5"} /><span className="min-w-0 flex-1">{children}</span>
    </span>
  );
}

/**
 * Selo único de distribuição da OM aberta (cartão do Kanban, detalhe e Despacho): reserva, urgente aguardando o gerente,
 * liberada pelo fallback (RN-22) e devolvida pela recusa. Sempre ícone + texto. Os dados vêm do servidor (situacaoAtribuicao).
 */
export function SeloAtribuicao({ om, userId, gestor = false, grande = false }: { om: OmKanban; userId: string; gestor?: boolean; grande?: boolean }) {
  const falta = useContagem(om.situacaoAtribuicao === "URGENTE_AGUARDA_GERENTE" ? om.liberaEmSegundos : undefined);
  const faltaReserva = useContagem(om.situacaoAtribuicao === "RESERVADA" ? om.reservaExpiraEmSegundos ?? undefined : undefined);
  switch (om.situacaoAtribuicao) {
    case "RESERVADA": {
      const paraMim = om.reservadaPara?.id === userId;
      return paraMim ? (
        <Selo tom={om.reservaAvisando ? "ambar" : "brand"} icone={om.reservaAvisando ? "alerta" : "pino"} grande={grande}>
          Reservada para você{om.delegadoPor ? ` · por ${om.delegadoPor.nome}` : ""}{om.delegadoEm ? ` · ${haQuanto(om.delegadoEm)}` : ""}
          {faltaReserva !== null && <span className="block text-base font-semibold tabular-nums">{om.reservaAvisando ? "Aceite agora: " : "Aceite em "}{tempoCurto(faltaReserva)} ou a reserva expira.</span>}
          <span className="block text-base font-semibold">Assuma com o seu PIN ou recuse informando o motivo.</span>
        </Selo>
      ) : (
        <Selo tom="neutro" icone="cadeado" grande={grande}>
          Reservada para {om.reservadaPara?.nome ?? "outro técnico"}{gestor && om.delegadoPor ? ` · por ${om.delegadoPor.nome}` : ""}
          <span className="block text-base font-semibold">Aguardando o aceite dele{faltaReserva !== null && <> · expira em <span className="tabular-nums">{tempoCurto(faltaReserva)}</span></>}.</span>
        </Selo>
      );
    }
    case "URGENTE_AGUARDA_GERENTE":
      return (
        <Selo tom="neutro" icone="cadeado" grande={grande}>
          Urgente · {gestor ? "designe um técnico" : "o gerente vai designar o técnico"}
          {falta !== null && <span className="block text-base font-semibold">Libera para qualquer técnico em {tempoCurto(falta)}.</span>}
        </Selo>
      );
    case "LIBERADA":
      return <Selo tom="ambar" icone="alerta" grande={grande}>Liberada: qualquer técnico pode assumir<span className="block text-base font-semibold">Urgente sem responsável além do prazo.</span></Selo>;
    case "DEVOLVIDA":
      return gestor ? (
        <Selo tom="ambar" icone="alerta" grande={grande}>
          Recusada{om.recusadoPor ? ` por ${om.recusadoPor.nome}` : ""}{om.recusadoEm ? ` · ${haQuanto(om.recusadoEm)}` : ""}
          {om.motivoRecusa && <span className="block text-base font-semibold">Motivo: {om.motivoRecusa}</span>}
        </Selo>
      ) : (
        <Selo tom="neutro" icone="cadeado" grande={grande}>Recusada: aguardando o gerente redelegar</Selo>
      );
    default:
      return null;
  }
}
