"use client";
import { useCallback, useEffect, useState } from "react";
import { listarAprovacoes } from "@/lib/api";
import { decideAprovacao, type Aprovacao, type Operador } from "@/lib/types";
import { Icone } from "../ui/Icones";
import { DecisaoAprovacao } from "./DecisaoAprovacao";

/** Bloco "Aguardando aprovação" dentro do detalhe da OM (Kanban): quem pode decidir decide; os demais perfis só veem o aviso. */
export function AprovacaoDaOm({ omId, user, onDecidida }: { omId: string; user: Operador; onDecidida: () => void }) {
  const [om, setOm] = useState<Aprovacao | null | undefined>(undefined);
  const supervisor = decideAprovacao(user.perfil);
  const carregar = useCallback(() => {
    listarAprovacoes().then((l) => setOm(l.find((o) => o.id === omId) ?? null)).catch(() => setOm(null));
  }, [omId]);
  useEffect(() => { if (supervisor) carregar(); }, [supervisor, carregar]);

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="flex items-start gap-2 rounded-2xl bg-brand-50 p-4 text-xl font-bold text-primary-fg ring-2 ring-brand-300">
        <Icone nome="relogio" className="mt-1 h-6 w-6" />
        <span>Execução finalizada: aguardando aprovação. O técnico não pode alterar tempo ou materiais até a decisão.</span>
      </p>
      {supervisor && om && <DecisaoAprovacao om={om} modo="admin" onDecidida={onDecidida} onAtualizar={carregar} />}
      {supervisor && om === null && <p className="text-lg text-muted">Não foi possível carregar os dados da aprovação.</p>}
    </div>
  );
}
