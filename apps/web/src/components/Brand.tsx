import type { ReactNode } from "react";
import { EMPRESA } from "@/lib/brand";

/**
 * O logotipo (public/logo-apex.svg, 735x99) é a âncora do design, sobre fundo claro.
 * No tema escuro usa-se public/logo-apex-dark.svg (mesmas dimensões, cinza claro), SEM placa branca.
 * O padding do <span> é FIXO nos dois temas e só uma das imagens é exibida (a outra fica display:none, sem ocupar espaço):
 * trocar de tema não desloca o layout (0 px).
 */
export function Brand({ className = "h-8 sm:h-10", placa = "sm" }: { className?: string; placa?: "sm" | "lg" }) {
  return (
    <span className={`inline-flex rounded-xl ${placa === "lg" ? "px-4 py-2.5" : "px-3 py-1.5"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-apex.svg" alt={EMPRESA} width={735} height={99} className={`w-auto dark:hidden ${className}`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-apex-dark.svg" alt={EMPRESA} width={735} height={99} className={`hidden w-auto dark:inline ${className}`} />
    </span>
  );
}

/** Filete de marca: ~85 % azul + ~15 % vermelho, a mesma proporção cromática do logotipo. */
export function BrandStripe() {
  return (
    <div aria-hidden className="flex h-1.5 w-full">
      <span className="flex-[85] bg-brand-600" />
      <span className="flex-[15] bg-accent" />
    </div>
  );
}

/** Faixa de topo de todas as telas: logo à esquerda, ações/título à direita, filete de marca por baixo. */
export function BrandBar({ children, wide }: { children?: ReactNode; wide?: boolean }) {
  return (
    <div className="sticky top-0 z-30 bg-panel shadow-sm print:hidden">
      <div className={`mx-auto flex w-full ${wide ? "max-w-[1600px]" : "max-w-6xl"} items-center justify-between gap-4 px-4 py-3 md:px-6 md:py-4`}>
        <Brand />
        {children}
      </div>
      <BrandStripe />
    </div>
  );
}
