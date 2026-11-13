"use client";
import { useEffect, useRef, useState } from "react";
import { listarEquipamentos } from "@/lib/api";
import type { Equipamento } from "@/lib/types";
import { DockTeclado, btnBase } from "./ui";
import { VirtualKeyboard } from "./VirtualKeyboard";

/**
 * Busca de TAG dentro de um grupo de equipamentos (US-16, RN-48). Nasce recolhida (botão discreto) para preservar a área dos cards;
 * ao tocar expande o campo + teclado virtual. TAG exata seleciona direto; senão filtra os cards do grupo (`onFiltrar`).
 */
export function BuscaTag({ grupo, desativada = false, onSelecionar, onFiltrar }: {
  grupo: string; desativada?: boolean; onSelecionar: (e: Equipamento) => void; onFiltrar: (itens: Equipamento[] | null) => void;
}) {
  const [aberta, setAberta] = useState(false);
  const [tag, setTag] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const gatilho = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);

  function fechar() { setAberta(false); setTag(""); setMsg(null); onFiltrar(null); }

  // Escape fecha a busca e devolve o foco ao botão acionador.
  useEffect(() => {
    if (!aberta) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); devolverFoco.current = true; fechar(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta]);
  useEffect(() => { if (!aberta && devolverFoco.current) { devolverFoco.current = false; gatilho.current?.focus(); } }, [aberta]);

  async function buscar() {
    const t = tag.trim().toUpperCase();
    if (!t || busy) return;
    setBusy(true); setMsg(null);
    try {
      const itens = await listarEquipamentos({ grupo, busca: t });
      const exato = itens.find((e) => e.codigo.toUpperCase() === t);
      if (exato) { fechar(); onSelecionar(exato); return; }
      if (itens.length === 0) { setMsg("TAG não encontrada neste grupo"); onFiltrar(null); }
      else onFiltrar(itens);
    } catch { setMsg("Não foi possível buscar. Tente novamente."); }
    finally { setBusy(false); }
  }

  if (!aberta) {
    return (
      <button ref={gatilho} aria-expanded={false} onClick={() => setAberta(true)}
        className="flex min-h-tap-sm w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-panel px-4 text-lg font-semibold text-muted ring-1 ring-line md:w-auto md:self-start">
        <span aria-hidden>🔍</span> Digite a TAG da máquina
      </button>
    );
  }
  return (
    <DockTeclado acao={
      <section aria-label="Busca por TAG" className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex min-h-[64px] flex-1 items-center rounded-xl bg-panel px-4 text-2xl font-bold tracking-widest ring-1 ring-line md:text-3xl">
            {tag || <span className="text-xl font-normal tracking-normal text-muted">Digite a TAG (ex.: INJ-01)</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button disabled={!tag || busy} onClick={() => void buscar()} className={`${btnBase} bg-green-700 text-white`}>{busy ? "Buscando…" : "Buscar"}</button>
            <button onClick={fechar} className={`${btnBase} bg-panel ring-1 ring-line`}>Fechar</button>
          </div>
        </div>
        {msg && <p role="alert" className="text-xl font-semibold text-danger-fg">{msg}</p>}
      </section>}>
      <VirtualKeyboard value={tag} onChange={(v) => { setMsg(null); setTag(v.toUpperCase()); }} maxLength={20} allowSpace={false}
        fisico={!desativada} onEnter={() => void buscar()} />
    </DockTeclado>
  );
}
