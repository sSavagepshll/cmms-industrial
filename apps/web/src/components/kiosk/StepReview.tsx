"use client";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { TRIADE, prioridadePorImpacto } from "@/lib/constants";
import type { Equipamento, Operador } from "@/lib/types";
import type { DetalhesFalha } from "./StepDetalhes";
import { Screen } from "./ui";
import { rotuloSetor } from "@/lib/rotulos";
import { Botao } from "../ui/Botao";

export function StepReview({ user, equip, c, local, onConfirm, onBack }: {
  user: Operador; equip: Equipamento; c: DetalhesFalha; local?: string; onConfirm: () => Promise<void>; onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const prio = prioridadePorImpacto[c.impacto];

  async function go() {
    setBusy(true); setErr(null);
    try {
      await onConfirm();
    } catch (e) {
      setErr(
        e instanceof ApiError && e.code === "OM_DUPLICADA"
          ? "Já existe OM em aberto para esta máquina/local. Volte e escolha como prosseguir."
          : e instanceof ApiError && e.status === 422
            ? e.message
            : "Não foi possível abrir o chamado. Toque para tentar novamente.",
      );
      setBusy(false);
    }
  }

  const rows: [string, string][] = [
    ["Solicitante", user.nome],
    equip.predial ? ["Ativo", `${equip.codigo} · ${equip.nome}`] : ["Máquina", `${equip.codigo} · ${equip.nome}`],
    ["Setor", rotuloSetor(equip, local)],
    ...(equip.predial && local ? [["Local", local] as [string, string]] : []),
    ["Impacto", c.impacto === "PARADA" ? (equip.predial ? "🔴 Impede o uso / risco" : "🔴 Máquina totalmente parada") : (equip.predial ? "🟡 Funciona com falha / reparo não urgente" : "🟡 Operando com falha / ajuste")],
    ["Prioridade", prio],
    ["Tipo do problema", TRIADE.find((x) => x.key === c.tipo)?.label ?? c.categoria],
    ["Sintomas", c.sintomas.join(", ")],
    ...(c.observacao ? [["Observação", c.observacao] as [string, string]] : []),
  ];

  return (
    <Screen title="Confirme o chamado" onBack={busy ? undefined : onBack} passo={4}>
      <dl className="divide-y divide-line dark:divide-line-soft rounded-3xl bg-panel p-2 ring-1 ring-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1 p-4 sm:flex-row sm:gap-6">
            <dt className="w-40 shrink-0 text-xl text-muted">{k}</dt>
            <dd className="break-words text-xl font-semibold md:text-2xl">{v}</dd>
          </div>
        ))}
      </dl>
      {err && <p role="alert" className="rounded-xl bg-red-700 text-white p-3 text-xl font-semibold">{err}</p>}
      <Botao tamanho="totem" variante="sucesso" disabled={busy} onClick={go}>
        {busy ? "Enviando…" : "CONFIRMAR E ABRIR CHAMADO"}
      </Botao>
    </Screen>
  );
}
