"use client";
import { useCallback, useSyncExternalStore } from "react";
import { assinarTema, lerPreferencia, salvarPreferencia, type PreferenciaTema, type TemaEfetivo } from "@/lib/tema";

const efetivoAtual = (): TemaEfetivo => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

/**
 * Preferência (auto|claro|escuro) e tema efetivo (light|dark) da página. No servidor assume Auto/claro;
 * o script do <head> já aplicou o tema real antes da hidratação, então só o ícone do botão se ajusta após montar.
 */
export function useTema() {
  const preferencia = useSyncExternalStore(assinarTema, lerPreferencia, (): PreferenciaTema => "auto");
  const efetivo = useSyncExternalStore(assinarTema, efetivoAtual, (): TemaEfetivo => "light");
  const definir = useCallback((p: PreferenciaTema) => salvarPreferencia(p), []);
  return { preferencia, efetivo, definir };
}
