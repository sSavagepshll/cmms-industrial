"use client";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  AMOSTRA_MIN, PRIORIDADES, numero, pct1, plural, rotuloData, tempo, variacaoDe,
  type BacklogResp, type EquipeResp, type FluxoResp, type KpiNum, type KpisResp, type MetaResp, type Prio, type TecnicoEquipe, type ZonasSrv,
} from "@/lib/desempenho";
import { PRIORIDADE } from "@/lib/kanban";
import { rotuloCategoria, rotuloMotivoPausa } from "@/lib/rotulos";
import type { MttrResp, Ofensor, PausasResp, QuebraMttr } from "@/lib/types";
import { Icone } from "../../ui/Icones";
import { AmostraBaixa, Bloco, BarraLinha, EsqueletoBarras, EsqueletoBloco, TabelaAlt, Vazio, type EstadoDado } from "./comum";
import { Anel, BarraEmpilhada, FluxoGraficos, GraficoMttrEvolucao, GraficoVolumeOms, LegendaFluxo, Sparkline } from "./graficos";

type Estado = EstadoDado | "vazio";
interface Comum { estado: EstadoDado; onTentar: () => void }

// ======================= KPIs =======================
function StatTile({ rotulo, valor, detalhe, kpi, menorMelhor, neutra, onClick, extra }: {
  rotulo: string; valor: string; detalhe?: ReactNode; kpi?: KpiNum; menorMelhor?: boolean; neutra?: boolean; onClick?: () => void; extra?: ReactNode;
}) {
  const v = variacaoDe(kpi, { menorMelhor, neutra });
  const cor = v?.direcao === "melhor" ? "text-ok-soft-fg" : v?.direcao === "pior" ? "text-warn-soft-fg" : "text-muted";
  const fundo = v?.direcao === "melhor" ? "bg-ok-soft" : v?.direcao === "pior" ? "bg-warn-soft" : "";
  const corpo = (
    <>
      <p className="text-sm font-semibold text-muted">{rotulo}</p>
      <p className="mt-0.5 text-3xl font-extrabold tabular-nums">{valor}</p>
      {v && (
        <p className={`mt-1 inline-flex items-start gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${cor} ${fundo}`}>
          {v.direcao === "melhor" && <Icone nome="check" className="h-3.5 w-3.5" />}{v.direcao === "pior" && <Icone nome="alerta" className="h-3.5 w-3.5" />}
          {v.texto}{v.direcao === "melhor" ? " (melhor)" : v.direcao === "pior" ? " (pior)" : ""}
        </p>
      )}
      {detalhe && <p className="mt-1 text-sm text-muted">{detalhe}</p>}
      {extra}
      {kpi?.serie && <div className="tv-oculto mt-auto pt-2"><Sparkline valores={kpi.serie} /></div>}
    </>
  );
  const cls = "flex min-w-0 flex-col rounded-2xl bg-panel p-3 text-left ring-1 ring-line";
  return onClick
    ? <button onClick={onClick} className={`${cls} hover:bg-brand-50 focus-visible:ring-2`}>{corpo}</button>
    : <div className={cls}>{corpo}</div>;
}

export function FaixaKpis({ dados, estado, onTentar, onIrOrdens }: Comum & { dados: KpisResp | null; onIrOrdens: () => void }) {
  if (estado === "carregando" && !dados) {
    return <div aria-busy="true" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-32 rounded-2xl bg-viz-track motion-safe:animate-pulse" />)}</div>;
  }
  if (!dados) {
    return <Bloco titulo="Indicadores" estado="erro" erroTexto="Indicadores indisponíveis no momento." onTentar={onTentar} esqueleto={null} />;
  }
  const k = dados.kpis;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]" aria-label="Indicadores do período">
      <StatTile rotulo="Concluídas" valor={numero(k.concluidas.valor)} kpi={k.concluidas} neutra onClick={onIrOrdens} detalhe="OMs aprovadas no período" />
      <StatTile rotulo="Backlog agora" valor={numero(dados.backlog.total)} onClick={onIrOrdens} detalhe="OMs em aberto" />
      <StatTile rotulo="Críticas" valor={numero(dados.backlog.criticas)} onClick={onIrOrdens}
        detalhe={dados.backlog.criticas > 0 ? <span className="inline-flex items-center gap-1 font-semibold text-warn-soft-fg"><Icone nome="alerta" className="h-3.5 w-3.5" />no backlog</span> : "nenhuma crítica"} />
      {k.retrabalhoPct && (
        <StatTile rotulo="Retrabalho" valor={k.retrabalhoPct.valor === null ? "—" : pct1(k.retrabalhoPct.valor)} kpi={k.retrabalhoPct} menorMelhor
          detalhe={k.retrabalhoPct.base ? plural(k.retrabalhoPct.base, "envio p/ aprovação", "envios p/ aprovação") : "sem base no período"} />
      )}
      <StatTile rotulo="Tempo parado" valor={tempo(k.tempoParadaSegundos.valor)} kpi={k.tempoParadaSegundos} menorMelhor detalhe="máquina parada nas OMs do período" />
      {k.recusaPct && (
        <StatTile rotulo="Recusas de reserva" valor={k.recusaPct.valor === null ? "—" : pct1(k.recusaPct.valor)} kpi={k.recusaPct} menorMelhor
          detalhe={k.recusaPct.base ? plural(k.recusaPct.base, "reserva", "reservas") : "sem base no período"} />
      )}
    </div>
  );
}

// ======================= Fluxo de OMs =======================
export function FluxoOms({ dados, estado, onTentar, comparando, metaMttrSegundos }: Comum & { dados: FluxoResp | null; comparando: boolean; metaMttrSegundos?: number | null }) {
  const serie = dados?.serie ?? [];
  const vazio = serie.length === 0 || serie.every((s) => s.ordensConcluidas === 0 && (s.abertas ?? 0) === 0);
  const est: Estado = estado === "carregando" && !dados ? "carregando" : !dados ? "erro" : vazio ? "vazio" : "ok";
  return (
    <Bloco titulo="Fluxo de OMs" nota="abertas × concluídas e MTTR" estado={est} onTentar={onTentar} className="xl:col-span-8"
      esqueleto={<EsqueletoBloco alto={300} />} erroTexto="Fluxo de OMs indisponível no momento."
      vazio={<Vazio texto="Sem OMs no período." dica="Amplie o período para ver o fluxo." />}>
      <div className="mt-2"><LegendaFluxo comparando={comparando && !!dados?.anterior} comMeta={!!metaMttrSegundos} /></div>
      <div className="fluxo-area relative mt-2 flex-1"><FluxoGraficos serie={serie} anterior={comparando ? dados?.anterior : undefined} metaMttrSegundos={metaMttrSegundos} /></div>
      <TabelaAlt titulo="Fluxo de OMs por período" arquivo="fluxo-oms"
        colunas={["Período", "Abertas", "Concluídas", "MTTR (mão de obra)", "Tempo de parada", "MTTA"]}
        linhas={serie.map((s) => [rotuloData(s.periodo), s.abertas ?? 0, s.ordensConcluidas, tempo(s.mttrLiquidoSegundos), tempo(s.mttrTotalSegundos), tempo(s.mttaSegundos)])} />
    </Bloco>
  );
}

/** Legenda de uma série (quadrado ou traço). */
const itemLegenda = (marca: ReactNode, t: string) => <li className="inline-flex items-center gap-1.5">{marca}{t}</li>;
const semDados = (dados: FluxoResp | null) => { const serie = dados?.serie ?? []; return serie.length === 0 || serie.every((s) => s.ordensConcluidas === 0 && (s.abertas ?? 0) === 0); };

/** Volume de OMs (Fase 27): colunas Abertas × Concluídas, com os totais do período na legenda. */
export function BlocoVolumeOms({ dados, estado, onTentar }: Comum & { dados: FluxoResp | null }) {
  const serie = dados?.serie ?? [];
  const est: Estado = estado === "carregando" && !dados ? "carregando" : !dados ? "erro" : semDados(dados) ? "vazio" : "ok";
  const totA = serie.reduce((a, s) => a + (s.abertas ?? 0), 0), totC = serie.reduce((a, s) => a + s.ordensConcluidas, 0);
  return (
    <Bloco titulo="Volume de OMs" nota="abertas × concluídas" estado={est} onTentar={onTentar} className="xl:col-span-6"
      esqueleto={<EsqueletoBloco alto={260} />} erroTexto="Volume de OMs indisponível no momento."
      vazio={<Vazio texto="Sem OMs no período." dica="Amplie o período para ver o volume." />}>
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        {itemLegenda(<span aria-hidden className="h-3 w-3 rounded-sm" style={{ background: "var(--viz-1)" }} />, `Abertas (${numero(totA)})`)}
        {itemLegenda(<span aria-hidden className="h-3 w-3 rounded-sm" style={{ background: "var(--viz-2)" }} />, `Concluídas (${numero(totC)})`)}
      </ul>
      <div className="fluxo-area relative mt-2 flex-1"><GraficoVolumeOms serie={serie} /></div>
      <TabelaAlt titulo="Volume de OMs por período" arquivo="volume-oms" colunas={["Período", "Abertas", "Concluídas"]}
        linhas={serie.map((s) => [rotuloData(s.periodo), s.abertas ?? 0, s.ordensConcluidas])} />
    </Bloco>
  );
}

/** Evolução do MTTR (Fase 27): linha do MTTR (mão de obra), meta e, com a comparação ativa, o período anterior. */
export function BlocoMttrEvolucao({ dados, estado, onTentar, comparando, metaMttrSegundos }: Comum & { dados: FluxoResp | null; comparando: boolean; metaMttrSegundos?: number | null }) {
  const serie = dados?.serie ?? [];
  const semMttr = serie.every((s) => s.mttrLiquidoSegundos === null);
  const est: Estado = estado === "carregando" && !dados ? "carregando" : !dados ? "erro" : serie.length === 0 || semMttr ? "vazio" : "ok";
  const comp = comparando && !!dados?.anterior;
  return (
    <Bloco titulo="Evolução do MTTR" nota="tempo de reparo vs meta" estado={est} onTentar={onTentar} className="xl:col-span-6"
      esqueleto={<EsqueletoBloco alto={260} />} erroTexto="Evolução do MTTR indisponível no momento."
      vazio={<Vazio texto="Sem MTTR no período." dica="Amplie o período ou aguarde OMs concluídas com apontamento." />}>
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        {itemLegenda(<svg aria-hidden width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--viz-1)" strokeWidth="2" /></svg>, "MTTR (mão de obra)")}
        {comp && itemLegenda(<svg aria-hidden width="22" height="6"><line x1="1" y1="3" x2="21" y2="3" stroke="var(--c-muted)" strokeWidth="2" strokeDasharray="0.1 5" strokeLinecap="round" /></svg>, "Período anterior")}
        {!!metaMttrSegundos && itemLegenda(<svg aria-hidden width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" stroke="var(--c-muted)" strokeWidth="1.5" strokeDasharray="10 5" /></svg>, "Meta de MTTR")}
      </ul>
      <div className="fluxo-area relative mt-2 flex-1"><GraficoMttrEvolucao serie={serie} anterior={comp ? dados?.anterior : undefined} metaMttrSegundos={metaMttrSegundos} /></div>
      <TabelaAlt titulo="Evolução do MTTR por período" arquivo="evolucao-mttr" colunas={["Período", "MTTR (mão de obra)", "Meta de MTTR"]}
        linhas={serie.map((s) => [rotuloData(s.periodo), tempo(s.mttrLiquidoSegundos), metaMttrSegundos ? tempo(metaMttrSegundos) : "—"])} />
    </Bloco>
  );
}

// ======================= Medidor de meta =======================
const ESTILO_ZONA = {
  ok: { rot: "dentro da meta", cls: "text-ok-soft-fg", arco: "stroke-ok-fg", ic: "check" as const },
  atencao: { rot: "atenção", cls: "text-warn-soft-fg", arco: "stroke-[#b45309] dark:stroke-warn-fg", ic: "alerta" as const },
  perigo: { rot: "abaixo da meta", cls: "text-danger-soft-fg", arco: "stroke-danger-fg", ic: "fechar" as const },
};
/** Zona pelos limiares do SERVIDOR (US-12); sem limiar aprovado => sem zona (sem cor). */
const limiar = (p: number, z?: ZonasSrv) => {
  if (!z || z.metaOkPct == null || z.metaAtencaoPct == null) return null;
  return p >= z.metaOkPct ? ESTILO_ZONA.ok : p >= z.metaAtencaoPct ? ESTILO_ZONA.atencao : ESTILO_ZONA.perigo;
};

export function MedidorMeta({ dados, estado, onTentar, onIrParametros }: Comum & { dados: MetaResp | null; onIrParametros: () => void }) {
  const configurada = !!dados?.configurada && !!dados.geral;
  const semOms = !!dados?.configurada && !!dados.geral && dados.geral.total === 0;
  const est: Estado = estado === "carregando" && !dados ? "carregando" : !dados ? "erro" : semOms ? "vazio" : "ok";
  const g = dados?.geral;
  const p = g?.pct ?? null;
  const st = p !== null ? limiar(p, dados?.zonas) : null;
  const pp = p !== null && g?.anteriorPct !== undefined && g.anteriorPct !== null ? p - g.anteriorPct : null;
  return (
    <Bloco titulo="Atendimento dentro da meta" nota="MTTA" estado={est} onTentar={onTentar} className="xl:col-span-4"
      esqueleto={<EsqueletoBloco alto={300} />} erroTexto="Medidor de meta indisponível no momento."
      vazio={<Vazio texto="Sem OMs no período." dica="Amplie o período para medir o cumprimento da meta." />}>
      {!configurada ? (
        <div className="py-6 text-center">
          <Icone nome="info" className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-2 font-semibold">Defina as metas de atendimento</p>
          <p className="mt-1 text-sm text-muted">Sem metas cadastradas o painel não calcula o cumprimento. Cadastre o tempo de resposta (MTTA) por prioridade.</p>
          <button onClick={onIrParametros} className="mt-3 min-h-11 rounded-lg bg-brand-600 px-4 font-semibold text-white">Ir para Parâmetros › Metas</button>
        </div>
      ) : (
        <>
          <div className="mt-2">
            <Anel pct={p ?? 0} classeArco={st?.arco ?? "stroke-viz-1"}
              centro={<div><p className="text-5xl font-extrabold tabular-nums">{p === null ? "—" : `${Math.round(p)}%`}</p>
                {st && <p className={`mt-0.5 inline-flex items-center gap-1 text-sm font-semibold ${st.cls}`}><Icone nome={st.ic} className="h-3.5 w-3.5" />{st.rot}</p>}</div>} />
          </div>
          <p className="mt-2 text-center text-sm tabular-nums text-muted">{g?.dentroDaMeta} de {plural(g?.total ?? 0, "OM", "OMs")}{pp !== null && <> · {pp >= 0 ? "▲" : "▼"} {Math.abs(pp).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pp vs período anterior</>}</p>
          <ul className="tv-oculto mt-4 flex flex-col gap-3">
            {[...(dados?.porPrioridade ?? [])].sort((a, b) => PRIORIDADES.indexOf(b.prioridade) - PRIORIDADES.indexOf(a.prioridade)).map((x) => {
              const s = x.pct === null ? null : limiar(x.pct, dados?.zonas);
              return (
                <BarraLinha key={x.prioridade} rotulo={PRIORIDADE[x.prioridade].label} pct={x.pct ?? 0}
                  cor={x.prioridade === "CRITICA" ? "bg-viz-ord-4" : x.prioridade === "ALTA" ? "bg-viz-ord-3" : x.prioridade === "MEDIA" ? "bg-viz-ord-2" : "bg-viz-ord-1"}
                  valor={x.pct === null ? "sem OMs" : `${Math.round(x.pct)} %`}
                  extra={<>{x.dentroDaMeta}/{x.total}{s && <span className={`ml-1 inline-flex items-center gap-0.5 font-semibold ${s.cls}`}><Icone nome={s.ic} className="h-3 w-3" />{s.rot}</span>}</>} />
              );
            })}
          </ul>
          <TabelaAlt titulo="Cumprimento da meta de MTTA" arquivo="meta-mtta" colunas={["Prioridade", "Meta", "Dentro da meta", "Total", "%"]}
            linhas={(dados?.porPrioridade ?? []).map((x) => [PRIORIDADE[x.prioridade].label, tempo(dados?.metasMttaSegundos?.[x.prioridade] ?? null), x.dentroDaMeta, x.total, x.pct === null ? null : `${x.pct}`])} />
        </>
      )}
    </Bloco>
  );
}

// ======================= Equipe agora =======================
const ESTADO_TXT: Record<string, string> = { EM_ATENDIMENTO: "Em atendimento", PAUSADO: "Pausado", COM_RESERVA: "Com reserva", DISPONIVEL: "Disponível" };
const carga = (t: TecnicoEquipe) => t.agora.emAtendimento + t.agora.reservadas + t.agora.pausadas;
const hms = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function EquipeAgora({ dados, estado, onTentar }: Comum & { dados: EquipeResp | null }) {
  const [ordem, setOrdem] = useState<"nome" | "carga">("nome");
  const [agora, setAgora] = useState(() => Date.now());
  const tecnicos = dados?.tecnicos ?? [];
  const temCrono = tecnicos.some((t) => t.agora.omAtual);
  useEffect(() => {
    if (!temCrono) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [temCrono]);
  // Princípio ético: NUNCA do pior para o melhor. Só por nome (A–Z) ou por carga ATUAL (quem tem mais trabalho agora).
  const lista = useMemo(() => [...tecnicos].sort((a, b) => ordem === "nome" ? a.nome.localeCompare(b.nome, "pt-BR") : carga(b) - carga(a) || a.nome.localeCompare(b.nome, "pt-BR")), [tecnicos, ordem]);
  const est: Estado = estado === "carregando" && !dados ? "carregando" : !dados ? "erro" : lista.length === 0 ? "vazio" : "ok";
  return (
    <Bloco titulo="Equipe agora" nota={`(${lista.length})`} estado={est} onTentar={onTentar} className="xl:col-span-6"
      esqueleto={<EsqueletoBarras linhas={5} />} erroTexto="Equipe indisponível no momento." vazio={<Vazio texto="Nenhum técnico ativo." dica="Cadastre técnicos em Configurações › Usuários." />}>
      <div className="tv-oculto mt-2 flex items-center gap-2 text-sm">
        <span className="text-muted">Ordenar por</span>
        <div role="group" aria-label="Ordenar equipe" className="flex gap-1">
          {(["nome", "carga"] as const).map((o) => (
            <button key={o} aria-pressed={ordem === o} onClick={() => setOrdem(o)}
              className={`min-h-11 rounded-full px-3 font-semibold ${ordem === o ? "bg-brand-600 text-white" : "bg-panel ring-1 ring-line hover:bg-brand-50"}`}>{o === "nome" ? "Nome" : "Carga atual"}</button>
          ))}
        </div>
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-line/30 dark:divide-line-soft">
        {lista.map((t) => {
          const seg = t.agora.omAtual ? Math.max(0, Math.floor((agora - new Date(t.agora.omAtual.inicioCronometro).getTime()) / 1000)) : null;
          const p = t.periodo;
          return (
            <li key={t.id} className="py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-semibold">{t.nome}</span>
                <span className="inline-flex items-center gap-1.5 text-sm"><span aria-hidden className={`h-2.5 w-2.5 rounded-full ${t.agora.estado === "DISPONIVEL" ? "bg-viz-3" : "bg-viz-1"}`} />{ESTADO_TXT[t.agora.estado] ?? t.agora.estado}</span>
              </div>
              <p className="text-sm tabular-nums text-muted">
                {t.agora.emAtendimento} em atendimento · {plural(t.agora.reservadas, "reservada", "reservadas")}{t.agora.pausadas > 0 && <> · {plural(t.agora.pausadas, "pausada", "pausadas")}</>}
                {t.agora.omAtual && seg !== null && <> · <span className="text-fg">{t.agora.omAtual.numero}</span> ({t.agora.omAtual.equipamento}) <span className="font-mono text-fg">⏱ {hms(seg)}</span></>}
              </p>
              <p className="tv-oculto text-sm tabular-nums text-muted">
                Período: {plural(p.concluidas, "concluída", "concluídas")}
                {p.amostraSuficiente ? <> · MTTR {tempo(p.mttrLiquidoSegundos)} · retrabalho {pct1(p.retrabalhoPct)}</> : <> · poucos dados (menos de {AMOSTRA_MIN} OMs)</>}
              </p>
            </li>
          );
        })}
      </ul>
      <TabelaAlt titulo="Equipe: carga atual e período" arquivo="equipe"
        colunas={["Técnico", "Estado", "Em atendimento", "Reservadas", "Pausadas", "Concluídas", "MTTR", "MTTA", "Retrabalho", "Horas apontadas"]}
        linhas={lista.map((t) => [t.nome, ESTADO_TXT[t.agora.estado] ?? t.agora.estado, t.agora.emAtendimento, t.agora.reservadas, t.agora.pausadas, t.periodo.concluidas,
          t.periodo.amostraSuficiente ? tempo(t.periodo.mttrLiquidoSegundos) : "poucos dados", t.periodo.amostraSuficiente ? tempo(t.periodo.mttaSegundos) : "poucos dados",
          t.periodo.amostraSuficiente ? pct1(t.periodo.retrabalhoPct) : "poucos dados", tempo(t.periodo.horasApontadasSegundos)])} />
    </Bloco>
  );
}

// ======================= Backlog =======================
const RAMPA = ["bg-viz-ord-1", "bg-viz-ord-2", "bg-viz-ord-3", "bg-viz-ord-4"];
export function BacklogBloco({ dados, estado, onTentar }: Comum & { dados: BacklogResp | null }) {
  const est: Estado = estado === "carregando" && !dados ? "carregando" : !dados ? "erro" : dados.total === 0 ? "vazio" : "ok";
  const s = dados?.porStatus;
  const partes = s ? [
    { rotulo: "Aguardando técnico", n: s.aguardandoTecnico, cor: RAMPA[0] }, { rotulo: "Em atendimento", n: s.emAtendimento, cor: RAMPA[1] },
    { rotulo: "Pausadas", n: s.pausadas, cor: RAMPA[2] }, { rotulo: "Aguardando aprovação", n: s.aguardandoAprovacao, cor: RAMPA[3] },
    { rotulo: "Aguardando conclusão", n: s.aguardandoConclusao ?? 0, cor: RAMPA[3] },
  ] : [];
  const idades = dados?.porIdade ?? [];
  const maxIdade = Math.max(1, ...idades.map((i) => i.n));
  return (
    <Bloco titulo="Backlog agora" nota={dados ? `(${dados.total} OMs)` : ""} estado={est} onTentar={onTentar} className="xl:col-span-6"
      esqueleto={<EsqueletoBarras linhas={5} />} erroTexto="Backlog indisponível no momento." vazio={<Vazio texto="Nenhuma OM em aberto." dica="Tudo o que foi aberto já foi concluído." />}>
      <h3 className="mt-3 text-sm font-semibold text-muted">Por status</h3>
      <div className="mt-1"><BarraEmpilhada partes={partes} rotuloGeral="Backlog por status" /></div>
      <h3 className="mt-4 text-sm font-semibold text-muted">Por idade (desde a abertura)</h3>
      <ul className="mt-2 flex flex-col gap-3">
        {idades.map((i, k) => (
          <BarraLinha key={i.faixa} rotulo={i.faixa.replace("<", "menos de ").replace(">", "mais de ").replace("-", " a ")} valor={plural(i.n, "OM", "OMs")} pct={(i.n / maxIdade) * 100} cor={RAMPA[k] ?? RAMPA[3]}
            extra={i.faixa === ">8h" && i.n > 0 ? <span className="inline-flex items-center gap-1 font-semibold text-warn-soft-fg"><Icone nome="alerta" className="h-3.5 w-3.5" />parada há muito tempo</span> : undefined} />
        ))}
      </ul>
      <TabelaAlt titulo="Backlog por status e idade" arquivo="backlog" colunas={["Grupo", "Item", "OMs"]}
        linhas={[...partes.map((p) => ["Status", p.rotulo, p.n]), ...idades.map((i) => ["Idade", i.faixa, i.n]), ...PRIORIDADES.map((p) => ["Prioridade", PRIORIDADE[p].label, dados?.porPrioridade?.[p] ?? 0])]} />
    </Bloco>
  );
}

// ======================= Ofensores =======================
export function Ofensores({ dados, estado, onTentar }: Comum & { dados: Ofensor[] | null }) {
  const est: Estado = estado === "carregando" && !dados ? "carregando" : !dados ? "erro" : dados.length === 0 ? "vazio" : "ok";
  const max = Math.max(1, ...(dados ?? []).map((o) => o.tempoParadaSegundos));
  return (
    <Bloco titulo="Maiores ofensores" nota="(equipamentos)" estado={est} onTentar={onTentar} className="tv-oculto xl:col-span-4"
      esqueleto={<EsqueletoBarras />} erroTexto="Ofensores indisponíveis no momento." vazio={<Vazio texto="Sem ocorrências no período." dica="Amplie o período." />}>
      <ul className="mt-3 flex flex-col gap-3">
        {(dados ?? []).slice(0, 6).map((o) => (
          <BarraLinha key={o.chave} rotulo={o.rotulo} valor={tempo(o.tempoParadaSegundos)} pct={(o.tempoParadaSegundos / max) * 100} extra={<>{plural(o.ocorrencias, "OM", "OMs")} · {plural(o.maquinaParada, "parada", "paradas")}</>} />
        ))}
      </ul>
      <TabelaAlt titulo="Equipamentos com mais ocorrências" arquivo="ofensores" colunas={["#", "Equipamento", "OMs", "Paradas", "Tempo parado", "Reparo líquido"]}
        linhas={(dados ?? []).map((o) => [o.posicao, o.rotulo, o.ocorrencias, o.maquinaParada, tempo(o.tempoParadaSegundos), tempo(o.tempoReparoLiquidoSegundos)])} />
    </Bloco>
  );
}

// ======================= Pausas =======================
export function PausasMotivo({ dados, estado, onTentar }: Comum & { dados: PausasResp | null }) {
  const itens = [...(dados?.itens ?? [])].sort((a, b) => b.tempoTotalSegundos - a.tempoTotalSegundos);
  const est: Estado = estado === "carregando" && !dados ? "carregando" : !dados ? "erro" : itens.length === 0 ? "vazio" : "ok";
  return (
    <Bloco titulo="Tempo parado por motivo" nota="de pausa" estado={est} onTentar={onTentar} className="tv-oculto xl:col-span-4"
      esqueleto={<EsqueletoBarras />} erroTexto="Pausas indisponíveis no momento." vazio={<Vazio texto="Nenhuma pausa no período." dica="Amplie o período." />}>
      <ul className="mt-3 flex flex-col gap-3">
        {itens.map((i) => <BarraLinha key={i.motivo} rotulo={rotuloMotivoPausa(i.motivo)} valor={tempo(i.tempoTotalSegundos)} pct={i.percentualDoTempo} extra={<>{i.pausas}× · {Math.round(i.percentualDoTempo)} %</>} />)}
      </ul>
      <TabelaAlt titulo="Tempo parado por motivo de pausa" arquivo="pausas" colunas={["Motivo", "Tempo", "Pausas", "Média", "% do tempo"]}
        linhas={itens.map((i) => [rotuloMotivoPausa(i.motivo), tempo(i.tempoTotalSegundos), i.pausas, tempo(i.tempoMedioSegundos), `${Math.round(i.percentualDoTempo)} %`])} />
    </Bloco>
  );
}

// ======================= MTTR por =======================
type Aba = "categoria" | "prioridade" | "tecnico";
interface Linha { chave: string; rotulo: string; liquido: number | null; total: number | null; oms: number }
const ORDINAL: Record<string, string> = { BAIXA: "bg-viz-ord-1", MEDIA: "bg-viz-ord-2", ALTA: "bg-viz-ord-3", CRITICA: "bg-viz-ord-4" };
const textoDe = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

function linhasDa(aba: Aba, m: Pick<MttrResp, "porCategoria" | "porPrioridade" | "porTecnico">): Linha[] | undefined {
  const fonte = aba === "categoria" ? m.porCategoria : aba === "prioridade" ? m.porPrioridade : m.porTecnico;
  if (!Array.isArray(fonte)) return undefined;
  const linhas = fonte.map((q: QuebraMttr) => {
    const tecObj = typeof q.tecnico === "object" && q.tecnico ? q.tecnico : undefined;
    const chave = (textoDe(q[aba] as unknown) ?? textoDe(tecObj?.id) ?? textoDe(tecObj?.nome) ?? textoDe(q.chave) ?? textoDe(q.rotulo) ?? "—");
    const rotulo = aba === "tecnico" ? ((typeof q.tecnico === "object" ? textoDe(q.tecnico?.nome) : undefined) ?? textoDe(q.rotulo) ?? chave)
      : aba === "categoria" ? rotuloCategoria(chave.toUpperCase()) : PRIORIDADE[chave.toUpperCase() as Prio]?.label ?? chave;
    return { chave: chave.toUpperCase(), rotulo, liquido: q.mttrLiquidoSegundos, total: q.mttrTotalSegundos, oms: q.ordensConcluidas };
  });
  if (aba === "prioridade") return linhas.sort((a, b) => PRIORIDADES.indexOf(a.chave as Prio) - PRIORIDADES.indexOf(b.chave as Prio));
  if (aba === "tecnico") return linhas.sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR")); // NUNCA ordenar pessoas por desempenho
  return linhas.sort((a, b) => (b.liquido ?? 0) - (a.liquido ?? 0));
}

export function MttrPor({ dados, estado, onTentar }: Comum & { dados: Pick<MttrResp, "porCategoria" | "porPrioridade" | "porTecnico"> | null }) {
  const abas: { key: Aba; rotulo: string }[] = [{ key: "categoria", rotulo: "Categoria" }, { key: "prioridade", rotulo: "Prioridade" }, { key: "tecnico", rotulo: "Técnico" }];
  const [aba, setAba] = useState<Aba>("categoria");
  const linhas = dados ? linhasDa(aba, dados) : undefined;
  const est: Estado = estado === "carregando" && !dados ? "carregando" : !dados ? "erro" : "ok";
  const max = Math.max(1, ...(linhas ?? []).map((l) => l.liquido ?? 0));
  function setas(e: KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = abas.findIndex((a) => a.key === aba), prox = abas[(i + (e.key === "ArrowRight" ? 1 : abas.length - 1)) % abas.length].key;
    setAba(prox); requestAnimationFrame(() => document.getElementById(`mttr-aba-${prox}`)?.focus());
  }
  return (
    <Bloco titulo="MTTR por" estado={est} onTentar={onTentar} className="tv-oculto xl:col-span-4" esqueleto={<EsqueletoBarras />} erroTexto="Quebras do MTTR indisponíveis no momento.">
      <div role="tablist" aria-label="Agrupar o MTTR por" onKeyDown={setas} className="mt-3 flex flex-wrap gap-2">
        {abas.map((a) => (
          <button key={a.key} id={`mttr-aba-${a.key}`} role="tab" aria-selected={aba === a.key} aria-controls="mttr-painel" tabIndex={aba === a.key ? 0 : -1} onClick={() => setAba(a.key)}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold ${aba === a.key ? "bg-brand-600 text-white" : "bg-panel ring-1 ring-line hover:bg-brand-50"}`}>{a.rotulo}</button>
        ))}
      </div>
      <div id="mttr-painel" role="tabpanel" aria-labelledby={`mttr-aba-${aba}`}>
        {linhas === undefined ? <Vazio texto="Esta quebra ainda não é enviada pelo servidor." />
          : linhas.length === 0 ? <Vazio texto="Sem OMs concluídas no período." dica="Amplie o período." /> : (
          <>
            {aba === "prioridade" && (
              <ul aria-label="Legenda da rampa de prioridade" className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
                {PRIORIDADES.map((p) => <li key={p} className="inline-flex items-center gap-1"><span aria-hidden className={`h-3 w-3 rounded-sm ${ORDINAL[p]}`} />{PRIORIDADE[p].label}</li>)}<li>(Baixa → Crítica)</li>
              </ul>
            )}
            {aba === "tecnico" && <p className="mt-3 text-xs text-muted">Ordem alfabética. Média individual só com {AMOSTRA_MIN} ou mais OMs: contexto, não ranking.</p>}
            <ul className="mt-3 flex flex-col gap-3">
              {linhas.map((l) => {
                const poucos = aba === "tecnico" && l.oms < AMOSTRA_MIN;
                return <BarraLinha key={l.chave} rotulo={l.rotulo} valor={poucos ? "poucos dados" : tempo(l.liquido)} pct={poucos ? 0 : ((l.liquido ?? 0) / max) * 100}
                  cor={aba === "prioridade" ? ORDINAL[l.chave] ?? "bg-viz-1" : "bg-viz-1"} extra={<>{plural(l.oms, "OM", "OMs")} {aba !== "tecnico" && <AmostraBaixa n={l.oms} />}</>} />;
              })}
            </ul>
            <TabelaAlt titulo={`MTTR por ${abas.find((a) => a.key === aba)?.rotulo.toLowerCase()}`} arquivo={`mttr-por-${aba}`} colunas={[abas.find((a) => a.key === aba)?.rotulo ?? "", "MTTR", "Parada", "OMs"]}
              linhas={linhas.map((l) => [l.rotulo, aba === "tecnico" && l.oms < AMOSTRA_MIN ? "poucos dados" : tempo(l.liquido), aba === "tecnico" && l.oms < AMOSTRA_MIN ? "poucos dados" : tempo(l.total), l.oms])} />
          </>
        )}
      </div>
    </Bloco>
  );
}
