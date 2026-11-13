"use client";
import { useRef, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { Dialogo } from "./Dialogo";
import { Faixa } from "./Faixa";
import { btnPerigoCheio, btnPrim, btnSec, campo } from "./estilos";
import { NumericKeypad } from "../kiosk/NumericKeypad";
import { btnBase, btnPrimary } from "../kiosk/ui";

/**
 * Pede o PIN do PRÓPRIO usuário logado antes de uma ação sensível (assumir OM, aprovar, reprovar).
 * O PIN só existe no estado deste diálogo: é enviado na ação e descartado, nunca guardado nem exibido.
 * `onConfirmar` deve lançar ApiError se a ação falhar; PIN errado limpa o campo e mantém o diálogo aberto.
 * modo "totem": teclado numérico grande (luva) que também aceita o teclado físico. modo "admin": campo de senha.
 */
export function PedirPin({ titulo, children, rotuloConfirmar, modo, perigoso = false, bloqueado = false, onConfirmar, onCancelar }: {
  titulo: string; children?: ReactNode; rotuloConfirmar: string; modo: "totem" | "admin"; perigoso?: boolean;
  /** true = confirmar desabilitado mesmo com PIN válido (ex.: campo obrigatório do chamador ainda vazio). */
  bloqueado?: boolean;
  onConfirmar: (pin: string) => Promise<void>; onCancelar: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  const totem = modo === "totem";
  const pronto = /^\d{4,6}$/.test(pin) && !bloqueado;

  async function confirmar() {
    if (!pronto || busy) return;
    setBusy(true); setErro(null);
    try {
      await onConfirmar(pin);
    } catch (e) {
      if (e instanceof ApiError && e.code === "PIN_INVALIDO") { setErro("PIN incorreto. Tente novamente."); setPin(""); }
      else if (e instanceof ApiError && e.status === 429) {
        const s = (e.body as { retryAfterSegundos?: number } | undefined)?.retryAfterSegundos;
        setErro(`Muitas tentativas de PIN.${s ? ` Aguarde ${s} s para tentar de novo.` : " Aguarde para tentar de novo."}`); setPin("");
      }
      else setErro(e instanceof ApiError ? (e.status === 0 ? "Sem conexão com o servidor." : e.message) : "Erro inesperado.");
      setBusy(false);
      requestAnimationFrame(() => campoRef.current?.focus());
    }
  }

  const botaoConfirmar = perigoso ? btnPerigoCheio : btnPrim;
  return (
    <Dialogo titulo={titulo} onFechar={onCancelar} travado={busy} largura={totem ? "max-w-xl" : "max-w-md"}>
      <div className="flex flex-col gap-4">
        {children && <div className={totem ? "text-xl" : "text-base"}>{children}</div>}
        <p className={`font-semibold ${totem ? "text-2xl" : ""}`}>Digite o seu PIN para confirmar.</p>

        {totem ? (
          <>
            <div aria-live="polite" aria-label={`PIN com ${pin.length} dígitos`}
              className={`flex min-h-16 items-center justify-center rounded-2xl bg-panel text-4xl font-bold tracking-[0.4em] ring-4 ${erro ? "ring-danger-fg" : "ring-line"}`}>
              {pin ? "●".repeat(pin.length) : <span className="text-xl font-normal tracking-normal text-muted">PIN (4 a 6 dígitos)</span>}
            </div>
            {erro && <Faixa tipo="erro">{erro}</Faixa>}
            <div className="mx-auto w-full max-w-sm">
              <NumericKeypad disabled={busy} onDigit={(d) => { setErro(null); setPin((p) => (p.length < 6 ? p + d : p)); }}
                onBackspace={() => setPin((p) => p.slice(0, -1))} onClear={() => setPin("")} onEnter={() => void confirmar()} />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-6 md:grid-cols-2">
              <button type="button" onClick={onCancelar} disabled={busy} className={`${btnBase} bg-panel ring-1 ring-line`}>Cancelar</button>
              <button type="button" onClick={() => void confirmar()} disabled={!pronto || busy} className={`${btnPrimary} ${perigoso ? "bg-red-700" : "bg-brand-600"} text-white`}>{busy ? "Verificando…" : rotuloConfirmar}</button>
            </div>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void confirmar(); }} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1"><span className="font-semibold">PIN</span>
              <input ref={campoRef} autoFocus type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={pin}
                onChange={(e) => { setErro(null); setPin(e.target.value.replace(/\D/g, "")); }} disabled={busy}
                aria-invalid={!!erro} className={`${campo} ${erro ? "ring-danger-fg" : ""}`} /></label>
            {erro && <Faixa tipo="erro">{erro}</Faixa>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={onCancelar} disabled={busy} className={btnSec}>Cancelar</button>
              <button type="submit" disabled={!pronto || busy} className={botaoConfirmar}>{busy ? "Verificando…" : rotuloConfirmar}</button>
            </div>
          </form>
        )}
      </div>
    </Dialogo>
  );
}
