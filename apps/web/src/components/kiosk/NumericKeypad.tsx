"use client";
import { useRef } from "react";
import { useTecladoFisico } from "@/hooks/useTecladoFisico";
import { keyBase } from "./ui";

/** Impede que o clique/toque mova o foco para a tecla: assim o Enter do teclado físico continua chegando ao campo. */
const semFoco = (e: React.MouseEvent) => e.preventDefault();

/**
 * Teclado numérico em tela. Também aceita o teclado físico (0-9, Backspace, Delete = limpar, Enter, vírgula se houver `onDecimal`).
 * E3: "Limpar" isolado em linha própria, com 24px extra de distância das teclas frequentes.
 */
export function NumericKeypad({ onDigit, onBackspace, onClear, onDecimal, onEnter, disabled, fisico = true }: {
  onDigit: (d: string) => void; onBackspace: () => void; onClear: () => void; onDecimal?: () => void;
  /** Enter do teclado físico (ex.: avançar/entrar no login). */
  onEnter?: () => void; disabled?: boolean;
  /** false = não captura o teclado físico. */
  fisico?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useTecladoFisico({
    ativo: fisico && !disabled,
    container: box,
    aceita: (c) => /^\d$/.test(c),
    onChar: onDigit, onBackspace, onClear, onEnter, onDecimal,
  });
  const key = `${keyBase.replace("text-3xl", "text-4xl")} bg-panel ring-1 ring-line`;
  return (
    <div ref={box} role="group" aria-label="Teclado numérico" className="flex flex-col">
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} className={key} disabled={disabled} tabIndex={-1} onMouseDown={semFoco} onClick={() => onDigit(d)}>{d}</button>
        ))}
        {onDecimal ? <button className={key} disabled={disabled} tabIndex={-1} onMouseDown={semFoco} onClick={onDecimal} aria-label="Vírgula">,</button> : <span aria-hidden />}
        <button className={key} disabled={disabled} tabIndex={-1} onMouseDown={semFoco} onClick={() => onDigit("0")}>0</button>
        <button className={key} disabled={disabled} tabIndex={-1} onMouseDown={semFoco} onClick={onBackspace} aria-label="Apagar">⌫</button>
      </div>
      <button disabled={disabled} tabIndex={-1} onMouseDown={semFoco} onClick={onClear}
        className="mt-3 min-h-14 rounded-2xl border-4 border-dashed border-amber-400 bg-ink text-xl font-bold text-amber-800 md:mt-4 md:min-h-tap-md md:text-2xl">
        ✕ Limpar tudo
      </button>
    </div>
  );
}
