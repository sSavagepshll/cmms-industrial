"use client";
import { useEffect, useState } from "react";
import { listarTecnicos } from "@/lib/api";
import { FILTRO_PADRAO, PRIORIDADES, TIPOS_OM, filtroAtivo, type FiltroDesempenho, type Prio } from "@/lib/desempenho";
import { PRIORIDADE } from "@/lib/kanban";
import type { TecnicoCarga } from "@/lib/types";
import { campo } from "../../ui/estilos";

const chip = (ativo: boolean) => `min-h-11 rounded-full px-3 text-sm font-semibold ${ativo ? "bg-brand-600 text-white" : "bg-panel ring-1 ring-line hover:bg-brand-50"}`;
const PERIODOS = [7, 30, 90] as const;
const alterna = <T,>(l: T[], v: T) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]);

/** Período, comparar, técnico, prioridade e tipo. Todo o estado vive em `filtro` (a página o grava na URL). */
export function FiltrosDesempenho({ filtro, onChange }: { filtro: FiltroDesempenho; onChange: (f: FiltroDesempenho) => void }) {
  const [tecnicos, setTecnicos] = useState<TecnicoCarga[]>([]);
  useEffect(() => { listarTecnicos().then((l) => setTecnicos([...l].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")))).catch(() => setTecnicos([])); }, []);
  const set = (p: Partial<FiltroDesempenho>) => onChange({ ...filtro, ...p });
  const hoje = new Date().toISOString().slice(0, 10);
  const invertido = filtro.dias === 0 && !!filtro.de && !!filtro.ate && filtro.de > filtro.ate;
  const nomeTec = filtro.tec.length === 0 ? "Todos" : filtro.tec.length === 1 ? tecnicos.find((t) => t.id === filtro.tec[0])?.nome ?? "1 técnico" : `${filtro.tec.length} técnicos`;

  return (
    <form aria-label="Filtros do dashboard" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-1 rounded-2xl bg-panel px-3 py-2 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="group" aria-label="Período" className="flex flex-wrap items-center gap-1.5">
          {PERIODOS.map((p) => <button type="button" key={p} aria-pressed={filtro.dias === p} onClick={() => set({ dias: p, de: "", ate: "" })} className={chip(filtro.dias === p)}>{p} dias</button>)}
          <button type="button" aria-pressed={filtro.dias === 0} onClick={() => set({ dias: 0, de: filtro.de || hoje, ate: filtro.ate || hoje })} className={chip(filtro.dias === 0)}>Personalizar</button>
          {filtro.dias === 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              <label className="sr-only" htmlFor="f-de">De</label><input id="f-de" type="date" value={filtro.de} max={hoje} onChange={(e) => set({ de: e.target.value })} className={`${campo} !min-h-11 w-auto`} />
              <span aria-hidden>até</span>
              <label className="sr-only" htmlFor="f-ate">Até</label><input id="f-ate" type="date" value={filtro.ate} max={hoje} onChange={(e) => set({ ate: e.target.value })} className={`${campo} !min-h-11 w-auto`} />
            </span>
          )}
        </div>
        <details className="relative">
          <summary className={`${chip(filtro.tec.length > 0)} flex cursor-pointer list-none items-center`}>Técnico: {nomeTec} ▾</summary>
          <div className="absolute left-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl bg-panel-2 p-2 shadow-lg ring-1 ring-line">
            {tecnicos.length === 0 && <p className="p-2 text-sm text-muted">Nenhum técnico encontrado.</p>}
            {tecnicos.map((t) => (
              <label key={t.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-brand-50">
                <input type="checkbox" checked={filtro.tec.includes(t.id)} onChange={() => set({ tec: alterna(filtro.tec, t.id) })} className="h-5 w-5 accent-brand-600" />{t.nome}
              </label>
            ))}
          </div>
        </details>
        <div role="group" aria-label="Prioridade" className="flex flex-wrap items-center gap-1.5">
          {PRIORIDADES.map((p: Prio) => <button type="button" key={p} aria-pressed={filtro.prio.includes(p)} onClick={() => set({ prio: alterna(filtro.prio, p) })} className={chip(filtro.prio.includes(p))}>{PRIORIDADE[p].label}</button>)}
        </div>
        <label className="inline-flex items-center gap-1.5 text-sm font-semibold"><span className="sr-only">Tipo de manutenção</span>
          <select aria-label="Tipo de manutenção" value={filtro.tipo} onChange={(e) => set({ tipo: e.target.value })} className={`${campo} !min-h-11 w-auto`}>
            {TIPOS_OM.map((t) => <option key={t.key} value={t.key}>{t.rotulo}</option>)}
          </select>
        </label>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold" title="Os indicadores sempre comparam com o período anterior; esta opção desenha o período anterior sobre os gráficos.">
          <input type="checkbox" checked={filtro.comp} onChange={(e) => set({ comp: e.target.checked })} className="h-5 w-5 accent-brand-600" />
          Sobrepor período anterior
        </label>
        {filtroAtivo(filtro) && (
          <button type="button" onClick={() => onChange({ ...FILTRO_PADRAO, dias: filtro.dias, de: filtro.de, ate: filtro.ate, vis: filtro.vis })} className="ml-auto min-h-11 text-sm font-semibold text-primary-fg underline underline-offset-4">✕ limpar</button>
        )}
      </div>
      {invertido && <p role="alert" className="text-sm font-semibold text-warn-soft-fg">A data inicial é depois da final: usando os últimos 30 dias.</p>}
    </form>
  );
}
