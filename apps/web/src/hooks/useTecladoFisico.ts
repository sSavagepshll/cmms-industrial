"use client";
import { useEffect, useRef, type RefObject } from "react";

interface Opcoes {
  /** Liga/desliga a captura (ex.: desligada enquanto o campo está `disabled`). */
  ativo: boolean;
  /** Elemento do teclado em tela: usado para decidir se Enter pertence a ele (ver abaixo). */
  container: RefObject<HTMLElement | null>;
  /** Devolve true se o caractere digitado é aceito por este teclado. */
  aceita: (c: string) => boolean;
  onChar: (c: string) => void;
  onBackspace: () => void;
  /** Tecla Delete. */
  onClear: () => void;
  onEnter?: () => void;
  /** Vírgula/ponto (campos decimais). */
  onDecimal?: () => void;
}

const CAMPO_NATIVO = "input, textarea, select, [contenteditable='true'], [contenteditable='']";
const INTERATIVO = "button, a, [role='button'], [tabindex]:not([tabindex='-1'])";

/**
 * Faz o teclado em tela (NumericKeypad/VirtualKeyboard) aceitar também o teclado físico do PC.
 * - Escuta `keydown` na janela; ignora quando o foco está num <input>/<textarea> real (que já digita sozinho)
 *   e quando há Ctrl/Alt/Meta (atalhos do navegador).
 * - Backspace apaga, Delete limpa, Enter confirma. Enter só é tratado se nada estiver focado ou se o foco estiver
 *   no próprio teclado, para não sequestrar o Enter de um botão focado por Tab (ex.: "Voltar").
 * - Os handlers ficam em ref: o listener é registrado uma vez e sempre usa a versão mais recente.
 */
export function useTecladoFisico(o: Opcoes) {
  const ref = useRef(o);
  ref.current = o;
  const espacoTratado = useRef(false);

  useEffect(() => {
    if (!o.ativo) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const c = ref.current;
      // AltGr (teclados ABNT2/ISO: /, ?, @...) chega como Ctrl+Alt no Windows: não é atalho.
      const altGr = e.getModifierState?.("AltGraph");
      if (e.defaultPrevented || e.metaKey || e.isComposing || ((e.ctrlKey || e.altKey) && !altGr)) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest?.(CAMPO_NATIVO)) return;

      const livre = !alvo || alvo === document.body || alvo === document.documentElement;
      const noTeclado = !!alvo && !!c.container.current?.contains(alvo);

      // Botão/link/card focado por Tab (fora do teclado em tela): Espaço e Enter pertencem ao navegador (aciona o elemento).
      if ((e.key === " " || e.key === "Enter") && !noTeclado && alvo?.closest?.(INTERATIVO)) return;

      if (e.key === "Backspace") { e.preventDefault(); c.onBackspace(); return; }
      if (e.key === "Delete") { e.preventDefault(); c.onClear(); return; }
      if (e.key === "Enter") {
        if (c.onEnter && (livre || noTeclado)) { e.preventDefault(); c.onEnter(); }
        return;
      }
      if (e.key.length !== 1) return; // setas, Tab, Shift, F-keys... seguem o comportamento normal

      if ((e.key === "," || e.key === ".") && c.onDecimal) { e.preventDefault(); c.onDecimal(); return; }
      if (e.key === " ") {
        // Espaço num botão focado também "clica" o botão (no keyup, em alguns navegadores): cancela os dois.
        if (c.aceita(" ")) { e.preventDefault(); espacoTratado.current = true; c.onChar(" "); }
        return;
      }
      if (c.aceita(e.key)) { e.preventDefault(); c.onChar(e.key); }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && espacoTratado.current) { e.preventDefault(); espacoTratado.current = false; }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [o.ativo]);
}
