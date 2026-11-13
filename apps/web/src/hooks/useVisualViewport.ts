"use client";
import { useEffect } from "react";

/**
 * Teclado nativo (celular/tablet): publica a altura visível em --vvh e mantém o campo focado à vista (RN-64).
 * Use em modais com formulário: max-h-[calc(var(--vvh,100dvh)-1rem)].
 */
export function useVisualViewport(ativo = true) {
  useEffect(() => {
    if (!ativo || typeof window === "undefined") return;
    const vv = window.visualViewport;
    const raiz = document.documentElement;
    const aplicar = () => { if (vv) raiz.style.setProperty("--vvh", `${vv.height}px`); };
    const visivel = () => {
      const a = document.activeElement as HTMLElement | null;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    const aoMudar = () => { aplicar(); visivel(); };
    aplicar();
    vv?.addEventListener("resize", aoMudar);
    document.addEventListener("focusin", visivel);
    return () => {
      vv?.removeEventListener("resize", aoMudar);
      document.removeEventListener("focusin", visivel);
      raiz.style.removeProperty("--vvh");
    };
  }, [ativo]);
}
