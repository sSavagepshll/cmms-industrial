"use client";
import { useState } from "react";
import { MOTIVOS } from "@/lib/kanban";
import type { MotivoPausa } from "@/lib/types";
import { btnBase, btnPrimary } from "../kiosk/ui";
import { VirtualKeyboard } from "../kiosk/VirtualKeyboard";

export function PauseModal({ busy, onConfirm, onCancel }: {
  busy: boolean; onConfirm: (m: MotivoPausa, detalhe?: string) => void; onCancel: () => void;
}) {
  const [motivo, setMotivo] = useState<MotivoPausa | null>(null);
  const [detalhe, setDetalhe] = useState("");
  const precisaDetalhe = motivo === "OUTRO";

  return (
    <div role="dialog" aria-modal="true" aria-label="Motivo da pausa"
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-scrim p-4">
      <div className="w-full max-w-3xl rounded-3xl bg-panel-2 p-4 ring-2 ring-amber-400 md:p-6">
        <h2 className="text-2xl font-extrabold md:text-3xl">Por que está pausando?</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MOTIVOS.map((m) => (
            <button key={m.key} aria-pressed={motivo === m.key} onClick={() => setMotivo(m.key)}
              className={`min-h-tap-md rounded-2xl text-2xl font-bold ring-4 ${motivo === m.key ? "bg-amber-500 text-black ring-fg" : "bg-ink ring-transparent"}`}>
              {motivo === m.key ? "✓ " : ""}{m.icon} {m.label}
            </button>
          ))}
        </div>
        {precisaDetalhe && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="min-h-[64px] rounded-xl bg-ink p-3 text-xl ring-1 ring-line">
              {detalhe || <span className="text-muted">Descreva o motivo (obrigatório)</span>}
              <span className="float-right text-lg text-muted">{detalhe.length}/250</span>
            </div>
            <VirtualKeyboard value={detalhe} onChange={setDetalhe} maxLength={250} />
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={onCancel} disabled={busy} className={`${btnBase} bg-ink ring-1 ring-line`}>Cancelar</button>
          <button disabled={busy || !motivo || (precisaDetalhe && !detalhe.trim())}
            onClick={() => motivo && onConfirm(motivo, detalhe.trim() || undefined)}
            className={`${btnPrimary} bg-amber-500 text-black`}>{busy ? "Pausando…" : "⏸ Confirmar pausa"}</button>
        </div>
      </div>
    </div>
  );
}
