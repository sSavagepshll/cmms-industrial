"use client";
import { useRef, type ReactNode } from "react";
import { Dialogo } from "./Dialogo";
import { Faixa } from "./Faixa";
import { Icone } from "./Icones";
import { btnPerigoCheio, btnPrim, btnSec } from "./estilos";

/**
 * Confirmação com impacto escrito (nunca window.confirm). O foco inicial fica em CANCELAR, Esc cancela e o botão de
 * confirmar só é o vermelho de perigo quando `perigoso` (padrão). Enter no foco inicial = cancelar (o lado seguro).
 */
export function ConfirmarAcao({ titulo, children, rotuloConfirmar, perigoso = true, busy = false, erro, onConfirmar, onCancelar }: {
  titulo: string; children: ReactNode; rotuloConfirmar: string; perigoso?: boolean; busy?: boolean;
  erro?: string | null; onConfirmar: () => void; onCancelar: () => void;
}) {
  const cancelar = useRef<HTMLButtonElement>(null);
  return (
    <Dialogo titulo={titulo} onFechar={onCancelar} travado={busy} largura="max-w-md" focoInicial={cancelar}>
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          {perigoso && <Icone nome="alerta" className="mt-0.5 h-6 w-6 text-danger-fg" />}
          <div className="min-w-0 flex-1 text-base leading-relaxed">{children}</div>
        </div>
        {erro && <Faixa tipo="erro">{erro}</Faixa>}
        <div className="flex justify-end gap-3">
          <button ref={cancelar} type="button" onClick={onCancelar} disabled={busy} className={btnSec}>Cancelar</button>
          <button type="button" onClick={onConfirmar} disabled={busy} className={perigoso ? btnPerigoCheio : btnPrim}>{busy ? "Aguarde…" : rotuloConfirmar}</button>
        </div>
      </div>
    </Dialogo>
  );
}
