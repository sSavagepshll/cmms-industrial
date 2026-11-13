"use client";
import { setorDaOm } from "@/lib/rotulos";
import { useState } from "react";
import { ApiError, aprovarOm, reprovarOm } from "@/lib/api";
import { tempoCurto, useContagem } from "@/hooks/useContagem";
import { PRIORIDADE, duracaoHumana, haQuanto, lerSolucao } from "@/lib/kanban";
import { textoBloqueio } from "@/lib/aprovacao";
import type { Aprovacao } from "@/lib/types";
import { VirtualKeyboard } from "../kiosk/VirtualKeyboard";
import { BarraAcoes } from "../ui/BarraAcoes";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { PedirPin } from "../ui/PedirPin";

export const MOTIVO_MAX = 500;
const dh = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

/**
 * Decisão sobre uma OM em AGUARDANDO_APROVACAO: resumo da execução + Aprovar / Reprovar (motivo obrigatório, PIN do decisor).
 * Compartilhado por Totem (modo "totem": alvos de luva, teclado virtual, ações numa BARRA FIXA no rodapé), Kanban e Painel
 * Admin (modo "admin": mouse/teclado). Quem pode decidir vem do SERVIDOR (podeAprovar/aprovaEmSegundos/decideEmNomeDe):
 * sem permissão os botões ficam ocultos e a tela explica o porquê. Escopo global: o líder vê todas as OMs.
 * `onAtualizar` é chamado quando a contagem do líder zera (a OM passou a ser decidível: recarregar a lista).
 */
export function DecisaoAprovacao({ om, modo, onDecidida, onAtualizar }: {
  om: Aprovacao; modo: "totem" | "admin"; onDecidida: (resultado: "aprovada" | "reprovada" | "desatualizada") => void; onAtualizar?: () => void;
}) {
  const totem = modo === "totem";
  const [reprovando, setReprovando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pedindoPin, setPedindoPin] = useState<null | "aprovar" | "reprovar">(null);
  const p = PRIORIDADE[om.prioridade];
  const solucao = lerSolucao(om.solucao);

  const bloqueado = om.podeAprovar === false; // sem a flag (API antiga) assume que pode: a API recusa de qualquer forma
  const aguardeOperador = bloqueado && om.motivoBloqueio === "AGUARDE_OPERADOR";
  const falta = useContagem(aguardeOperador ? om.aprovaEmSegundos : undefined, onAtualizar);

  // Aprovar/reprovar pedem o PIN do PRÓPRIO decisor (RN-24). Erro de PIN fica no diálogo; "já decidida" avisa e atualiza.
  async function decidirComPin(pin: string) {
    const reprovar = pedindoPin === "reprovar";
    try {
      if (reprovar) await reprovarOm(om.id, motivo.trim(), pin); else await aprovarOm(om.id, pin);
    } catch (e) {
      if (e instanceof ApiError && e.code === "STATUS_INVALIDO") setTimeout(() => onDecidida("desatualizada"), 1800);
      throw e;
    }
    setPedindoPin(null);
    onDecidida(reprovar ? "reprovada" : "aprovada");
  }

  const dados: [string, string][] = [
    ["Equipamento", `${om.equipamento.codigo} · ${om.equipamento.nome}`],
    ["Setor", `${setorDaOm(om)}${!om.equipamento.predial && !om.equipamento.itemLivre && om.equipamento.localizacao ? ` · ${om.equipamento.localizacao}` : ""}`],
    ["Problema", om.sintomas.join(", ") || om.titulo],
    ["Solicitante", om.solicitante.nome],
    ["Executante", om.responsavel?.nome ?? "—"],
    ["Aberta em", dh(om.dataAbertura)],
    ["Finalizada em", `${dh(om.dataConclusao)}${om.dataConclusao ? ` (${haQuanto(om.dataConclusao)})` : ""}`],
    ["Parada (abertura → fim)", om.dataConclusao ? duracaoHumana((new Date(om.dataConclusao).getTime() - new Date(om.dataAbertura).getTime()) / 1000) : "—"],
  ];
  const txt = totem ? "text-xl md:text-2xl" : "text-base";
  // totem: alvos de luva (Fase 9: primário 96 px); admin: 48 px de mouse
  const btn = totem ? "min-h-16 md:min-h-tap-lg text-2xl md:text-3xl" : "min-h-12 text-lg";
  const ic = totem ? "h-7 w-7" : "h-5 w-5";

  const botoesDecidir = (
    <div className={`grid grid-cols-2 gap-3 ${totem ? "md:gap-4" : ""}`}>
      <button onClick={() => setPedindoPin("aprovar")}
        className={`${btn} inline-flex items-center justify-center gap-2 rounded-2xl bg-green-700 px-4 font-extrabold text-white`}><Icone nome="check" className={ic} />APROVAR</button>
      <button onClick={() => setReprovando(true)}
        className={`${btn} inline-flex items-center justify-center gap-2 rounded-2xl bg-panel px-4 font-extrabold text-danger-fg ring-4 ring-danger-fg`}><Icone nome="fechar" className={ic} />REPROVAR</button>
    </div>
  );
  const botoesReprovar = (
    <div className={`grid grid-cols-2 gap-3 ${totem ? "md:gap-4" : ""}`}>
      <button onClick={() => { setReprovando(false); setMotivo(""); }} className={`${btn} rounded-2xl bg-panel px-4 font-bold ring-1 ring-line`}>Voltar</button>
      <button disabled={!motivo.trim()} onClick={() => setPedindoPin("reprovar")}
        className={`${btn} rounded-2xl bg-red-700 px-4 font-extrabold text-white`}>Confirmar reprovação</button>
    </div>
  );

  return (
    <section aria-label={`Decisão da OM ${om.numero}`} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className={`font-extrabold tabular-nums ${totem ? "text-3xl md:text-4xl" : "text-2xl"}`}>{om.numero}</h2>
        <span className={`rounded-full px-3 py-1 font-extrabold ${totem ? "text-lg" : "text-sm"} ${p.cls}`}>{p.label}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 font-bold text-primary-fg ${totem ? "text-lg" : "text-sm"}`}><Icone nome="relogio" className={totem ? "h-5 w-5" : "h-4 w-4"} />Aguardando aprovação</span>
      </header>

      {bloqueado && (
        <Faixa tipo="atencao" className={txt}>
          {textoBloqueio(om)}
          {aguardeOperador && (falta !== null && falta > 0
            ? <> Libera para você em <strong className="tabular-nums">{tempoCurto(falta)}</strong>.</>
            : <> Atualizando…</>)}
        </Faixa>
      )}
      {!bloqueado && om.decideEmNomeDe && <Faixa tipo="info" className={txt}>Você decide em nome de {om.decideEmNomeDe}.</Faixa>}

      <dl className="divide-y divide-line dark:divide-line-soft rounded-2xl bg-panel ring-1 ring-line">
        {dados.map(([k, v]) => (
          <div key={k} className={`flex flex-col gap-1 p-3 sm:flex-row sm:gap-4 ${txt}`}>
            <dt className={`shrink-0 text-muted ${totem ? "sm:w-56" : "sm:w-48"}`}>{k}</dt><dd className="font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="rounded-2xl bg-brand-50 p-4 ring-2 ring-brand-300">
        <h3 className={`font-extrabold text-primary-fg ${totem ? "text-2xl" : "text-lg"}`}>O que o técnico executou</h3>
        {solucao.length === 0 ? <p className={`mt-2 text-muted ${txt}`}>Sem descrição da solução.</p> : (
          <dl className="mt-2 flex flex-col gap-2">
            {solucao.map((s, i) => (
              <div key={i} className={txt}>{s.rotulo && <dt className="text-sm font-bold uppercase tracking-wide text-muted">{s.rotulo}</dt>}<dd className="whitespace-pre-wrap font-semibold">{s.texto}</dd></div>
            ))}
          </dl>
        )}
      </div>

      {!bloqueado && reprovando && (
        <div className="flex flex-col gap-3 rounded-2xl bg-red-50 p-4 ring-2 ring-danger-fg">
          <h3 className={`font-extrabold text-red-800 ${totem ? "text-2xl" : "text-lg"}`}>Reprovar: informe o motivo *</h3>
          <p className={`text-muted ${totem ? "text-lg" : "text-sm"}`}>A OM volta para <strong>Em atendimento</strong> e o técnico verá este motivo.</p>
          {totem ? (
            <>
              <div className="min-h-20 rounded-xl bg-panel p-3 text-xl ring-2 ring-danger-fg">
                {motivo || <span className="text-muted">Toque nas teclas para digitar o motivo…</span>}
                <span className="float-right text-lg text-muted">{motivo.length}/{MOTIVO_MAX}</span>
              </div>
              <VirtualKeyboard value={motivo} onChange={setMotivo} maxLength={MOTIVO_MAX} />
            </>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="sr-only">Motivo da reprovação</span>
              <textarea autoFocus value={motivo} maxLength={MOTIVO_MAX} onChange={(e) => setMotivo(e.target.value)} rows={4}
                className="rounded-xl bg-panel p-3 text-base ring-2 ring-danger-fg focus:outline-none" placeholder="Descreva o que precisa ser refeito…" />
              <span className="self-end text-sm text-muted">{motivo.length}/{MOTIVO_MAX}</span>
            </label>
          )}
          {!totem && botoesReprovar}
        </div>
      )}

      {/* Ações: no totem ficam numa barra fixa no rodapé (a decisão nunca exige rolagem); no admin, no fluxo. */}
      {!bloqueado && (totem
        ? <BarraAcoes rotulo="Decisão">{reprovando ? botoesReprovar : botoesDecidir}</BarraAcoes>
        : !reprovando && botoesDecidir)}

      {pedindoPin && (
        <PedirPin modo={modo} perigoso={pedindoPin === "reprovar"} titulo={pedindoPin === "aprovar" ? "Aprovar a OM" : "Confirmar a reprovação"}
          rotuloConfirmar={pedindoPin === "aprovar" ? "Aprovar" : "Reprovar"} onCancelar={() => setPedindoPin(null)} onConfirmar={decidirComPin}>
          <p><strong className="tabular-nums">{om.numero}</strong> · {om.equipamento.codigo} · {om.equipamento.nome}</p>
          {om.decideEmNomeDe && <p className="mt-1">Você decide em nome de {om.decideEmNomeDe}.</p>}
          {pedindoPin === "reprovar" && <p className="mt-1">Motivo: {motivo.trim()}</p>}
        </PedirPin>
      )}
    </section>
  );
}
