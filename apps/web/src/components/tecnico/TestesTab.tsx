"use client";
import { useState } from "react";

/**
 * RASCUNHO da aba Testes (layout do formulário físico, frente). Estado só local: NADA é gravado.
 * Falta definir com Back-end/Analista: modelo de dados, quem preenche cada coluna e regras de aprovação.
 * Tabela 1 - Testes: Nº, Teste S/N, Data/Hora, Programação, Aprovado S/N, Data/Hora, Ciente executante.
 * Tabela 2 - Teste (Produção) Resp.: Nº, Data/Hora, Recebido, Início, Final, Tempo total (H), Devolvido.
 */
interface Teste { teste: "S" | "N" | ""; dh: string; prog: string; aprov: "S" | "N" | ""; dhAprov: string; ciente: string }
interface Producao { dh: string; recebido: string; inicio: string; final: string; devolvido: string }

const vazioT = (): Teste => ({ teste: "", dh: "", prog: "", aprov: "", dhAprov: "", ciente: "" });
const vazioP = (): Producao => ({ dh: "", recebido: "", inicio: "", final: "", devolvido: "" });
const campo = "min-h-14 w-full select-text rounded-xl bg-ink px-3 text-xl text-fg ring-1 ring-line";

function SN({ valor, onChange, rotulo }: { valor: "S" | "N" | ""; onChange: (v: "S" | "N") => void; rotulo: string }) {
  return (
    <div role="group" aria-label={rotulo} className="flex gap-2">
      {(["S", "N"] as const).map((o) => (
        <button key={o} aria-pressed={valor === o} onClick={() => onChange(o)}
          className={`min-h-14 min-w-16 rounded-xl text-2xl font-extrabold ring-2 ${valor === o ? "bg-brand-700 text-white ring-fg" : "bg-ink ring-line"}`}>{valor === o ? "✓ " : ""}{o}</button>
      ))}
    </div>
  );
}
const Rot = ({ children }: { children: React.ReactNode }) => <span className="mb-1 block text-lg text-muted">{children}</span>;

export function TestesTab() {
  const [testes, setTestes] = useState<Teste[]>([vazioT()]);
  const [prod, setProd] = useState<Producao[]>([vazioP()]);
  const upT = (i: number, p: Partial<Teste>) => setTestes((l) => l.map((t, k) => (k === i ? { ...t, ...p } : t)));
  const upP = (i: number, p: Partial<Producao>) => setProd((l) => l.map((t, k) => (k === i ? { ...t, ...p } : t)));

  return (
    <div className="flex flex-col gap-5">
      <p role="note" className="rounded-xl border-2 border-dashed border-amber-400 bg-panel p-3 text-lg text-amber-800">
        ✎ RASCUNHO · layout do formulário físico. Os dados desta aba <strong>não são gravados</strong> (aguardando definição com o Back-end).
      </p>

      <section aria-label="Testes" className="flex flex-col gap-3">
        <h3 className="text-2xl font-extrabold">Testes</h3>
        {testes.map((t, i) => (
          <fieldset key={i} className="grid grid-cols-1 gap-3 rounded-2xl bg-panel p-3 ring-1 ring-line sm:grid-cols-2 lg:grid-cols-3">
            <legend className="px-2 text-xl font-bold">Nº {String(i + 1).padStart(2, "0")}</legend>
            <div><Rot>Teste S/N</Rot><SN rotulo="Teste S/N" valor={t.teste} onChange={(v) => upT(i, { teste: v })} /></div>
            <label><Rot>Data / Hora</Rot><input type="datetime-local" className={campo} value={t.dh} onChange={(e) => upT(i, { dh: e.target.value })} /></label>
            <label><Rot>Programação</Rot><input className={campo} value={t.prog} onChange={(e) => upT(i, { prog: e.target.value })} /></label>
            <div><Rot>Aprovado S/N</Rot><SN rotulo="Aprovado S/N" valor={t.aprov} onChange={(v) => upT(i, { aprov: v })} /></div>
            <label><Rot>Data / Hora (aprovação)</Rot><input type="datetime-local" className={campo} value={t.dhAprov} onChange={(e) => upT(i, { dhAprov: e.target.value })} /></label>
            <label><Rot>Ciente executante</Rot><input className={campo} value={t.ciente} onChange={(e) => upT(i, { ciente: e.target.value })} /></label>
          </fieldset>
        ))}
        {testes.length < 4 && <button onClick={() => setTestes((l) => [...l, vazioT()])} className="min-h-14 rounded-2xl bg-panel text-xl font-bold ring-1 ring-line md:min-h-tap-md">＋ Teste Nº {String(testes.length + 1).padStart(2, "0")}</button>}
      </section>

      <section aria-label="Teste de produção" className="flex flex-col gap-3">
        <h3 className="text-2xl font-extrabold">Teste (Produção) · Resp.</h3>
        {prod.map((t, i) => (
          <fieldset key={i} className="grid grid-cols-1 gap-3 rounded-2xl bg-panel p-3 ring-1 ring-line sm:grid-cols-2 lg:grid-cols-3">
            <legend className="px-2 text-xl font-bold">Nº {String(i + 1).padStart(2, "0")}</legend>
            <label><Rot>Data / Hora</Rot><input type="datetime-local" className={campo} value={t.dh} onChange={(e) => upP(i, { dh: e.target.value })} /></label>
            <label><Rot>Recebido</Rot><input className={campo} value={t.recebido} onChange={(e) => upP(i, { recebido: e.target.value })} /></label>
            <label><Rot>Início</Rot><input type="time" className={campo} value={t.inicio} onChange={(e) => upP(i, { inicio: e.target.value })} /></label>
            <label><Rot>Final</Rot><input type="time" className={campo} value={t.final} onChange={(e) => upP(i, { final: e.target.value })} /></label>
            <div><Rot>Tempo total (H)</Rot><p className="flex min-h-14 items-center rounded-xl bg-ink px-3 text-xl tabular-nums ring-1 ring-line">{horas(t.inicio, t.final)}</p></div>
            <label><Rot>Devolvido</Rot><input className={campo} value={t.devolvido} onChange={(e) => upP(i, { devolvido: e.target.value })} /></label>
          </fieldset>
        ))}
        {prod.length < 4 && <button onClick={() => setProd((l) => [...l, vazioP()])} className="min-h-14 rounded-2xl bg-panel text-xl font-bold ring-1 ring-line md:min-h-tap-md">＋ Teste de produção Nº {String(prod.length + 1).padStart(2, "0")}</button>}
      </section>
    </div>
  );
}

function horas(a: string, b: string): string {
  if (!a || !b) return "—";
  const [h1, m1] = a.split(":").map(Number), [h2, m2] = b.split(":").map(Number);
  const min = h2 * 60 + m2 - (h1 * 60 + m1);
  return min > 0 ? (min / 60).toFixed(1).replace(".", ",") : "—";
}
