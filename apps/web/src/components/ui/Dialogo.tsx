"use client";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { Icone } from "./Icones";

const FOCAVEL = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Diálogos abertos (o último é o do topo): só ele reage a Esc e Tab, para diálogo sobre diálogo (ex.: confirmação). */
const pilha: symbol[] = [];

// Safari e Firefox no Mac NÃO focam um botão ao clicar nele: então `document.activeElement` seria o <body> e o foco
// não voltaria ao botão que abriu o diálogo. Guardamos o último alvo de clique como origem alternativa.
let ultimoAlvo: Element | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => {
    ultimoAlvo = (e.target as Element | null)?.closest?.('button, a[href], input, select, textarea, [role="button"], [tabindex]') ?? null;
  }, true);
}
const origemDoFoco = (): Element | null => {
  if (typeof document === "undefined") return null;
  const a = document.activeElement;
  return a && a !== document.body ? a : ultimoAlvo;
};

/**
 * Diálogo modal compartilhado (Admin): Esc fecha, clique no fundo fecha (se não estiver `travado`, ex.: salvando),
 * Tab fica preso dentro dele e o foco volta ao elemento de origem ao fechar. Renderiza num portal no <body>.
 * `focoInicial`: elemento que recebe o foco ao abrir (confirmações focam em Cancelar); sem ele, vale o `autoFocus`
 * de um campo interno ou o primeiro controle.
 */
const LARGURA: Record<string, string> = { sm: "max-w-modal-sm", md: "max-w-modal-md", lg: "max-w-modal-lg" };
const TOM_ARO = { padrao: "ring-1 ring-black/10", alerta: "ring-(length:--ring-totem) ring-warn-fg", perigo: "ring-(length:--ring-destaque) ring-danger-fg" } as const;

export function Dialogo({ titulo, onFechar, travado = false, largura = "max-w-lg", focoInicial, rodape, tom = "padrao", variante, papel = "dialog", fecharPorFundo = true, semCabecalho = false, children }: {
  titulo: string; onFechar: () => void; travado?: boolean; focoInicial?: RefObject<HTMLElement | null>;
  /** "sm" | "md" | "lg" (tokens `--container-modal-*`) ou uma classe `max-w-*` (comportamento anterior). */
  largura?: "sm" | "md" | "lg" | (string & {});
  /** Aro (e ícone no cabeçalho) por tom. */
  tom?: "padrao" | "alerta" | "perigo";
  /** Padrão: derivada de `[data-app="kiosk"]`. No Totem o título e o Fechar crescem para alvo de luva. */
  variante?: "painel" | "totem";
  /** `alertdialog` para avisos de sessão e duplicidade. */
  papel?: "dialog" | "alertdialog";
  /** false se há texto digitado: o toque no fundo não fecha. */
  fecharPorFundo?: boolean;
  /** Sem título/Fechar visíveis (o `titulo` segue como aria-label): usado pelo alias `Modal` do Totem, que traz o próprio cabeçalho no conteúdo. */
  semCabecalho?: boolean;
  /** Ações sempre visíveis (fixas na base); o corpo é que rola (Fase 33). */
  rodape?: ReactNode; children: ReactNode;
}) {
  useVisualViewport();
  // Lido na 1ª renderização, antes de qualquer autoFocus do conteúdo.
  const origem = useRef<Element | null>(origemDoFoco());
  const caixa = useRef<HTMLDivElement>(null);
  const atual = useRef({ onFechar, travado });
  atual.current = { onFechar, travado };

  useEffect(() => {
    const eu = Symbol("dialogo");
    pilha.push(eu);
    if (focoInicial?.current) focoInicial.current.focus();
    else if (!caixa.current?.contains(document.activeElement)) caixa.current?.querySelector<HTMLElement>(FOCAVEL)?.focus();

    const tecla = (e: KeyboardEvent) => {
      if (pilha[pilha.length - 1] !== eu) return;
      if (e.key === "Escape") {
        if (!atual.current.travado) { e.preventDefault(); atual.current.onFechar(); }
        return;
      }
      if (e.key === "Tab" && caixa.current) {
        const itens = [...caixa.current.querySelectorAll<HTMLElement>(FOCAVEL)].filter((el) => el.offsetParent !== null);
        if (itens.length === 0) { e.preventDefault(); return; }
        const primeiro = itens[0], ultimo = itens[itens.length - 1];
        if (e.shiftKey && (document.activeElement === primeiro || !caixa.current.contains(document.activeElement))) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && (document.activeElement === ultimo || !caixa.current.contains(document.activeElement))) { e.preventDefault(); primeiro.focus(); }
      }
    };
    window.addEventListener("keydown", tecla);
    return () => {
      window.removeEventListener("keydown", tecla);
      pilha.splice(pilha.indexOf(eu), 1);
      (origem.current as HTMLElement | null)?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === "undefined") return null;
  // Portal dentro da área do app ([data-app="kiosk"|"admin"]): no <body> o diálogo perderia o CSS escopado do totem.
  const raiz = document.querySelector("[data-app]") ?? document.body;
  const totem = (variante ?? (raiz instanceof HTMLElement && raiz.dataset.app === "kiosk" ? "totem" : "painel")) === "totem";
  const larg = LARGURA[largura] ?? largura;
  return createPortal(
    // Contrato único (Fase 33, RN-66): a caixa cabe em dvh (ou no visualViewport com teclado nativo), cabeçalho e rodapé fixos, corpo rola;
    // < 640 px vira bottom sheet.
    <div className={`fixed inset-0 z-50 flex items-end justify-center overscroll-contain bg-scrim sm:items-center ${totem ? "sm:p-6" : "sm:p-4"}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !travado && fecharPorFundo) onFechar(); }}>
      <div ref={caixa} role={papel} aria-modal="true" aria-label={titulo}
        className={`flex max-h-[calc(var(--vvh,100dvh)-0.5rem)] w-full min-w-0 flex-col rounded-t-sheet bg-panel-2 text-fg shadow-xl ${TOM_ARO[tom]} sm:max-h-[calc(var(--vvh,100dvh)-2rem)] sm:rounded-sheet ${larg}`}>
        {!semCabecalho && (
          <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-6">
            <h2 className={`flex min-w-0 items-center gap-2 break-words font-extrabold ${totem ? "text-title" : "text-xl"}`}>
              {tom !== "padrao" && <span aria-hidden className={tom === "alerta" ? "text-warn-fg" : "text-danger-fg"}><Icone nome="alerta" /></span>}
              {titulo}
            </h2>
            <button type="button" onClick={onFechar} disabled={travado} aria-label="Fechar"
              className={`grid shrink-0 place-items-center text-muted disabled:opacity-40 active:bg-primary-soft [@media(hover:hover)]:hover:bg-brand-50 ${totem ? "min-h-14 min-w-14 rounded-card" : "min-h-11 min-w-11 rounded-ctrl"}`}><Icone nome="fechar" /></button>
          </div>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${semCabecalho ? "p-card-md md:p-card-lg" : "px-4 pb-4 pt-4 sm:px-6 sm:pb-6"}`}>{children}</div>
        {rodape && <div className="safe-b shrink-0 border-t border-line/40 px-4 pt-3 sm:px-6">{rodape}</div>}
      </div>
    </div>,
    raiz,
  );
}
