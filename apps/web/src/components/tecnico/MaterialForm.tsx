"use client";
import { useState } from "react";
import { ApiError, adicionarMaterial } from "@/lib/api";
import { NumericKeypad } from "../kiosk/NumericKeypad";
import { VirtualKeyboard } from "../kiosk/VirtualKeyboard";
import { btnBase, btnPrimary } from "../kiosk/ui";

const UNIDADES = ["UN", "PC", "PAR", "JG", "KG", "M", "L", "CX"];
type Campo = "qtde" | "descricao";

function Check({ marcado, onChange, titulo, dica }: { marcado: boolean; onChange: (v: boolean) => void; titulo: string; dica: string }) {
  return (
    <button role="checkbox" aria-checked={marcado} onClick={() => onChange(!marcado)}
      className="flex min-h-16 items-center gap-4 rounded-2xl bg-ink p-3 text-left ring-1 ring-line md:min-h-tap-md">
      <span aria-hidden className={`grid h-14 w-14 shrink-0 place-items-center rounded-lg border-4 text-3xl font-black ${marcado ? "border-white bg-green-700 text-white" : "border-slate-300"}`}>{marcado ? "✓" : ""}</span>
      <span><span className="block text-xl font-bold md:text-2xl">{titulo}</span><span className="block text-lg text-muted">{dica}</span></span>
    </button>
  );
}

/** Material do verso do formulário: QDE, UNIDADE, DESCRIÇÃO, INTER. (flagInterno) e CONF. N.F. (confNf). */
export function MaterialForm({ omId, onSaved, onCancel }: { omId: string; onSaved: () => void; onCancel: () => void }) {
  const [qtde, setQtde] = useState("");
  const [un, setUn] = useState("UN");
  const [desc, setDesc] = useState("");
  const [interno, setInterno] = useState(false);
  const [confNf, setConfNf] = useState(false);
  const [ativo, setAtivo] = useState<Campo>("qtde");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const numero = Number(qtde.replace(",", "."));
  const qtdeOk = qtde !== "" && Number.isFinite(numero) && numero > 0;
  const ok = qtdeOk && desc.trim().length > 0;

  const digitar = (d: string) => setQtde((q) => {
    const dec = q.split(",")[1];
    return q.length < 10 && (dec === undefined || dec.length < 3) ? q + d : q;
  });
  const virgula = () => setQtde((q) => (q === "" ? "0," : q.includes(",") ? q : q + ","));

  async function salvar() {
    setBusy(true); setErro(null);
    try {
      await adicionarMaterial(omId, { descricao: desc.trim(), quantidade: numero, unidade: un, flagInterno: interno, confNf });
      onSaved();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Erro inesperado.");
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Adicionar material"
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-scrim p-3 md:p-4">
      <div className="w-full max-w-3xl rounded-3xl bg-panel-2 p-4 ring-2 ring-primary-fg md:p-6">
        <h2 className="text-2xl font-extrabold md:text-3xl">Adicionar material</h2>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
          <button onClick={() => setAtivo("qtde")} aria-pressed={ativo === "qtde"}
            className={`min-h-16 rounded-xl bg-ink p-3 text-left ring-4 ${ativo === "qtde" ? "ring-primary-fg" : "ring-transparent"}`}>
            <span className="block text-lg text-muted">Qtde *</span>
            <span className="font-mono text-3xl font-bold tabular-nums">{qtde || <span className="text-xl font-normal text-muted">0</span>}</span>
          </button>
          <button onClick={() => setAtivo("descricao")} aria-pressed={ativo === "descricao"}
            className={`min-h-16 rounded-xl bg-ink p-3 text-left ring-4 ${ativo === "descricao" ? "ring-primary-fg" : "ring-transparent"}`}>
            <span className="block text-lg text-muted">Descrição * ({desc.length}/200)</span>
            <span className="text-2xl font-bold">{desc || <span className="text-xl font-normal text-muted">Toque e digite…</span>}</span>
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 md:gap-3" role="group" aria-label="Unidade">
          {UNIDADES.map((u) => (
            <button key={u} aria-pressed={un === u} onClick={() => setUn(u)}
              className={`min-h-14 min-w-16 rounded-xl px-4 text-xl font-bold ring-2 md:min-h-tap-sm ${un === u ? "bg-brand-700 text-white ring-fg" : "bg-ink ring-line"}`}>{un === u ? "✓ " : ""}{u}</button>
          ))}
        </div>

        <div className="mt-4">
          {ativo === "qtde"
            ? <div className="mx-auto max-w-md"><NumericKeypad onDigit={digitar} onDecimal={virgula} onBackspace={() => setQtde((q) => q.slice(0, -1))} onClear={() => setQtde("")} /></div>
            : <VirtualKeyboard value={desc} onChange={setDesc} maxLength={200} />}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Check marcado={interno} onChange={setInterno} titulo="Interno" dica="Material do estoque interno" />
          <Check marcado={confNf} onChange={setConfNf} titulo="Conf. N.F." dica="Nota fiscal conferida" />
        </div>

        {erro && <p role="alert" className="mt-3 rounded-xl bg-red-700 text-white p-3 text-xl font-semibold">{erro}</p>}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={onCancel} disabled={busy} className={`${btnBase} bg-ink ring-1 ring-line`}>Cancelar</button>
          <button disabled={busy || !ok} onClick={salvar} className={`${btnPrimary} bg-green-700 text-white`}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
