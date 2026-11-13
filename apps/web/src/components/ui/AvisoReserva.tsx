"use client";
import type { AvisoReserva as Aviso } from "@/lib/eventosReserva";
import { Faixa } from "./Faixa";

/** Faixa de aviso pessoal do técnico: reserva prestes a expirar ou já expirada (SSE om.reserva_aviso / om.reserva_expirada). */
export function AvisoReserva({ aviso, onFechar, grande = false }: { aviso: Aviso | null; onFechar: () => void; grande?: boolean }) {
  if (!aviso) return null;
  const aviso10 = aviso.tipo === "aviso";
  return (
    <div className="flex flex-wrap items-center gap-3" data-aviso-reserva={aviso.tipo}>
      <Faixa tipo={aviso10 ? "atencao" : "info"} className={`min-w-0 flex-1 ${grande ? "text-xl md:text-2xl" : ""}`}>
        {aviso10
          ? <>Sua reserva da OM <strong className="tabular-nums">{aviso.numero}</strong> expira em breve: aceite com o seu PIN ou recuse informando o motivo.</>
          : <>A reserva da OM <strong className="tabular-nums">{aviso.numero}</strong> expirou e a OM voltou para a fila.</>}
      </Faixa>
      <button onClick={onFechar} className={`rounded-xl bg-panel px-4 font-bold ring-2 ring-line ${grande ? "min-h-20 text-2xl" : "min-h-12 text-lg"}`}>Entendi</button>
    </div>
  );
}
