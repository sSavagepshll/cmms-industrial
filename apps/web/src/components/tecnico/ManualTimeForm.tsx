"use client";
import { useState } from "react";
import { ApiError, lancarTempoManual } from "@/lib/api";
import { OBS_MAX } from "@/lib/constants";
import { MASK_DATA, MASK_HORA, dataEmDigitos, horasDecimais, lerData, lerHora, mascarar, montar } from "@/lib/datetime";
import { NumericKeypad } from "../kiosk/NumericKeypad";
import { VirtualKeyboard } from "../kiosk/VirtualKeyboard";
import { btnBase, btnPrimary } from "../kiosk/ui";

type Campo = "data" | "inicio" | "fim" | "obs";
const TAM = { data: 8, inicio: 4, fim: 4 } as const;

/** Lançamento retroativo/manual: Data, Início, Fim e Obs - as colunas da tabela "Horas trabalhadas" do papel. */
export function ManualTimeForm({ omId, onSaved, onCancel }: { omId: string; onSaved: () => void; onCancel: () => void }) {
  const [v, setV] = useState({ data: "", inicio: "", fim: "", obs: "" });
  const [ativo, setAtivo] = useState<Campo>("data");
  const [busy, setBusy] = useState(false);
  const [erroApi, setErroApi] = useState<string | null>(null);

  const data = lerData(v.data);
  const ini = lerHora(v.inicio);
  const fim = lerHora(v.fim);

  // Validação local (a API revalida: sobreposição, OM encerrada, responsável...)
  let problema: string | null = null;
  if (v.data.length === 8 && !data) problema = "Data inválida.";
  else if (data && montar(data, 0) > new Date()) problema = "A data não pode ser futura.";
  else if (v.inicio.length === 4 && ini === null) problema = "Hora de início inválida.";
  else if (v.fim.length === 4 && fim === null) problema = "Hora de fim inválida.";
  else if (ini !== null && fim !== null && fim <= ini) problema = "O fim deve ser depois do início (no mesmo dia).";
  else if (data && fim !== null && montar(data, fim) > new Date()) problema = "O fim não pode estar no futuro.";

  const ok = !!data && ini !== null && fim !== null && !problema;
  const totalSeg = ok ? (fim! - ini!) * 60 : null;

  const digitar = (d: string) => { if (ativo !== "obs") setV((p) => (p[ativo].length < TAM[ativo] ? { ...p, [ativo]: p[ativo] + d } : p)); };
  const apagar = () => setV((p) => ({ ...p, [ativo]: p[ativo].slice(0, -1) }));
  const limpar = () => setV((p) => ({ ...p, [ativo]: "" }));

  async function salvar() {
    if (!ok || !data) return;
    setBusy(true); setErroApi(null);
    try {
      await lancarTempoManual(omId, {
        inicio: montar(data, ini!).toISOString(),
        fim: montar(data, fim!).toISOString(),
        observacao: v.obs.trim() || undefined,
      });
      onSaved();
    } catch (e) {
      setErroApi(e instanceof ApiError
        ? e.status === 404 ? "O servidor ainda não aceita lançamento manual (aguardando Back-end)." : e.message
        : "Erro inesperado.");
      setBusy(false);
    }
  }

  const box = (c: Campo, rotulo: string, texto: string, ph: string, extra = "") => (
    <button onClick={() => setAtivo(c)} aria-pressed={ativo === c}
      className={`min-h-16 rounded-xl bg-ink p-3 text-left ring-4 ${ativo === c ? "ring-primary-fg" : "ring-transparent"} ${extra}`}>
      <span className="block text-lg text-muted">{rotulo}</span>
      <span className="font-mono text-2xl font-bold tabular-nums md:text-3xl">{texto || <span className="text-xl font-normal text-muted">{ph}</span>}</span>
    </button>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Lançamento retroativo de tempo"
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-scrim p-3 md:p-4">
      <div className="w-full max-w-3xl rounded-3xl bg-panel-2 p-4 ring-2 ring-primary-fg md:p-6">
        <h2 className="text-2xl font-extrabold md:text-3xl">Lançamento retroativo / manual</h2>
        <p className="mt-1 text-lg text-muted">Horas trabalhadas, como no formulário de papel.</p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {box("data", "Data", mascarar(v.data, MASK_DATA), "DD/MM/AAAA")}
          {box("inicio", "Início", mascarar(v.inicio, MASK_HORA), "HH:MM")}
          {box("fim", "Fim", mascarar(v.fim, MASK_HORA), "HH:MM")}
        </div>
        <div className="mt-3">{box("obs", `Obs (${v.obs.length}/${OBS_MAX})`, v.obs, "Observação opcional", "w-full")}</div>

        {ativo === "data" && (
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[["Hoje", 0], ["Ontem", 1], ["Anteontem", 2]].map(([r, n]) => (
              <button key={r as string} onClick={() => setV((p) => ({ ...p, data: dataEmDigitos(n as number) }))}
                className={`${btnBase} bg-ink ring-1 ring-line`}>{r}</button>
            ))}
          </div>
        )}

        <div className="mt-4">
          {ativo === "obs"
            ? <VirtualKeyboard value={v.obs} onChange={(t) => setV((p) => ({ ...p, obs: t }))} maxLength={OBS_MAX} />
            : <div className="mx-auto max-w-md"><NumericKeypad onDigit={digitar} onBackspace={apagar} onClear={limpar} /></div>}
        </div>

        {totalSeg !== null && <p className="mt-4 text-center text-2xl font-bold" role="status">Total: {horasDecimais(totalSeg)} h</p>}
        {(problema || erroApi) && <p role="alert" className="mt-3 rounded-xl bg-red-700 text-white p-3 text-xl font-semibold">{problema ?? erroApi}</p>}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={onCancel} disabled={busy} className={`${btnBase} bg-ink ring-1 ring-line`}>Cancelar</button>
          <button disabled={busy || !ok} onClick={salvar} className={`${btnPrimary} bg-green-700 text-white`}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
