"use client";
import { useState } from "react";
import type { ConclusaoOm } from "@/lib/types";
import { btnBase, btnPrimary } from "../kiosk/ui";
import { VirtualKeyboard } from "../kiosk/VirtualKeyboard";

const CAMPOS = [
  { key: "causaRaiz", label: "Causa raiz", max: 100, obrigatorio: true },
  { key: "acaoExecutada", label: "Ação executada", max: 100, obrigatorio: true },
  { key: "parecer", label: "Parecer (opcional)", max: 1000, obrigatorio: false },
] as const;

export function ConcludeForm({ busy, onConfirm, onCancel }: {
  busy: boolean; onConfirm: (c: ConclusaoOm) => void; onCancel: () => void;
}) {
  const [v, setV] = useState<Record<"causaRaiz" | "acaoExecutada" | "parecer", string>>({ causaRaiz: "", acaoExecutada: "", parecer: "" });
  const [ativo, setAtivo] = useState<keyof typeof v>("causaRaiz");
  const max = CAMPOS.find((c) => c.key === ativo)!.max;
  const ok = v.causaRaiz.trim() && v.acaoExecutada.trim();

  return (
    <div role="dialog" aria-modal="true" aria-label="Concluir OM"
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-scrim p-4">
      <div className="w-full max-w-3xl rounded-3xl bg-panel-2 p-4 ring-2 ring-green-500 md:p-6">
        <h2 className="text-2xl font-extrabold md:text-3xl">Finalizar chamado</h2>
        <p className="mt-1 text-lg text-muted">Após enviar, a OM fica <strong>aguardando a aprovação de um supervisor</strong>.</p>
        <div className="mt-4 flex flex-col gap-3">
          {CAMPOS.map((c) => (
            <button key={c.key} onClick={() => setAtivo(c.key)} aria-pressed={ativo === c.key}
              className={`min-h-[72px] rounded-xl bg-ink p-3 text-left text-xl ring-4 ${ativo === c.key ? "ring-primary-fg" : "ring-transparent"}`}>
              <span className="block text-lg text-muted">{c.label}{c.obrigatorio ? " *" : ""}</span>
              {v[c.key] || <span className="text-muted">Toque e digite…</span>}
              <span className="float-right text-lg text-muted">{v[c.key].length}/{c.max}</span>
            </button>
          ))}
        </div>
        <div className="mt-4">
          <VirtualKeyboard value={v[ativo]} onChange={(t) => setV((p) => ({ ...p, [ativo]: t }))} maxLength={max} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={onCancel} disabled={busy} className={`${btnBase} bg-ink ring-1 ring-line`}>Voltar</button>
          <button disabled={busy || !ok} onClick={() => onConfirm({ causaRaiz: v.causaRaiz.trim(), acaoExecutada: v.acaoExecutada.trim(), parecer: v.parecer.trim() || undefined })}
            className={`${btnPrimary} bg-green-700 text-white`}>{busy ? "Enviando…" : "✔ Enviar para aprovação"}</button>
        </div>
      </div>
    </div>
  );
}
