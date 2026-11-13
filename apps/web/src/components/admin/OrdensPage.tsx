"use client";
import { setorDaOm } from "@/lib/rotulos";
import { useCallback, useEffect, useState } from "react";
import { ApiError, buscarFila, buscarOm, listarOrdens } from "@/lib/api";
import { PRIORIDADE, haQuanto } from "@/lib/kanban";
import type { OmKanban, OmLista, Operador } from "@/lib/types";
import { AtribuirTecnico } from "../despacho/AtribuirTecnico";
import { AvisoDesfazer } from "../despacho/AvisoDesfazer";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { btnSec } from "../ui/estilos";
import { OmDetail } from "../tecnico/OmDetail";

export const STATUS_OM: Record<string, { label: string; cls: string }> = {
  ABERTA: { label: "Aberta", cls: "bg-sky-100 text-sky-900" },
  RESERVADA: { label: "Reservada", cls: "bg-brand-100 text-primary-fg" },
  EM_ANDAMENTO: { label: "Em andamento", cls: "bg-green-100 text-green-900" },
  PAUSADA: { label: "Pausada", cls: "bg-amber-100 text-amber-900" },
  AGUARDANDO_PECA: { label: "Aguardando peça", cls: "bg-amber-100 text-amber-900" },
  AGUARDANDO_APROVACAO: { label: "Aguardando aprovação", cls: "bg-brand-100 text-primary-fg" },
  AGUARDANDO_BAIXA: { label: "Aguardando conclusão", cls: "bg-violet-100 text-violet-900" },
  CONCLUIDA: { label: "Concluída", cls: "bg-slate-200 text-slate-800" },
  CANCELADA: { label: "Cancelada", cls: "bg-red-100 text-red-900" },
};
const FILTROS: [string, string][] = [["", "Todas"], ["ABERTA", "Abertas"], ["RESERVADA", "Reservadas"], ["EM_ANDAMENTO", "Em andamento"], ["PAUSADA", "Pausadas"], ["AGUARDANDO_APROVACAO", "Aguardando aprovação"], ["AGUARDANDO_BAIXA", "Aguardando conclusão"], ["CONCLUIDA", "Concluídas"]];

/**
 * Gestão de OMs: filtro por status, busca local, coluna Técnico e Atribuir/Reatribuir (GERENTE/ADMIN).
 * INTERINO: GET /ordens não devolve o responsável; o técnico e a possibilidade de atribuir vêm de GET /ordens/fila
 * (OMs ativas e concluídas hoje, até 100). Fora da fila a coluna mostra "—" e não há botão. Remover o merge quando
 * o Back-end incluir `responsavel` (e `reservadaPara`) em GET /ordens.
 */
export function OrdensPage({ user }: { user: Operador }) {
  const [status, setStatus] = useState("");
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<OmLista[] | null>(null);
  const [fila, setFila] = useState<Map<string, OmKanban>>(new Map());
  const [erro, setErro] = useState<string | null>(null);
  const [atribuindo, setAtribuindo] = useState<{ om: OmLista; fila: OmKanban } | null>(null);
  const [aviso, setAviso] = useState<{ omId: string; msg: string } | null>(null);
  const [tick, setTick] = useState(0);
  const recarregar = useCallback(() => setTick((n) => n + 1), []);
  // Detalhe (visão do técnico, somente leitura + ficha): usa a OM da fila quando existe (traz responsável/tempo); senão GET /ordens/:id.
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [extra, setExtra] = useState<OmKanban | null>(null);
  const [erroDetalhe, setErroDetalhe] = useState<string | null>(null);
  const aberta = abertaId ? (fila.get(abertaId) ?? (extra?.id === abertaId ? extra : null)) : null;

  const abrir = useCallback((id: string) => { setErroDetalhe(null); setAbertaId(id); }, []);
  useEffect(() => {
    if (!abertaId || fila.has(abertaId) || extra?.id === abertaId) return;
    let vivo = true;
    buscarOm(abertaId).then((o) => { if (vivo) setExtra(o); })
      .catch((e) => { if (!vivo) return; if (!(e instanceof ApiError && e.status === 401)) setErroDetalhe("Não foi possível carregar os detalhes da OM."); setAbertaId(null); });
    return () => { vivo = false; };
  }, [abertaId, fila, extra?.id]);
  const recarregarDetalhe = useCallback(async () => {
    if (abertaId) { try { setExtra(await buscarOm(abertaId)); } catch { /* mantém o que está na tela */ } }
    recarregar();
  }, [abertaId, recarregar]);

  useEffect(() => {
    let vivo = true;
    setLista(null);
    Promise.allSettled([listarOrdens(status || undefined), buscarFila()]).then(([o, f]) => {
      if (!vivo) return;
      if (o.status === "fulfilled") { setLista(o.value); setErro(null); }
      else if (!(o.reason instanceof ApiError && o.reason.status === 401)) { setLista([]); setErro(o.reason instanceof ApiError && o.reason.status === 0 ? "Sem conexão com o servidor." : "Não foi possível carregar as ordens."); }
      setFila(f.status === "fulfilled" ? new Map(Object.values(f.value.colunas).flat().map((x) => [x.id, x])) : new Map());
    });
    return () => { vivo = false; };
  }, [status, tick]);

  const q = busca.trim().toLowerCase();
  const vis = (lista ?? []).filter((o) => !q || [o.numero, o.equipamento.codigo, o.equipamento.nome, o.solicitante.nome, o.titulo].some((t) => t.toLowerCase().includes(q)));

  return (
    <section aria-label="Ordens de manutenção" className="flex min-w-0 max-w-full flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Ordens de manutenção</h1>
          <p className="text-muted">Últimas 100 OMs {status ? "com o status selecionado" : "de todos os status"}.</p>
        </div>
        <button onClick={recarregar} className={btnSec}><Icone nome="atualizar" />Atualizar</button>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map(([k, l]) => (
          <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold ${status === k ? "bg-brand-600 text-white" : "bg-panel ring-1 ring-line hover:bg-brand-50"}`}>{l}</button>
        ))}
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nº, TAG, equipamento, solicitante…" aria-label="Buscar"
          className="ml-auto min-h-11 w-full min-w-0 rounded-lg bg-panel px-3 ring-1 ring-line dark:bg-ink sm:w-80" />
      </div>
      {aviso && <AvisoDesfazer key={aviso.omId + aviso.msg} omId={aviso.omId} mensagem={aviso.msg} onFechar={() => setAviso(null)} onDesfeito={() => { setAviso(null); recarregar(); }} />}
      {erro && <Faixa tipo="erro">{erro}</Faixa>}
      {erroDetalhe && <Faixa tipo="erro">{erroDetalhe}</Faixa>}
      <div className="max-w-full overflow-x-auto rounded-2xl bg-panel ring-1 ring-line">
        {!lista ? <p className="p-6 text-muted">Carregando…</p> : vis.length === 0 ? <p className="p-10 text-center text-muted">Nenhuma OM encontrada.</p> : (
          <table className="tabela-cartoes w-full min-w-[56rem] text-left">
            <caption className="sr-only">Ordens de manutenção</caption>
            <thead className="bg-brand-50 text-sm uppercase tracking-wide text-muted">
              <tr><th scope="col" className="p-3">OM</th><th scope="col" className="p-3">Prioridade</th><th scope="col" className="p-3">Equipamento</th><th scope="col" className="p-3">Problema</th><th scope="col" className="p-3">Status</th><th scope="col" className="p-3">Técnico</th><th scope="col" className="p-3">Solicitante</th><th scope="col" className="p-3">Abertura</th><th scope="col" className="p-3"><span className="sr-only">Detalhes</span></th></tr>
            </thead>
            <tbody className="divide-y divide-line/40 dark:divide-line-soft">
              {vis.map((o) => {
                const p = PRIORIDADE[o.prioridade], s = STATUS_OM[o.status] ?? { label: o.status, cls: "bg-slate-200 text-slate-800" };
                const f = fila.get(o.id);
                const tecnico = f?.reservadaPara?.nome ?? f?.responsavel?.nome ?? null;
                const podeAtribuir = !!f && (o.status === "ABERTA" || o.status === "RESERVADA");
                const reatribuir = o.status === "RESERVADA";
                return (
                  <tr key={o.id} className="hover:bg-brand-50">
                    <td data-rotulo="OM" className="whitespace-nowrap p-3 font-bold tabular-nums text-primary-fg">
                      <button onClick={() => abrir(o.id)} aria-label={`Ver detalhes da OM ${o.numero}`} className="underline decoration-dotted underline-offset-4 hover:text-fg">{o.numero}</button>
                    </td>
                    <td data-rotulo="Prioridade" className="p-3"><span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-extrabold ${p.cls}`}>{p.label}</span></td>
                    <td data-rotulo="Equipamento" className="p-3"><span className="font-semibold">{o.equipamento.codigo}</span> · {o.equipamento.nome}<span className="block text-sm text-muted">{setorDaOm(o)}</span></td>
                    <td data-rotulo="Problema" className="p-3">{o.sintomas.join(", ") || o.titulo}</td>
                    <td data-rotulo="Status" className="p-3"><span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-bold ${s.cls}`}>{s.label}</span></td>
                    <td data-rotulo="Técnico" className="p-3">
                      {tecnico ? <span className="font-semibold">{tecnico}</span> : <span className="text-muted">—</span>}
                      {podeAtribuir && (
                        <button onClick={() => setAtribuindo({ om: o, fila: f })} aria-label={`${reatribuir ? "Reatribuir" : "Atribuir"} técnico para ${o.numero}`}
                          className="mt-1 flex min-h-11 items-center gap-1 rounded-lg bg-panel px-3 text-sm font-semibold ring-1 ring-line hover:bg-brand-50">
                          <Icone nome="enviar" className="h-4 w-4" />{reatribuir ? "Reatribuir" : "Atribuir"}
                        </button>
                      )}
                    </td>
                    <td data-rotulo="Solicitante" className="p-3">{o.solicitante.nome}</td>
                    <td data-rotulo="Abertura" className="whitespace-nowrap p-3 text-muted" title={new Date(o.dataAbertura).toLocaleString("pt-BR")}>{haQuanto(o.dataAbertura)}</td>
                    <td className="p-3">
                      <button onClick={() => abrir(o.id)} aria-label={`Abrir detalhes e ficha da OM ${o.numero}`}
                        className="flex min-h-11 items-center gap-1 rounded-lg bg-panel px-3 text-sm font-semibold ring-1 ring-line hover:bg-brand-50">
                        <Icone nome="prancheta" className="h-4 w-4" />Detalhes
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {aberta && <OmDetail key={aberta.id} om={aberta} user={user} podeAgir={false} onClose={() => setAbertaId(null)} onChanged={recarregarDetalhe} />}

      {atribuindo && (
        <AtribuirTecnico om={{ id: atribuindo.om.id, numero: atribuindo.om.numero, prioridade: atribuindo.om.prioridade, equipamento: atribuindo.om.equipamento, setorExibicao: setorDaOm(atribuindo.om), reservadaPara: atribuindo.fila.reservadaPara }}
          onFechar={() => setAtribuindo(null)} onAtualizar={recarregar}
          onAtribuido={(a) => {
            const om = atribuindo.om; setAtribuindo(null);
            setAviso({ omId: om.id, msg: `${om.numero} ${a.reatribuicao ? "reatribuída" : "reservada"} para ${a.tecnico.nome}.` });
            recarregar();
          }} />
      )}
    </section>
  );
}
