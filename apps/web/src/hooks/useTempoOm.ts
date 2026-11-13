"use client";
import { useEffect, useState } from "react";
import type { OmKanban } from "@/lib/types";

/** Tempo líquido vindo do servidor (Fase 8). `since` = instante local em que o valor foi recebido, se o cronômetro roda. */
export function tempoServidor(om: OmKanban): { base: number; since: number | null; rodando: boolean } | null {
  if (om.cronometroAtivo === undefined || om.tempoLiquidoSegundos === undefined) return null;
  return {
    base: om.tempoLiquidoSegundos,
    since: om.cronometroAtivo ? (om.recebidoEm ?? Date.now()) : null,
    rodando: om.cronometroAtivo,
  };
}

export const segundosDe = (t: { base: number; since: number | null }) =>
  t.base + (t.since ? Math.max(0, (Date.now() - t.since) / 1000) : 0);

/** Força re-render a cada segundo enquanto `ativo`. */
export function useTick(ativo: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!ativo) return;
    const id = setInterval(() => setN((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [ativo]);
}
