"use client";
import { useRef } from "react";
import { useTecladoFisico } from "@/hooks/useTecladoFisico";

const ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM-"];

/** Impede que o clique/toque mova o foco para a tecla: assim o Enter/Espaço do teclado físico continuam chegando ao campo. */
const semFoco = (e: React.MouseEvent) => e.preventDefault();

/**
 * Teclado QWERTY em tela (OSK): teclas 80px, gap 12px. "Limpar" isolado (ação destrutiva) em linha própria.
 * Também aceita o teclado físico: qualquer caractere imprimível (inclui acentos e minúsculas), Backspace, Delete = limpar.
 */
export function VirtualKeyboard({ value, onChange, maxLength, allowSpace = true, onEnter, fisico = true }: {
  value: string; onChange: (v: string) => void; maxLength?: number; allowSpace?: boolean;
  /** Enter do teclado físico (ex.: buscar). Sem isto, Enter não faz nada. */
  onEnter?: () => void;
  /** false = não captura o teclado físico. */
  fisico?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Valor mais recente, atualizado de forma síncrona: teclas físicas em sequência rápida não perdem caracteres.
  const atual = useRef(value);
  atual.current = value;
  const set = (v: string) => { atual.current = v; onChange(v); };

  const add = (c: string) => {
    if (maxLength === undefined || atual.current.length < maxLength) set(atual.current + c);
  };
  useTecladoFisico({
    ativo: fisico,
    container: box,
    aceita: (c) => (c === " " ? allowSpace : true),
    onChar: add,
    onBackspace: () => set(atual.current.slice(0, -1)),
    onClear: () => set(""),
    onEnter,
  });

  // Largura FLUIDA: cada tecla ocupa 1/10 da linha (descontados os vãos) e encolhe com o contêiner (modal estreito ou tela pequena),
  // sem largura mínima fixa. O tamanho do texto e a altura acompanham a largura do próprio teclado (container queries), não a da janela.
  const base = "min-w-0 select-none rounded-xl bg-panel px-0 font-bold ring-1 ring-line";
  const key = `${base} basis-[calc((100%_-_9*var(--g))_/_10)] shrink-0 grow-0 min-h-14 text-lg @sm:min-h-14 @sm:text-xl @lg:min-h-14 @lg:text-2xl @2xl:min-h-tap-md @2xl:text-3xl`;
  const keySm = `${base} min-h-14 text-lg @sm:min-h-14 @sm:text-xl @lg:min-h-14 @2xl:min-h-tap-md @2xl:text-2xl`;
  return (
    <div ref={box} className="@container w-full min-w-0 max-w-full" role="group" aria-label="Teclado virtual">
     <div className="flex w-full min-w-0 flex-col gap-1.5 [--g:0.25rem] @sm:gap-2 @sm:[--g:0.5rem] @2xl:gap-3 @2xl:[--g:0.75rem]">
      {ROWS.map((row) => (
        <div key={row} className="flex w-full justify-center gap-[var(--g)]">
          {row.split("").map((c) => (
            <button key={c} className={key} tabIndex={-1} onMouseDown={semFoco} onClick={() => add(c)}>{c}</button>
          ))}
        </div>
      ))}
      <div className="flex w-full gap-[var(--g)]">
        {allowSpace && <button className={`${keySm} flex-[4]`} tabIndex={-1} onMouseDown={semFoco} onClick={() => add(" ")}>espaço</button>}
        <button className={`${keySm} flex-[2]`} tabIndex={-1} onMouseDown={semFoco} onClick={() => set(atual.current.slice(0, -1))} aria-label="Apagar">⌫</button>
      </div>
      <button className="mt-2 min-h-14 max-w-full self-end rounded-xl border-4 border-dashed border-amber-400 bg-ink px-4 text-lg font-bold text-amber-800 @sm:min-h-14 @sm:px-6 @sm:text-xl @2xl:min-h-tap-md @2xl:px-8 @2xl:text-2xl"
        tabIndex={-1} onMouseDown={semFoco} onClick={() => set("")}>✕ Limpar tudo</button>
     </div>
    </div>
  );
}
