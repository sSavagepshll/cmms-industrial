"use client";
import { useEffect, useRef, useState } from "react";
import { useTema } from "@/hooks/useTema";
import { ROTULO_TEMA, type PreferenciaTema } from "@/lib/tema";
import { Icone } from "./Icones";

/**
 * TOTEM, só na tela de repouso (não no meio do fluxo do operador: evita toque acidental com luva e alvo extra nas
 * telas de decisão). 80x80 px, alterna Claro <-> Escuro; "Auto" fica no Kanban/Admin. Mostra o ícone do tema ATUAL.
 */
export function BotaoTemaTotem({ aoAlternar }: { aoAlternar?: (efetivo: "light" | "dark") => boolean } = {}) {
  const { preferencia, efetivo, definir } = useTema();
  const escuro = efetivo === "dark";
  return (
    // aoAlternar: tema do totem gerenciado por configuração (exceção temporária); devolve false => preferência do dispositivo
    <button type="button" onClick={() => { if (!aoAlternar?.(efetivo)) definir(escuro ? "claro" : "escuro"); }}
      aria-label={`Tema: ${ROTULO_TEMA[preferencia]}. Tocar para mudar para ${escuro ? "Claro" : "Escuro"}`}
      className="grid h-20 w-20 place-items-center rounded-2xl bg-panel-2 text-fg ring-2 ring-line">
      <Icone nome={escuro ? "lua" : "sol"} className="h-9 w-9" />
    </button>
  );
}

const OPCOES: PreferenciaTema[] = ["auto", "claro", "escuro"];

/** KANBAN e PAINEL ADMIN: botão de ícone de 44 px com menu Auto · Claro · Escuro (opção ativa com ✓). */
export function MenuTema() {
  const { preferencia, efetivo, definir } = useTema();
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setAberto(false); botao.current?.focus(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const itens = [...(raiz.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
        const i = itens.indexOf(document.activeElement as HTMLElement);
        itens[(i + (e.key === "ArrowDown" ? 1 : itens.length - 1)) % itens.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    raiz.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", tecla); };
  }, [aberto]);

  return (
    <div ref={raiz} className="relative">
      <button ref={botao} type="button" onClick={() => setAberto((a) => !a)} aria-haspopup="menu" aria-expanded={aberto}
        aria-label={`Tema: ${ROTULO_TEMA[preferencia]}`}
        className="grid h-11 w-11 place-items-center rounded-xl bg-panel text-fg ring-1 ring-line hover:bg-primary-soft [[data-app=kiosk]_&]:h-14 [[data-app=kiosk]_&]:w-14">
        <Icone nome={efetivo === "dark" ? "lua" : "sol"} />
      </button>
      {aberto && (
        <div role="menu" aria-label="Tema" className="absolute right-0 top-full z-40 mt-2 w-44 rounded-xl bg-panel-2 p-1 shadow-xl ring-1 ring-line">
          {OPCOES.map((o) => (
            <button key={o} type="button" role="menuitemradio" aria-checked={preferencia === o}
              onClick={() => { definir(o); setAberto(false); botao.current?.focus(); }}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left font-semibold text-fg hover:bg-primary-soft [[data-app=kiosk]_&]:min-h-14">
              <span className="grid h-5 w-5 place-items-center">{preferencia === o && <Icone nome="check" className="h-5 w-5" />}</span>
              {ROTULO_TEMA[o]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
