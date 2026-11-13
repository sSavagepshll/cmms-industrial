import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { Icone, type NomeIcone } from "./Icones";

export type VarianteBotao = "primario" | "secundario" | "perigo" | "perigo-cheio" | "sucesso" | "alerta" | "fantasma";
export type TamanhoBotao = "auto" | "totem" | "toque" | "compacto";

const K = "[[data-app=kiosk]_&]";

// Variantes só com tokens (docs/ui/primitivos-e-stepper-totem.md §2.2). `active` escurece o fundo além da escala (feedback com luva);
// `hover` só onde há ponteiro de verdade.
const VARIANTE: Record<VarianteBotao, string> = {
  primario: `bg-primary text-primary-on ${K}:ring-(length:--ring-totem) ${K}:ring-primary-edge active:brightness-90`,
  secundario: "bg-panel text-fg ring-(length:--ring-repouso) ring-line active:bg-primary-soft [@media(hover:hover)]:hover:bg-primary-soft",
  sucesso: "bg-ok text-white active:brightness-90 [@media(hover:hover)]:hover:brightness-110",
  alerta: "bg-warn text-black active:brightness-90 [@media(hover:hover)]:hover:brightness-105",
  perigo: "bg-panel text-danger-fg ring-(length:--ring-destaque) ring-danger-fg active:bg-danger-soft [@media(hover:hover)]:hover:bg-danger-soft",
  "perigo-cheio": "bg-danger text-white active:brightness-90 [@media(hover:hover)]:hover:brightness-110",
  fantasma: "bg-transparent text-muted active:bg-primary-soft [@media(hover:hover)]:hover:bg-primary-soft",
};

// `auto` resolve pelo contêiner: Totem = toque; Admin e demais = compacto.
const TAMANHO: Record<TamanhoBotao, string> = {
  totem: "min-h-tap-lg min-w-tap-lg rounded-card px-5 text-title font-extrabold md:px-8",
  toque: "min-h-tap-md min-w-tap-md rounded-card px-4 text-lead font-bold md:px-6",
  compacto: "min-h-tap-min min-w-tap-min rounded-ctrl px-5 text-body font-semibold",
  auto: `min-h-tap-min min-w-tap-min rounded-ctrl px-5 text-body font-semibold ${K}:min-h-tap-md ${K}:min-w-tap-md ${K}:rounded-card ${K}:px-4 ${K}:text-lead ${K}:font-bold md:${K}:px-6`,
};

const BASE = "cursor-pointer disabled:cursor-not-allowed relative inline-flex items-center justify-center gap-2 text-center transition-[transform,filter,background-color] duration-(--duration-rapida) ease-saida active:scale-[0.97] disabled:opacity-40 aria-disabled:opacity-50";

/** Classes de um botão (para <a>, Link ou quando o elemento não pode ser <Botao>). Também alimentam os aliases deprecated. */
export function classesBotao(variante: VarianteBotao = "secundario", tamanho: TamanhoBotao = "auto", bloco = false): string {
  return `${BASE} ${VARIANTE[variante]} ${TAMANHO[tamanho]}${bloco ? " w-full" : ""}`;
}

type Base = {
  variante?: VarianteBotao; tamanho?: TamanhoBotao; icone?: NomeIcone; posicaoIcone?: "inicio" | "fim";
  /** Mostra "Aguarde…", bloqueia o clique e mantém a largura do rótulo. */
  carregando?: boolean; bloco?: boolean;
  /** `aria-disabled` + opacidade, mas ainda recebe o clique (a tela valida e mostra o motivo). */
  desabilitadoSuave?: boolean; children?: ReactNode;
};
type PropsBotao = Base & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { href?: undefined };
type PropsLink = Base & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children"> & { href: string };

/**
 * Botão único (Totem, Técnico, Admin). Textos, `aria-*` e ordem do DOM são os do chamador: o primitivo só cuida de forma, tamanho e estado.
 * Com `href` renderiza <a> com o mesmo visual.
 */
export function Botao(props: PropsBotao | PropsLink) {
  const { variante = "secundario", tamanho = "auto", icone, posicaoIcone = "inicio", carregando = false, bloco = false, desabilitadoSuave = false, children, className = "", ...resto } = props;
  const cls = `${classesBotao(variante, tamanho, bloco)} ${className}`.trim();
  const miolo = (
    <>
      {icone && posicaoIcone === "inicio" && <Icone nome={icone} />}
      {carregando ? (
        <span className="grid"><span className="invisible col-start-1 row-start-1">{children}</span><span className="col-start-1 row-start-1">Aguarde…</span></span>
      ) : children}
      {icone && posicaoIcone === "fim" && <Icone nome={icone} />}
    </>
  );
  if (props.href !== undefined) {
    const { href, ...a } = resto as AnchorHTMLAttributes<HTMLAnchorElement>;
    return <a href={href} className={cls} aria-busy={carregando || undefined} {...a}>{miolo}</a>;
  }
  const { onClick, disabled, type = "button", ...b } = resto as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={type} className={cls} disabled={disabled} aria-busy={carregando || undefined} aria-disabled={desabilitadoSuave || carregando || undefined}
      onClick={(e) => { if (carregando) { e.preventDefault(); return; } onClick?.(e); }} {...b}>
      {miolo}
    </button>
  );
}
