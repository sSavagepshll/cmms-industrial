import type { ReactNode } from "react";

/**
 * Barra de ações fixa no rodapé (docs/ux/fase17-tema-escuro.md §10, decisão b): nas telas de decisão a ação principal
 * nunca pode exigir rolagem (Fase 9). `sticky bottom-0` sobre `ink`, filete superior, sem sombra no escuro.
 *
 * Deve ser o ÚLTIMO elemento do contêiner rolável: como é sticky e fica no fluxo, a última linha de conteúdo não
 * fica escondida atrás dela. `margem` compensa o padding do contêiner pai para a barra ir de borda a borda:
 *  - "tela": dentro do <main> do `Screen` do totem (p-4 / md:p-6);
 *  - "painel": dentro do overlay do detalhe da OM (p-3 / md:p-4).
 */
export function BarraAcoes({ children, margem = "tela", rotulo = "Ações" }: { children: ReactNode; margem?: "tela" | "painel"; rotulo?: string }) {
  const m = margem === "tela" ? "-mx-4 -mb-4 px-4 md:-mx-6 md:-mb-6 md:px-6" : "-mx-3 -mb-3 px-3 md:-mx-4 md:-mb-4 md:px-4";
  return (
    <div role="group" aria-label={rotulo}
      className={`sticky bottom-0 z-20 mt-auto border-t border-line/40 bg-ink py-3 dark:border-line-soft ${m}`}>
      {children}
    </div>
  );
}
