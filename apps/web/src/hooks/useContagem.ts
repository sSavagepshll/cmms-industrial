"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Contagem regressiva local a partir de um valor do servidor (ex.: liberaEmSegundos, aprovaEmSegundos).
 * Devolve os segundos restantes (>= 0) ou null se não há contagem. Recomeça quando o valor recebido muda
 * (cada atualização da fila/SSE traz o valor corrigido). `aoZerar` dispara uma vez ao chegar a 0.
 */
export function useContagem(segundos: number | undefined | null, aoZerar?: () => void): number | null {
  // O instante final é fixado já na renderização em que o valor chega (senão a 1ª leitura sairia 0 até o 1º tique).
  const ref = useRef<{ valor: number; fim: number } | null>(null);
  if (typeof segundos === "number" && ref.current?.valor !== segundos) ref.current = { valor: segundos, fim: Date.now() + segundos * 1000 };
  const zerou = useRef(false);
  const cb = useRef(aoZerar);
  cb.current = aoZerar;
  const [, tick] = useState(0);

  useEffect(() => {
    zerou.current = false;
    if (typeof segundos !== "number" || segundos <= 0) return;
    const id = setInterval(() => {
      tick((n) => n + 1);
      if (ref.current && Date.now() >= ref.current.fim) { clearInterval(id); if (!zerou.current) { zerou.current = true; cb.current?.(); } }
    }, 1000);
    return () => clearInterval(id);
  }, [segundos]);

  if (typeof segundos !== "number" || !ref.current) return null;
  return Math.max(0, Math.ceil((ref.current.fim - Date.now()) / 1000));
}

/** "12 min" / "3:05" / "45 s": curto, para selos e botões. */
export function tempoCurto(seg: number): string {
  const s = Math.max(0, Math.ceil(seg));
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  if (s >= 120) return `${Math.ceil(s / 60)} min`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
