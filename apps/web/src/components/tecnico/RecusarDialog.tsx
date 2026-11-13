"use client";
import { useRef, useState } from "react";
import { ApiError, recusarOm } from "@/lib/api";
import { MOTIVOS_RECUSA } from "@/lib/kanban";
import type { OmKanban } from "@/lib/types";
import { Dialogo } from "../ui/Dialogo";
import { Faixa } from "../ui/Faixa";
import { VirtualKeyboard } from "../kiosk/VirtualKeyboard";
import { btnBase, btnPrimary } from "../kiosk/ui";

const DETALHE_MIN = 5; // a API exige motivo >= 10 caracteres; "Outro: " + 5 já passa
const DETALHE_MAX = 200;

/**
 * Recusa da reserva (US-11.4 cen. 3): motivo obrigatório por BOTÕES (com luva não se digita); "Outro" abre o teclado.
 * A OM volta ao gerente, que é alertado, e NÃO vai para o pull. Alvos de luva (Fase 9): chips 72 px, ações 80/96 px.
 */
export function RecusarDialog({ om, onCancelar, onRecusada }: { om: OmKanban; onCancelar: () => void; onRecusada: () => void }) {
  const [escolha, setEscolha] = useState<(typeof MOTIVOS_RECUSA)[number] | null>(null);
  const [detalhe, setDetalhe] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const cancelar = useRef<HTMLButtonElement>(null);
  const outro = escolha === "Outro";
  const motivo = !escolha ? "" : outro ? `Outro: ${detalhe.trim()}` : escolha;
  const ok = !!escolha && (!outro || detalhe.trim().length >= DETALHE_MIN);

  async function confirmar() {
    if (!ok || busy) return;
    setBusy(true); setErro(null);
    try { await recusarOm(om.id, motivo); onRecusada(); }
    catch (e) { setErro(e instanceof ApiError ? (e.status === 0 ? "Sem conexão com o servidor." : e.message) : "Erro inesperado."); setBusy(false); }
  }

  return (
    <Dialogo titulo={`Recusar ${om.numero}`} onFechar={onCancelar} travado={busy} largura="max-w-2xl" focoInicial={cancelar}>
      <div className="flex flex-col gap-4">
        <p className="text-xl">Por que você está recusando? O gerente será avisado e vai designar outro técnico.</p>
        <div role="group" aria-label="Motivo da recusa" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MOTIVOS_RECUSA.map((m) => (
            <button key={m} type="button" aria-pressed={escolha === m} onClick={() => { setEscolha(m); setErro(null); }}
              className={`min-h-tap-sm rounded-2xl px-4 text-xl font-bold ring-4 ${escolha === m ? "bg-brand-700 text-white ring-fg" : "bg-panel ring-line"}`}>
              {escolha === m ? "✓ " : ""}{m}
            </button>
          ))}
        </div>
        {outro && (
          <div className="flex flex-col gap-3">
            <div className="min-h-16 rounded-xl bg-panel p-3 text-xl ring-2 ring-line">
              {detalhe || <span className="text-muted">Digite o motivo (mínimo {DETALHE_MIN} letras)…</span>}
              <span className="float-right text-lg text-muted">{detalhe.length}/{DETALHE_MAX}</span>
            </div>
            <VirtualKeyboard value={detalhe} onChange={setDetalhe} maxLength={DETALHE_MAX} />
          </div>
        )}
        {erro && <Faixa tipo="erro">{erro}</Faixa>}
        <div className="mt-2 grid grid-cols-1 gap-6 md:grid-cols-2">
          <button ref={cancelar} type="button" onClick={onCancelar} disabled={busy} className={`${btnBase} bg-panel ring-1 ring-line`}>Voltar</button>
          <button type="button" onClick={() => void confirmar()} disabled={!ok || busy} className={`${btnPrimary} bg-red-700 text-white`}>{busy ? "Enviando…" : "Confirmar recusa"}</button>
        </div>
      </div>
    </Dialogo>
  );
}
