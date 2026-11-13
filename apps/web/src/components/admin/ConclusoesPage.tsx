"use client";
import { useState } from "react";
import { ApiError, concluirOmGestor } from "@/lib/api";
import { CUSTOS } from "@/lib/rotulos";
import { PRIORIDADE, duracaoHumana, haQuanto } from "@/lib/kanban";
import { nomeAtivo, rotuloPerfilAprovador, setorDaOm } from "@/lib/rotulos";
import type { ConclusaoPendente, CustoEncerramento } from "@/lib/types";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { PedirPin } from "../ui/PedirPin";
import { btnPrim, campo } from "../ui/estilos";

const dataHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

/**
 * Conclusões pendentes (Fase 21, GERENTE/ADMIN): OMs aprovadas pela produção (AGUARDANDO_BAIXA, exibido como "Aguardando conclusão").
 * O gestor confere quem executou e quem aprovou e conclui com o PIN. Quem executou a OM não conclui (botão desabilitado, com motivo).
 */
export function ConclusoesPage({ lista, erro, onRecarregar }: { lista: ConclusaoPendente[] | null; erro: string | null; onRecarregar: () => void }) {
  const [alvo, setAlvo] = useState<ConclusaoPendente | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Fase 31 (RN-52): o custo é definido no encerramento (obrigatório); centro de custo é opcional (≤50).
  const [custo, setCusto] = useState<CustoEncerramento | "">("");
  const [centro, setCentro] = useState("");
  const abrir = (o: ConclusaoPendente) => { setAviso(null); setCusto(""); setCentro(""); setAlvo(o); };

  async function concluir(pin: string) {
    if (!alvo || !custo) return;
    try {
      await concluirOmGestor(alvo.id, pin, custo, centro);
    } catch (e) {
      // 409 STATUS_INVALIDO: outra pessoa concluiu antes ou o status mudou. A mensagem fica no diálogo e a lista é atualizada.
      if (e instanceof ApiError && e.status === 409) onRecarregar();
      throw e;
    }
    setAviso(`OM ${alvo.numero} concluída.`);
    setAlvo(null);
    onRecarregar();
  }

  return (
    <section aria-label="Conclusões pendentes" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Conclusões pendentes</h1>
          <p className="text-muted">OMs já aprovadas pela produção. Confira quem executou e quem aprovou e conclua com o seu PIN. Quem executou a OM não pode concluí-la.</p>
        </div>
        <button onClick={onRecarregar} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-panel px-4 font-semibold ring-1 ring-line hover:bg-brand-50"><Icone nome="atualizar" className="h-4 w-4" />Atualizar</button>
      </header>
      {aviso && <Faixa tipo="ok">{aviso}</Faixa>}
      {erro && <Faixa tipo="erro">{erro}</Faixa>}

      {!lista ? <p className="rounded-2xl bg-panel p-6 text-muted ring-1 ring-line">Carregando…</p> : lista.length === 0 ? (
        <p className="flex flex-col items-center gap-2 rounded-2xl bg-panel p-10 text-center text-lg text-muted ring-1 ring-line"><Icone nome="checkCirculo" className="h-10 w-10 text-ok-fg" />Nenhuma OM aguardando conclusão.</p>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {lista.map((o) => {
            const p = PRIORIDADE[o.prioridade];
            const parada = o.dataConclusao ? (new Date(o.dataConclusao).getTime() - new Date(o.dataAbertura).getTime()) / 1000 : null;
            return (
              <li key={o.id} className="flex flex-col gap-3 rounded-2xl bg-panel p-5 ring-1 ring-line">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xl font-extrabold tabular-nums text-primary-fg">{o.numero}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-sm font-extrabold ${p.cls}`}>{p.label}</span>
                </div>
                <p className="text-lg font-semibold"><span className="text-primary-fg">{o.equipamento.codigo}</span> · {nomeAtivo(o.equipamento, o.localDescricao, o.itemDescricao)}
                  <span className="block text-sm font-normal text-muted">{setorDaOm(o)}</span></p>
                {o.solucao && <p className="whitespace-pre-wrap rounded-xl bg-brand-50 p-3 text-sm">{o.solucao}</p>}
                <dl className="grid gap-1 text-base">
                  <div><dt className="inline font-semibold">Executou: </dt>
                    <dd className="inline">{o.executores.length === 0 ? "—" : o.executores.map((x) => `${x.nome}${x.tempoSegundos > 0 ? ` (${duracaoHumana(x.tempoSegundos)})` : ""}`).join(", ")}</dd></div>
                  <div><dt className="inline font-semibold">Aprovou: </dt>
                    <dd className="inline">{o.aprovadoPor ? `${o.aprovadoPor.nome} (${rotuloPerfilAprovador(o.aprovadoPor.perfil)})` : "—"}
                      {o.aprovadoEmNomeDe && <span className="text-muted"> · em nome de {o.aprovadoEmNomeDe.nome}</span>}</dd></div>
                  <div className="text-sm text-muted">Finalizada {dataHora(o.dataConclusao)} · aprovada {dataHora(o.dataAprovacao)}{o.dataAprovacao ? ` (${haQuanto(o.dataAprovacao)})` : ""} · parada {duracaoHumana(parada)}</div>
                </dl>
                <div className="mt-auto flex flex-col items-end gap-2">
                  <button onClick={() => abrir(o)} disabled={!o.podeConcluir} aria-label={`Concluir OM ${o.numero}`} className={`${btnPrim} min-h-12`}>
                    <Icone nome="check" />Concluir OM
                  </button>
                  {!o.podeConcluir && <p role="note" className="text-sm font-semibold text-danger-fg">{o.motivoBloqueio === "AUTOCONCLUSAO_PROIBIDA" || !o.motivoBloqueio ? "Você executou esta OM e não pode concluí-la." : o.motivoBloqueio}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {alvo && (
        <PedirPin titulo={`Concluir OM ${alvo.numero}?`} rotuloConfirmar="Concluir OM" modo="admin" bloqueado={!custo} onCancelar={() => setAlvo(null)} onConfirmar={concluir}>
          <p>{alvo.equipamento.codigo} · {nomeAtivo(alvo.equipamento, alvo.localDescricao, alvo.itemDescricao)}</p>
          <p className="mt-1 text-sm text-muted">Executou: {alvo.executores.map((x) => x.nome).join(", ") || "—"} · Aprovou: {alvo.aprovadoPor?.nome ?? "—"}</p>
          <fieldset className="mt-3 flex flex-col gap-2">
            <legend className="font-semibold">Custo <span aria-hidden className="text-danger-fg">*</span></legend>
            <div className="flex gap-4">
              {CUSTOS.map((x) => (
                <label key={x.key} className="inline-flex min-h-11 items-center gap-2 font-semibold">
                  <input type="radio" name="custo-encerramento" value={x.key} checked={custo === x.key} onChange={() => setCusto(x.key as CustoEncerramento)} className="h-5 w-5" />{x.label}
                </label>
              ))}
            </div>
            {!custo && <p role="note" className="text-sm text-muted">Escolha Interno ou Cliente para liberar a conclusão.</p>}
          </fieldset>
          <label className="mt-3 flex flex-col gap-1">
            <span className="font-semibold">Centro de custo <span className="font-normal text-muted">(opcional)</span></span>
            <input value={centro} onChange={(e) => setCentro(e.target.value)} maxLength={50} className={campo} />
          </label>
        </PedirPin>
      )}
    </section>
  );
}
