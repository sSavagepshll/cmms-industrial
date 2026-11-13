"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError, listarApontamentos } from "@/lib/api";
import { fmtDia, fmtHora, horasDecimais } from "@/lib/datetime";
import type { Apontamento } from "@/lib/types";
import { btnBase } from "../kiosk/ui";
import { ManualTimeForm } from "./ManualTimeForm";

/** Aba Tempo: cronômetro (play/pause) + tabela "Horas trabalhadas" + lançamento retroativo/manual. */
export function TempoTab({ omId, controles, podeLancar, refreshKey, onChanged }: {
  omId: string; controles: ReactNode; podeLancar: boolean; refreshKey: number; onChanged: () => void;
}) {
  const [itens, setItens] = useState<Apontamento[] | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [abrir, setAbrir] = useState(false);

  const carregar = useCallback(() => {
    listarApontamentos(omId)
      .then((l) => { setItens(l); setIndisponivel(false); })
      .catch((e) => { if (e instanceof ApiError && e.status === 404) setIndisponivel(true); setItens([]); });
  }, [omId]);
  useEffect(carregar, [carregar, refreshKey]);

  const seg = (a: Apontamento) => (a.fim ? Math.max(0, (new Date(a.fim).getTime() - new Date(a.inicio).getTime()) / 1000) : 0);
  const total = (itens ?? []).reduce((t, a) => t + seg(a), 0);

  return (
    <div className="flex flex-col gap-4">
      {controles}

      <section aria-label="Horas trabalhadas" className="flex flex-col gap-3">
        <h3 className="text-2xl font-extrabold">Horas trabalhadas</h3>
        {indisponivel && <p className="rounded-xl bg-panel p-3 text-lg text-amber-800">Histórico de lançamentos indisponível (aguardando Back-end).</p>}
        {!itens ? <p className="text-xl text-muted">Carregando…</p> : itens.length === 0 ? (
          <p className="text-xl text-muted">Nenhum lançamento.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
            <table className="w-full min-w-[34rem] text-left text-lg tabular-nums md:text-xl">
              <thead className="bg-panel text-muted">
                <tr><th className="p-3">Data</th><th className="p-3">Início</th><th className="p-3">Término</th><th className="p-3">Obs</th><th className="p-3 text-right">Total (h)</th></tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-line-soft">
                {itens.map((a) => (
                  <tr key={a.id}>
                    <td className="p-3">{fmtDia(a.inicio)}</td>
                    <td className="p-3">{fmtHora(a.inicio)}</td>
                    <td className="p-3">{a.fim ? fmtHora(a.fim) : "▶ em andamento"}</td>
                    <td className="p-3">{a.manual && <span className="mr-2 rounded-full bg-brand-700 text-white px-2 py-0.5 text-base">✎ manual</span>}{a.observacao}</td>
                    <td className="p-3 text-right font-bold">{a.fim ? horasDecimais(seg(a)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-panel font-extrabold"><td className="p-3" colSpan={4}>TOTAL GERAL</td><td className="p-3 text-right">{horasDecimais(total)}</td></tr></tfoot>
            </table>
          </div>
        )}
        {podeLancar && <button onClick={() => setAbrir(true)} className={`${btnBase} bg-brand-700 text-white`}>✎ Lançamento retroativo / manual</button>}
      </section>

      {abrir && <ManualTimeForm omId={omId} onCancel={() => setAbrir(false)} onSaved={() => { setAbrir(false); carregar(); onChanged(); }} />}
    </div>
  );
}
