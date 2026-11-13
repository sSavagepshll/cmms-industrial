"use client";
import type { Equipamento, OmAberta } from "@/lib/types";
import { NotesPanel } from "../tecnico/NotesPanel";
import { Screen, btnBase, btnPrimary } from "./ui";

/** US-02 Cenário 2: consulta a OM existente e complementa com nota (GET/POST /ordens/:id/notas). */
export function StepNote({ equip, om, onDone, onBack }: {
  equip: Equipamento; om: OmAberta; onDone: () => void; onBack: () => void;
}) {
  const quando = new Date(om.dataAbertura).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  return (
    <Screen title={`${om.numero} · ${equip.codigo}`} subtitle={`${equip.nome} — aberta por ${om.solicitante.nome} em ${quando}`} onBack={onBack}>
      <NotesPanel omId={om.id} encerrada={false} refreshKey={0} />
      <button onClick={onDone} className={`${btnPrimary} bg-green-700 text-white`}>Concluir / Sair Agora</button>
    </Screen>
  );
}
