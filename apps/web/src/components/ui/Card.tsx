import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { Icone } from "./Icones";

export type VarianteCard = "estatico" | "interativo" | "selecionavel" | "metrica";
export type TomCard = "neutro" | "destaque" | "alerta" | "perigo" | "ok";

const ESPACO = { sm: "p-card-sm", md: "p-card-md", lg: "p-card-lg" } as const;
const BORDA = {
  repouso: "ring-(length:--ring-repouso) ring-line",
  destaque: "ring-(length:--ring-destaque) ring-line",
  totem: "ring-(length:--ring-totem) ring-primary-edge",
} as const;
// O tom só colore a borda lateral (4 px); o texto/ícone do chamador carrega o significado (nunca só cor).
const TOM: Record<TomCard, string> = {
  neutro: "", destaque: "border-l-4 border-primary-fg", alerta: "border-l-4 border-warn-fg", perigo: "border-l-4 border-danger-fg", ok: "border-l-4 border-ok-fg",
};

type Props = Omit<HTMLAttributes<HTMLElement>, "onClick"> & {
  como?: ElementType; variante?: VarianteCard; tom?: TomCard; espaco?: keyof typeof ESPACO;
  /** Só em `selecionavel` (aria-pressed + ✓: o estado não depende só da cor). */
  selecionado?: boolean; borda?: keyof typeof BORDA; onClick?: () => void; href?: string; children?: ReactNode;
};

/** Cartão único: raio, ring e padding vêm de tokens (docs/ui/primitivos-e-stepper-totem.md §4). */
export function Card({ como, variante = "estatico", tom = "neutro", espaco = "md", selecionado = false, borda, className = "", children, onClick, href, ...resto }: Props) {
  const interativo = variante === "interativo" || variante === "selecionavel";
  const Tag: ElementType = como ?? (href ? "a" : interativo ? "button" : "div");
  const b = borda ?? (interativo ? "destaque" : "repouso");
  const fundo = variante === "selecionavel" && selecionado ? "bg-primary text-primary-on" : "bg-panel text-fg";
  const cls = `relative block min-w-0 rounded-card ${fundo} ${ESPACO[espaco]} ring-primary-edge ${BORDA[b]} ${TOM[tom]} ${
    interativo ? "cursor-pointer disabled:cursor-not-allowed min-h-tap-md w-full text-left transition-[transform,filter] duration-(--duration-rapida) ease-saida active:scale-[0.98] active:brightness-90" : ""} ${className}`.trim();
  const extra = Tag === "button" ? { type: "button" as const } : {};
  return (
    <Tag className={cls} onClick={onClick} href={href} aria-pressed={variante === "selecionavel" ? selecionado : undefined} {...extra} {...resto}>
      {variante === "selecionavel" && selecionado && <span aria-hidden className="absolute right-3 top-3"><Icone nome="check" /></span>}
      {children}
    </Tag>
  );
}

Card.Cabecalho = function CardCabecalho({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mb-2 flex items-center gap-2 ${className}`.trim()}>{children}</div>;
};
Card.Corpo = function CardCorpo({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`min-w-0 ${className}`.trim()}>{children}</div>;
};
Card.Rodape = function CardRodape({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mt-3 flex items-center gap-2 border-t border-line-soft pt-3 ${className}`.trim()}>{children}</div>;
};
