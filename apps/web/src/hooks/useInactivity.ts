"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Qualquer interação reinicia a contagem (inclui rolagem e movimento do ponteiro). */
const ATIVIDADE = ["pointerdown", "pointermove", "click", "keydown", "touchstart", "touchmove", "wheel", "scroll", "input"] as const;
/** Durante o aviso só gestos deliberados o cancelam: um mero tremor do mouse não deve esconder o aviso. */
const DELIBERADA = new Set<string>(["pointerdown", "click", "keydown", "touchstart", "input"]);

/**
 * Detecta inatividade. Cada interação (toque, clique, tecla, ponteiro, rolagem) zera a contagem. Após (timeoutMs - warnMs)
 * sem interação `warning` fica true com `remaining` (s); ao chegar em timeoutMs chama onTimeout. Durante o aviso, um gesto
 * deliberado (toque, clique, tecla) ou `reset()` cancelam o aviso.
 */
export function useInactivity(enabled: boolean, timeoutMs: number, warnMs: number, onTimeout: () => void) {
  const last = useRef(Date.now());
  const warningRef = useRef(false);
  const cb = useRef(onTimeout);
  cb.current = onTimeout;
  const [remaining, setRemaining] = useState<number | null>(null);

  const reset = useCallback(() => {
    last.current = Date.now();
    warningRef.current = false;
    setRemaining(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    reset();
    const onActivity = (e: Event) => {
      if (warningRef.current) { if (DELIBERADA.has(e.type)) reset(); }
      else last.current = Date.now();
    };
    // capture: pega também a rolagem de contêineres internos (scroll não borbulha) e eventos com stopPropagation.
    const opts = { passive: true, capture: true } as const;
    ATIVIDADE.forEach((e) => window.addEventListener(e, onActivity, opts));
    const id = setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle >= timeoutMs) {
        clearInterval(id);
        cb.current();
      } else if (warnMs > 0 && idle >= timeoutMs - warnMs) {
        warningRef.current = true;
        setRemaining(Math.ceil((timeoutMs - idle) / 1000));
      }
    }, 250);
    return () => {
      clearInterval(id);
      ATIVIDADE.forEach((e) => window.removeEventListener(e, onActivity, opts));
    };
  }, [enabled, timeoutMs, warnMs, reset]);

  return { warning: remaining !== null, remaining: remaining ?? 0, reset };
}
