"use client";
import { setorDaOm } from "@/lib/rotulos";
import { useState } from "react";
import { PRIORIDADE, duracaoHumana, haQuanto } from "@/lib/kanban";
import type { Aprovacao } from "@/lib/types";
import { DecisaoAprovacao } from "../aprovacao/DecisaoAprovacao";
import { SituacaoAprovacao } from "../aprovacao/SituacaoAprovacao";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";

/**
 * Aprovações pendentes (Painel Admin): fila à esquerda (mais antigas primeiro), decisão à direita.
 * Escopo global: GERENTE/ADMIN veem todas; a coluna "Situação" diz, por OM, se o usuário decide agora, se aguarda o
 * operador (e em quanto tempo libera) ou se ele executou a OM (RN-24).
 */
export function AprovacoesPage({ lista, erro, onRecarregar }: { lista: Aprovacao[] | null; erro: string | null; onRecarregar: () => void }) {
  const [selId, setSelId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const sel = lista?.find((o) => o.id === selId) ?? null;

  return (
    <section aria-label="Aprovações pendentes" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Aprovações pendentes</h1>
          <p className="text-muted">OMs finalizadas pelo técnico que aguardam decisão. Ninguém aprova o que executou. Cada decisão pede o PIN de quem decide.</p>
        </div>
        <button onClick={onRecarregar} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-panel px-4 font-semibold ring-1 ring-line hover:bg-brand-50"><Icone nome="atualizar" className="h-4 w-4" />Atualizar</button>
      </header>
      {aviso && <Faixa tipo="ok">{aviso}</Faixa>}
      {erro && <Faixa tipo="erro">{erro}</Faixa>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_32rem]">
        <div className="overflow-x-auto rounded-2xl bg-panel ring-1 ring-line">
          {!lista ? <p className="p-6 text-muted">Carregando…</p> : lista.length === 0 ? (
            <p className="flex flex-col items-center gap-2 p-10 text-center text-lg text-muted"><Icone nome="checkCirculo" className="h-10 w-10 text-ok-fg" />Nenhuma OM aguardando aprovação.</p>
          ) : (
            <table className="tabela-cartoes w-full min-w-[46rem] text-left">
              <thead className="bg-brand-50 text-sm uppercase tracking-wide text-muted">
                <tr><th className="p-3">OM</th><th className="p-3">Prioridade</th><th className="p-3">Equipamento</th><th className="p-3">Executante</th><th className="p-3">Situação</th><th className="p-3">Finalizada</th><th className="p-3 text-right">Parada</th></tr>
              </thead>
              <tbody className="divide-y divide-line/40 dark:divide-line-soft">
                {lista.map((o) => {
                  const p = PRIORIDADE[o.prioridade];
                  const parada = o.dataConclusao ? (new Date(o.dataConclusao).getTime() - new Date(o.dataAbertura).getTime()) / 1000 : null;
                  return (
                    <tr key={o.id} onClick={() => { setSelId(o.id); setAviso(null); }} aria-selected={selId === o.id}
                      className={`cursor-pointer hover:bg-brand-50 ${selId === o.id ? "bg-brand-100" : ""}`}>
                      <td data-rotulo="OM" className="whitespace-nowrap p-3 font-bold tabular-nums text-primary-fg">
                        <button onClick={() => { setSelId(o.id); setAviso(null); }} className="font-bold underline-offset-2 hover:underline">{o.numero}</button>
                      </td>
                      <td data-rotulo="Prioridade" className="p-3"><span className={`rounded-full px-2.5 py-0.5 text-sm font-extrabold ${p.cls}`}>{p.label}</span></td>
                      <td data-rotulo="Equipamento" className="p-3"><span className="font-semibold">{o.equipamento.codigo}</span> · {o.equipamento.nome}<span className="block text-sm text-muted">{setorDaOm(o)}</span></td>
                      <td data-rotulo="Executante" className="p-3">{o.responsavel?.nome ?? "—"}</td>
                      <td data-rotulo="Situação" className="p-3"><SituacaoAprovacao a={o} onAtualizar={onRecarregar} /></td>
                      <td data-rotulo="Finalizada" className="whitespace-nowrap p-3">{o.dataConclusao ? haQuanto(o.dataConclusao) : "—"}</td>
                      <td data-rotulo="Parada" className="whitespace-nowrap p-3 text-right tabular-nums">{duracaoHumana(parada)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <aside aria-label="Decisão" className="rounded-2xl bg-panel p-4 ring-1 ring-line xl:sticky xl:top-28">
          {sel ? (
            <DecisaoAprovacao key={sel.id} om={sel} modo="admin" onAtualizar={onRecarregar}
              onDecidida={(r) => { setSelId(null); setAviso(r === "aprovada" ? `OM ${sel.numero} aprovada. Segue para conclusão pelo gestor.` : r === "reprovada" ? `OM ${sel.numero} reprovada: voltou ao técnico com o motivo.` : null); onRecarregar(); }} />
          ) : (
            <p className="p-6 text-center text-muted">Selecione uma OM da lista para revisar a execução e decidir.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
