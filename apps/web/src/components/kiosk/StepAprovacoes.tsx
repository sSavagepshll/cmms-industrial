"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, listarAprovacoes } from "@/lib/api";
import { PRIORIDADE, haQuanto } from "@/lib/kanban";
import type { Aprovacao } from "@/lib/types";
import { DecisaoAprovacao } from "../aprovacao/DecisaoAprovacao";
import { SituacaoAprovacao } from "../aprovacao/SituacaoAprovacao";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { Screen, btnPrimary } from "./ui";

/**
 * Fila de aprovação no totem: lista (mais antigas primeiro) -> detalhe com Aprovar / Reprovar.
 * Escopo vem da API: OPERADOR vê só as OMs que abriu; LIDER_PRODUCAO, GERENTE e ADMIN veem todas (escopo global).
 */
export function StepAprovacoes({ onBack, onSair }: { onBack: () => void; onSair: () => void }) {
  const [lista, setLista] = useState<Aprovacao[] | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(() => {
    listarAprovacoes().then((l) => { setLista(l); setErro(null); })
      .catch((e) => { if (e instanceof ApiError && e.status === 401) return; setLista((p) => p ?? []); setErro(e instanceof ApiError && e.status === 403 ? "Seu perfil não pode aprovar OMs." : "Não foi possível carregar as aprovações."); });
  }, []);
  useEffect(carregar, [carregar]);

  const sel = lista?.find((o) => o.id === selId);

  return (
    <Screen title={sel ? "Decidir OM" : "Aprovações pendentes"} subtitle={sel ? undefined : lista ? `${lista.length} aguardando decisão` : "Carregando…"}
      onBack={sel ? () => setSelId(null) : onBack}>
      {aviso && <Faixa tipo="ok" className="text-xl md:text-2xl">{aviso}</Faixa>}
      {erro && <Faixa tipo="erro" className="text-xl">{erro}</Faixa>}

      {sel ? (
        <DecisaoAprovacao key={sel.id} om={sel} modo="totem" onAtualizar={carregar}
          onDecidida={(r) => { setSelId(null); setAviso(r === "aprovada" ? `OM ${sel.numero} aprovada. Segue para conclusão pelo gestor.` : r === "reprovada" ? `OM ${sel.numero} reprovada: voltou ao técnico.` : null); carregar(); }} />
      ) : lista && lista.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Icone nome="checkCirculo" className="h-20 w-20 text-ok-fg" />
          <p className="text-3xl font-extrabold md:text-4xl">Nenhuma OM aguardando aprovação</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3 md:gap-4">
          {lista?.map((o) => {
            const p = PRIORIDADE[o.prioridade];
            return (
              <li key={o.id}>
                <button onClick={() => { setSelId(o.id); setAviso(null); }}
                  className="flex min-h-28 w-full flex-col gap-2 rounded-2xl bg-panel p-4 text-left ring-2 ring-line md:min-h-32">
                  <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <span className="whitespace-nowrap text-xl font-bold tabular-nums text-primary-fg md:text-2xl">{o.numero}</span>
                    <span className={`rounded-full px-3 py-1 text-lg font-extrabold ${p.cls}`}>{p.label}</span>
                  </span>
                  <span className="text-2xl font-extrabold md:text-3xl">{o.equipamento.codigo} · {o.equipamento.nome}</span>
                  <SituacaoAprovacao a={o} grande onAtualizar={carregar} />
                  <span className="flex justify-between gap-2 text-lg text-muted md:text-xl">
                    <span className="inline-flex items-center gap-1.5"><Icone nome="ferramenta" className="h-5 w-5" />{o.responsavel?.nome ?? "—"}</span>
                    <span>{o.dataConclusao ? `finalizada ${haQuanto(o.dataConclusao)}` : ""}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button onClick={onSair} className={`${btnPrimary} mt-auto bg-strong text-strong-on dark:ring-2 dark:ring-primary-edge`}>Concluir / Sair</button>
    </Screen>
  );
}
