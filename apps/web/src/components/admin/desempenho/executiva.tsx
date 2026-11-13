"use client";
import type { ReactNode } from "react";
import {
  AMOSTRA_MIN, ZONA_TEXTO, fraseResumo, numero, pct1, plural, tempo, tempoCompacto, topMaisOutros, variacaoDe, zonaDeServidor,
  type BacklogResp, type FluxoResp, type KpisResp, type MetaResp, type Variacao, type Zona,
} from "@/lib/desempenho";
import { rotuloCategoria, rotuloMotivoPausa } from "@/lib/rotulos";
import type { PausasResp } from "@/lib/types";
import { Icone } from "../../ui/Icones";
import { ErroBloco, TabelaAlt, type EstadoDado } from "./comum";
import { Sparkline } from "./graficos";
import { AnelPct, EstadoZona, Rosca, Velocimetro } from "./redondos";

interface Comum { estado: EstadoDado; onTentar: () => void; tv?: boolean }
type Fluxo = Pick<FluxoResp, "serie"> & { porCategoria?: { categoria?: string; chave?: string; rotulo?: string; ordensConcluidas: number }[] };

// ---------------- cartão redondo (anatomia do §3) ----------------
export function CartaoRedondo({ titulo, estado, onTentar, tv = false, vazio, frase, tabela, children, carregando = true }: {
  titulo: string; estado: EstadoDado | "vazio"; onTentar: () => void; tv?: boolean; vazio?: ReactNode; frase?: string;
  tabela?: { titulo: string; arquivo: string; colunas: string[]; linhas: (string | number | null)[][] }; children?: ReactNode; carregando?: boolean;
}) {
  return (
    <article aria-label={titulo} aria-busy={estado === "carregando"} className={`flex min-w-0 flex-col rounded-xl bg-panel ring-1 ring-line ${tv ? "p-3" : "p-3"}`}>
      <h2 className={`font-bold uppercase tracking-wide text-muted ${tv ? "text-[28px] leading-tight" : "text-sm"}`}>{titulo}</h2>
      {estado === "carregando" && carregando ? (
        <div aria-hidden className="my-2 grid flex-1 place-items-center"><div className={`rounded-full bg-viz-track motion-safe:animate-pulse ${tv ? "h-56 w-56" : "h-28 w-28"}`} /></div>
      ) : estado === "erro" ? <ErroBloco texto={`${titulo}: indisponível no momento.`} onTentar={onTentar} />
        : estado === "vazio" ? <div className={`flex flex-1 items-center justify-center text-center text-muted ${tv ? "text-[24px]" : "text-sm"}`}>{vazio}</div> : (
        <>
          <div className="flex flex-1 flex-col justify-center pt-3">{children}</div>
          {frase && <p className={`mt-1 text-center text-muted ${tv ? "text-[22px]" : "text-[13px] leading-snug"}`}>{frase}</p>}
          {tabela && !tv && <TabelaAlt {...tabela} />}
        </>
      )}
    </article>
  );
}

const corVar = (v: Variacao | null) => (v?.direcao === "melhor" ? "text-ok-soft-fg" : v?.direcao === "pior" ? "text-warn-soft-fg" : "text-muted");
function Var({ v, tv }: { v: Variacao | null; tv?: boolean }) {
  if (!v) return null;
  const marca = v.direcao === "melhor" ? " (melhor)" : v.direcao === "pior" ? " (pior)" : "";
  return <p className={`text-center font-semibold tabular-nums ${corVar(v)} ${tv ? "text-[22px]" : "text-[13px]"}`}>{v.texto}{marca}</p>;
}
const LinkMetas = ({ onIrParametros, tv }: { onIrParametros?: () => void; tv?: boolean }) => (
  <div className="text-center">
    <p className={`inline-flex items-center gap-1.5 font-semibold text-muted ${tv ? "text-[24px]" : "text-sm"}`}><Icone nome="info" className={tv ? "h-6 w-6" : "h-4 w-4"} />Defina as metas de atendimento</p>
    {onIrParametros && !tv && <div><button onClick={onIrParametros} className="mt-1 min-h-11 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white">Ir para Parâmetros › Metas</button></div>}
  </div>
);

/** Faixas dos arcos a partir dos limiares do SERVIDOR; sem limiar aprovado => null (sem zona, sem cor). */
function arcosMtta(z?: MetaResp["zonas"]): { de: number; ate: number; zona: Zona }[] | null {
  if (!z || z.metaOkPct == null || z.metaAtencaoPct == null) return null;
  return [{ de: 0, ate: z.metaAtencaoPct, zona: "perigo" }, { de: z.metaAtencaoPct, ate: z.metaOkPct, zona: "atencao" }, { de: z.metaOkPct, ate: 100, zona: "ok" }];
}
function arcosMttr(z?: MetaResp["zonas"]): { arcos: { de: number; ate: number; zona: Zona }[]; max: number } | null {
  if (!z || z.mttrAtencaoPct == null) return null;
  const max = Math.max(150, z.mttrAtencaoPct + 30);
  return { max, arcos: [{ de: 0, ate: 100, zona: "ok" }, { de: 100, ate: z.mttrAtencaoPct, zona: "atencao" }, { de: z.mttrAtencaoPct, ate: max, zona: "perigo" }] };
}
const SemLimiar = ({ tv }: { tv?: boolean }) => <p className={`text-center text-muted ${tv ? "text-[22px]" : "text-xs"}`}>Limiares de zona não definidos</p>;

// ======================= Cartões SIMPLES (fora da caixa de metas) =======================
function Numerico({ titulo, valor, kpi, neutra, menorMelhor, frase, estado, onTentar, tv, arquivo, aria }: Comum & {
  titulo: string; valor: string; kpi: KpisResp["kpis"]["concluidas"] | undefined; neutra?: boolean; menorMelhor?: boolean; frase: string; arquivo: string; aria: string;
}) {
  const est: EstadoDado = estado === "carregando" && !kpi ? "carregando" : !kpi ? "erro" : "ok";
  const v = variacaoDe(kpi, { neutra, menorMelhor });
  return (
    <CartaoRedondo titulo={titulo} estado={est} onTentar={onTentar} tv={tv} frase={frase}
      tabela={{ titulo, arquivo, colunas: ["Indicador", "Valor"], linhas: [[titulo, valor]] }}>
      <p role="group" aria-label={`${aria}: ${valor}${v ? ", " + v.texto : ""}`} className={`text-center font-extrabold tabular-nums ${tv ? "text-[88px] leading-none" : "text-5xl"}`}>{valor}</p>
      <Var v={v} tv={tv} />
      {kpi?.serie && !tv && <div className="mx-auto mt-2 w-3/4"><Sparkline valores={kpi.serie} /></div>}
    </CartaoRedondo>
  );
}
/** Volume de OMs concluídas (aprovadas) no período, com variação e mini-gráfico. */
export function CardConcluidas({ kpis, estado, onTentar, tv }: Comum & { kpis: KpisResp | null }) {
  const k = kpis?.kpis.concluidas;
  return <Numerico titulo="Concluídas" valor={numero(k?.valor ?? null)} kpi={k} neutra frase="OMs concluídas e aprovadas no período." estado={estado} onTentar={onTentar} tv={tv} arquivo="concluidas" aria="OMs concluídas" />;
}
/** Tempo de parada de máquina somado (kpis.tempoParadaSegundos), menor é melhor. */
export function CardTempoParada({ kpis, estado, onTentar, tv }: Comum & { kpis: KpisResp | null }) {
  const k = kpis?.kpis.tempoParadaSegundos;
  return <Numerico titulo="Tempo de parada" valor={tempo(k?.valor ?? null)} kpi={k} menorMelhor frase="Tempo de parada de máquina nas OMs do período." estado={estado} onTentar={onTentar} tv={tv} arquivo="tempo-parada" aria="Tempo de parada" />;
}

// ======================= Cartões DIRETOS de MTTA/MTTR (dentro da CaixaMetas) (Fase 22): números simples, sem comparação com meta =======================
function CartaoDireto({ titulo, rotulo, frase, k, kpisOk, estado, onTentar, tv, arquivo, mostrarSerie }: Comum & {
  titulo: string; rotulo: string; frase: string; k: KpisResp["kpis"]["mttrLiquidoSegundos"] | undefined; kpisOk: boolean; arquivo: string; mostrarSerie?: boolean;
}) {
  const est: EstadoDado = estado === "carregando" && !kpisOk ? "carregando" : !kpisOk ? "erro" : "ok";
  const v = variacaoDe(k, { menorMelhor: true });
  const amostra = k?.amostra ?? 0;
  const tabela = { titulo, arquivo, colunas: ["Indicador", "Valor"], linhas: [[titulo, tempo(k?.valor ?? null)], ["OMs na amostra", amostra]] as (string | number | null)[][] };
  return (
    <CartaoRedondo titulo={titulo} estado={est} onTentar={onTentar} tv={tv} tabela={tabela} frase={`${frase}, ${plural(amostra, "OM", "OMs")}.`}>
      <p role="group" aria-label={`${rotulo} de ${tempo(k?.valor ?? null)}${v ? ", " + v.texto : ""}`} className={`text-center font-extrabold tabular-nums ${tv ? "text-[88px] leading-none" : "text-5xl"}`}>{tempo(k?.valor ?? null)}</p>
      <Var v={v} tv={tv} />
      {mostrarSerie && k?.serie && !tv && <div className="mx-auto mt-2 w-3/4"><Sparkline valores={k.serie} /></div>}
      {amostra < AMOSTRA_MIN && <p className={`mt-1 text-center text-warn-soft-fg ${tv ? "text-[22px]" : "text-xs"}`}>amostra baixa</p>}
    </CartaoRedondo>
  );
}
/** MTTR: valor, variação vs período anterior e mini-gráfico. A comparação com a meta fica na CaixaMetas. */
export function CardMttrDireto({ kpis, estado, onTentar, tv }: Comum & { kpis: KpisResp | null }) {
  return <CartaoDireto titulo="MTTR" rotulo="MTTR" frase="Tempo médio de reparo (mão de obra)" k={kpis?.kpis.mttrLiquidoSegundos} kpisOk={!!kpis} estado={estado} onTentar={onTentar} tv={tv} arquivo="mttr" mostrarSerie />;
}
/** MTTA: tempo médio até iniciar o atendimento, com variação vs período anterior. */
export function CardMttaDireto({ kpis, estado, onTentar, tv }: Comum & { kpis: KpisResp | null }) {
  return <CartaoDireto titulo="MTTA" rotulo="MTTA" frase="Tempo médio até iniciar o atendimento" k={kpis?.kpis.mttaSegundos} kpisOk={!!kpis} estado={estado} onTentar={onTentar} tv={tv} arquivo="mtta" mostrarSerie />;
}

// ======================= 1. Velocímetro: atendimento na meta (MTTA) =======================
export function CardMtta({ meta, estado, onTentar, onIrParametros, tv }: Comum & { meta: MetaResp | null; onIrParametros?: () => void }) {
  const est: EstadoDado = estado === "carregando" && !meta ? "carregando" : !meta ? "erro" : "ok";
  const g = meta?.geral;
  const configurada = !!meta?.configurada && !!g;
  const poucos = configurada && (g?.total ?? 0) < AMOSTRA_MIN;
  const pct = configurada && !poucos && g?.pct !== null && g?.pct !== undefined ? g.pct : null;
  const arcos = arcosMtta(meta?.zonas);
  const zona = pct !== null && arcos ? zonaDeServidor(g?.zona) : null; // o servidor classifica; sem limiar = sem zona
  const pp = pct !== null && g?.anteriorPct !== undefined && g.anteriorPct !== null ? pct - g.anteriorPct : null;
  const vTxt = pp === null ? "" : `${pp >= 0 ? "▲" : "▼"} ${Math.abs(pp).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pp vs período anterior`;
  const aria = !configurada ? "Atendimento dentro da meta: metas não definidas"
    : poucos ? `Atendimento dentro da meta: poucos dados, ${plural(g?.total ?? 0, "OM", "OMs")}`
    : `Atendimento dentro da meta: ${Math.round(pct ?? 0)} %, ${zona ? ZONA_TEXTO[zona] : "sem zona definida"}, ${g?.dentroDaMeta} de ${plural(g?.total ?? 0, "OM", "OMs")}${vTxt ? ", " + vTxt : ""}`;
  return (
    <CartaoRedondo titulo="Atendimento na meta (MTTA)" estado={est} onTentar={onTentar} tv={tv}
      frase={pct !== null ? `${Math.round(pct)} % dentro da meta (${g?.dentroDaMeta} de ${plural(g?.total ?? 0, "OM", "OMs")})${pp !== null ? `; ${Math.abs(pp).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pp ${pp >= 0 ? "acima" : "abaixo"} do período anterior` : ""}.` : undefined}
      tabela={configurada ? { titulo: "Cumprimento da meta de MTTA", arquivo: "meta-mtta", colunas: ["Prioridade", "Meta", "Dentro da meta", "Total", "%"],
        linhas: (meta?.porPrioridade ?? []).map((x) => [x.prioridade, tempo(meta?.metasMttaSegundos?.[x.prioridade] ?? null), x.dentroDaMeta, x.total, x.pct === null ? null : String(x.pct)]) } : undefined}>
      <Velocimetro valor={pct} max={100} zonas={arcos ?? []} ticks={arcos && meta?.zonas ? [meta.zonas.metaAtencaoPct as number, meta.zonas.metaOkPct as number] : []} centro={pct !== null ? `${Math.round(pct)} %` : ""} tv={tv}
        modo={!configurada ? "semMeta" : poucos ? "poucos" : arcos ? "dados" : "semZona"} ariaLabel={aria} />
      <div className="mt-1 flex flex-col items-center">
        {!configurada ? <LinkMetas onIrParametros={onIrParametros} tv={tv} />
          : poucos ? <p className={`font-semibold text-muted ${tv ? "text-[26px]" : "text-base"}`}>Poucos dados ({plural(g?.total ?? 0, "OM", "OMs")})</p>
          : zona ? <EstadoZona zona={zona} tv={tv} /> : <SemLimiar tv={tv} />}
      </div>
    </CartaoRedondo>
  );
}

// ======================= 2. Velocímetro: MTTR vs meta (sem dado de meta: cartão numérico de antes) =======================
export function CardMttr({ kpis, meta, estado, onTentar, onIrParametros, tv }: Comum & { kpis: KpisResp | null; meta: MetaResp | null; onIrParametros?: () => void }) {
  const est: EstadoDado = estado === "carregando" && !kpis ? "carregando" : !kpis ? "erro" : "ok";
  const k = kpis?.kpis.mttrLiquidoSegundos;
  const m = meta?.mttr; // calculado pelo servidor (valor, % da meta, amostra e zona)
  const metaSeg = m?.metaSegundos ?? meta?.metaMttrSegundos ?? null;
  const v = variacaoDe(k, { menorMelhor: true });
  const arc = arcosMttr(meta?.zonas);
  const valorSeg = m?.valorSegundos ?? k?.valor ?? null;
  const amostra = m?.amostra ?? k?.amostra ?? 0;
  const poucos = amostra < AMOSTRA_MIN;
  const pctMeta = m && !poucos ? m.pctDaMeta : null;
  const zona = pctMeta !== null && arc ? zonaDeServidor(m?.zona) : null;
  const tabela = { titulo: "MTTR", arquivo: "mttr", colunas: ["Indicador", "Valor"], linhas: [["MTTR", tempo(valorSeg)], ["Meta de MTTR", tempo(metaSeg)], ["% da meta", pctMeta === null ? null : `${pctMeta} %`], ["OMs na amostra", amostra]] as (string | number | null)[][] };
  if (!m) {
    // Sem meta de MTTR (ou sem amostra): cartão numérico com mini-gráfico e o convite para definir a meta.
    return (
      <CartaoRedondo titulo="MTTR" estado={est} onTentar={onTentar} tv={tv} tabela={tabela}>
        <p role="group" aria-label={`MTTR de ${tempo(valorSeg)}${v ? ", " + v.texto : ""}; ${metaSeg ? "sem amostra suficiente para a meta" : "meta de MTTR não definida"}`} className={`text-center font-extrabold tabular-nums ${tv ? "text-[88px] leading-none" : "text-5xl"}`}>{tempo(valorSeg)}</p>
        <Var v={v} tv={tv} />
        {k?.serie && !tv && <div className="mx-auto mt-2 w-3/4"><Sparkline valores={k.serie} /></div>}
        <div className="mt-2">{metaSeg ? <p className={`text-center text-muted ${tv ? "text-[24px]" : "text-sm"}`}>meta {tempo(metaSeg)} · sem amostra suficiente</p> : <LinkMetas onIrParametros={onIrParametros} tv={tv} />}</div>
      </CartaoRedondo>
    );
  }
  const aria = poucos ? `MTTR: poucos dados, ${plural(amostra, "OM", "OMs")}` : `MTTR de ${tempo(valorSeg)} para meta de ${tempo(metaSeg)}: ${Math.round(pctMeta ?? 0)} % da meta, ${zona === "perigo" ? "acima da meta" : zona ? ZONA_TEXTO[zona] : "sem zona definida"}${v ? ", " + v.texto : ""}`;
  return (
    <CartaoRedondo titulo="MTTR vs meta" estado={est} onTentar={onTentar} tv={tv} tabela={tabela}
      frase={!poucos ? `MTTR ${tempo(valorSeg)} para meta ${tempo(metaSeg)}${v ? `; ${v.texto}${v.direcao === "melhor" ? " (melhor)" : v.direcao === "pior" ? " (pior)" : ""}` : ""}.` : undefined}>
      <Velocimetro valor={poucos ? null : pctMeta} max={arc?.max ?? 150} zonas={arc?.arcos ?? []} ticks={arc && meta?.zonas ? [100, meta.zonas.mttrAtencaoPct as number] : []} centro={tempoCompacto(valorSeg)} tv={tv}
        modo={poucos ? "poucos" : arc ? "dados" : "semZona"} ariaLabel={aria} />
      <div className="mt-1 flex flex-col items-center">
        {poucos ? <p className={`font-semibold text-muted ${tv ? "text-[26px]" : "text-base"}`}>Poucos dados ({plural(amostra, "OM", "OMs")})</p>
          : zona ? <EstadoZona zona={zona} tv={tv}>{zona === "perigo" ? "acima da meta" : undefined}</EstadoZona> : <SemLimiar tv={tv} />}
      </div>
    </CartaoRedondo>
  );
}

// ======================= 3. Anel: aprovadas de primeira =======================
export function CardAprovadas({ kpis, estado, onTentar, tv }: Comum & { kpis: KpisResp | null }) {
  const est: EstadoDado | "vazio" = estado === "carregando" && !kpis ? "carregando" : !kpis ? "erro" : !kpis.kpis.retrabalhoPct || kpis.kpis.retrabalhoPct.valor === null ? "vazio" : "ok";
  const r = kpis?.kpis.retrabalhoPct;
  const pct = r && r.valor !== null ? Math.round((100 - r.valor) * 10) / 10 : null;
  const v = variacaoDe(r, { menorMelhor: true });
  return (
    <CartaoRedondo titulo="Aprovadas de primeira" estado={est} onTentar={onTentar} tv={tv} vazio={<span>Sem envios para aprovação no período.</span>}
      frase={pct !== null ? `${pct1(pct)} aprovadas de primeira; retrabalho de ${pct1(r?.valor)}${r?.base ? ` (${plural(r.base, "envio", "envios")} p/ aprovação)` : ""}${v ? `; ${v.texto}${v.direcao === "melhor" ? " (melhor)" : v.direcao === "pior" ? " (pior)" : ""}` : ""}.` : undefined}
      tabela={{ titulo: "Aprovadas de primeira", arquivo: "aprovadas-primeira", colunas: ["Indicador", "Valor"], linhas: [["Aprovadas de primeira", pct === null ? null : pct1(pct)], ["Retrabalho", pct1(r?.valor)], ["Envios para aprovação", r?.base ?? null]] }}>
      <AnelPct pct={pct} valorTexto={pct === null ? "—" : pct1(pct)} rotulo="de primeira" tv={tv}
        ariaLabel={`Aprovadas de primeira: ${pct === null ? "sem dados" : pct1(pct)}, retrabalho de ${pct1(r?.valor)}${v ? ", " + v.texto : ""}`} />
    </CartaoRedondo>
  );
}

// ======================= 4. Rosca: backlog por status =======================
const STATUS_BACKLOG: { chave: keyof BacklogResp["porStatus"]; rotulo: string; cor: string }[] = [
  { chave: "aguardandoTecnico", rotulo: "Aguardando técnico", cor: "var(--viz-ord-1)" },
  { chave: "emAtendimento", rotulo: "Em atendimento", cor: "var(--viz-ord-2)" },
  { chave: "pausadas", rotulo: "Pausadas", cor: "var(--viz-ord-3)" },
  { chave: "aguardandoAprovacao", rotulo: "Aguardando aprovação", cor: "var(--viz-ord-4)" },
  { chave: "aguardandoConclusao", rotulo: "Aguardando conclusão", cor: "var(--viz-ord-4)" },
];
export function CardBacklog({ backlog, estado, onTentar, tv }: Comum & { backlog: BacklogResp | null }) {
  const est: EstadoDado | "vazio" = estado === "carregando" && !backlog ? "carregando" : !backlog ? "erro" : backlog.total === 0 ? "vazio" : "ok";
  // Cor segue o STATUS (rampa ordinal do fluxo); a ordem das fatias é do maior para o menor.
  const itens = backlog ? STATUS_BACKLOG.map((s) => ({ ...s, valor: backlog.porStatus[s.chave] ?? 0 })).filter((s) => s.valor > 0).sort((a, b) => b.valor - a.valor) : [];
  return (
    <CartaoRedondo titulo="Backlog por status" estado={est} onTentar={onTentar} tv={tv} vazio={<span>Nenhuma OM em aberto.</span>}
      frase={backlog ? `${plural(backlog.total, "OM", "OMs")} em backlog${backlog.criticas ? `, ${plural(backlog.criticas, "crítica", "críticas")}` : ""}.` : undefined}
      tabela={backlog ? { titulo: "Backlog por status", arquivo: "backlog-status", colunas: ["Status", "OMs"], linhas: STATUS_BACKLOG.map((s) => [s.rotulo, backlog.porStatus[s.chave] ?? 0]) } : undefined}>
      <Rosca tv={tv} fatias={itens.map((i) => ({ rotulo: i.rotulo, valor: i.valor }))} cores={itens.map((i) => i.cor)} centro={{ valor: numero(backlog?.total), rotulo: "OMs" }}
        ariaLabel={`Backlog por status: ${backlog?.total ?? 0} OMs. ${itens.map((i) => `${i.rotulo} ${i.valor}`).join(", ")}`} />
    </CartaoRedondo>
  );
}

// ======================= 5. Pizza: pausas por motivo (3 maiores + Outros) =======================
export function CardPausas({ pausas, estado, onTentar, tv }: Comum & { pausas: PausasResp | null }) {
  const itens = (pausas?.itens ?? []).map((i) => ({ rotulo: rotuloMotivoPausa(i.motivo), valor: i.tempoTotalSegundos }));
  const fatias = topMaisOutros(itens, 3);
  const est: EstadoDado | "vazio" = estado === "carregando" && !pausas ? "carregando" : !pausas ? "erro" : fatias.length === 0 ? "vazio" : "ok";
  return (
    <CartaoRedondo titulo="Pausas: onde o tempo se perde" estado={est} onTentar={onTentar} tv={tv} vazio={<span>Nenhuma pausa no período.</span>}
      frase={fatias.length ? `${fatias[0].rotulo} concentra ${Math.round((fatias[0].valor / fatias.reduce((a, f) => a + f.valor, 0)) * 100)} % do tempo parado.` : undefined}
      tabela={{ titulo: "Tempo parado por motivo de pausa", arquivo: "pausas-motivo", colunas: ["Motivo", "Tempo parado", "Pausas", "% do tempo"],
        linhas: [...(pausas?.itens ?? [])].sort((a, b) => b.tempoTotalSegundos - a.tempoTotalSegundos).map((i) => [rotuloMotivoPausa(i.motivo), tempo(i.tempoTotalSegundos), i.pausas, `${Math.round(i.percentualDoTempo)} %`]) }}>
      <Rosca pizza tv={tv} fatias={fatias} formatar={tempo} ariaLabel={`Tempo parado por motivo de pausa. ${fatias.map((f) => `${f.rotulo} ${tempo(f.valor)}`).join(", ")}`} />
    </CartaoRedondo>
  );
}

// ======================= 6. Rosca: concluídas por categoria (3 maiores + Outros) =======================
export function CardCategorias({ fluxo, totalConcluidas, estado, onTentar, tv }: Comum & { fluxo: Fluxo | null; totalConcluidas?: number | null }) {
  const fonte = fluxo?.porCategoria;
  const itens = (fonte ?? []).map((q) => ({ rotulo: rotuloCategoria(String(q.categoria ?? q.chave ?? q.rotulo ?? "OUTROS").toUpperCase()), valor: q.ordensConcluidas }));
  const somaCat = itens.reduce((a, i) => a + i.valor, 0);
  // Fecha com o total real do período (o mesmo da frase-resumo): a diferença são OMs sem categoria, em cinza.
  const semCategoria = totalConcluidas !== null && totalConcluidas !== undefined ? Math.max(0, totalConcluidas - somaCat) : 0;
  const fatias = topMaisOutros(itens, 3);
  if (semCategoria > 0) {
    const ult = fatias[fatias.length - 1];
    if (ult?.outros) { ult.valor += semCategoria; ult.detalhe = (ult.detalhe ? ult.detalhe + ", " : "") + "sem categoria"; }
    else fatias.push({ rotulo: "Sem categoria", valor: semCategoria, outros: true });
  }
  const total = somaCat + semCategoria;
  const est: EstadoDado | "vazio" = estado === "carregando" && !fluxo ? "carregando" : !fluxo ? "erro" : !fonte ? "vazio" : fatias.length === 0 ? "vazio" : "ok";
  return (
    <CartaoRedondo titulo="Concluídas por categoria" estado={est} onTentar={onTentar} tv={tv} vazio={<span>{fonte ? "Sem OMs concluídas no período." : "Esta quebra ainda não é enviada pelo servidor."}</span>}
      frase={fatias.length ? `${plural(total, "OM concluída", "OMs concluídas")}; maior categoria: ${fatias[0].rotulo}${semCategoria > 0 ? ` (${semCategoria} sem categoria)` : ""}.` : undefined}
      tabela={{ titulo: "Concluídas por categoria", arquivo: "concluidas-categoria", colunas: ["Categoria", "OMs concluídas"], linhas: [...itens].sort((a, b) => b.valor - a.valor).map((i) => [i.rotulo, i.valor] as (string | number | null)[]).concat(semCategoria > 0 ? [["Sem categoria", semCategoria]] : []) }}>
      <Rosca tv={tv} fatias={fatias} centro={{ valor: numero(total), rotulo: "concluídas" }} ariaLabel={`Concluídas por categoria: ${total} OMs. ${fatias.map((f) => `${f.rotulo} ${f.valor}`).join(", ")}`} />
    </CartaoRedondo>
  );
}

// ======================= Frase-resumo e números de apoio =======================
export function ResumoPeriodo({ kpis, meta, dias, tv }: { kpis: KpisResp | null; meta: MetaResp | null; dias: number; tv?: boolean }) {
  if (!kpis) return null;
  const g = meta?.configurada ? meta.geral : null;
  const txt = fraseResumo({
    dias, concluidas: kpis.kpis.concluidas.valor, variacaoPct: kpis.kpis.concluidas.variacaoPct,
    metaPct: g && g.total >= AMOSTRA_MIN ? g.pct : null, backlog: kpis.backlog.total, criticas: kpis.backlog.criticas,
  });
  return txt ? <p aria-label="Resumo do período" className={tv ? "text-[26px] text-fg" : "text-sm text-fg"}>{txt}</p> : null;
}

export function ApoioFaixa({ kpis, estado, onTentar }: Comum & { kpis: KpisResp | null }) {
  if (!kpis) return estado === "erro" ? <ErroBloco texto="Números de apoio indisponíveis no momento." onTentar={onTentar} /> : <div aria-hidden className="h-10 rounded-xl bg-viz-track motion-safe:animate-pulse" />;
  const k = kpis.kpis;
  const itens: { r: string; v: string; var: Variacao | null }[] = [
    { r: "Concluídas", v: numero(k.concluidas.valor), var: variacaoDe(k.concluidas, { neutra: true }) },
    { r: "Tempo de parada", v: tempo(k.tempoParadaSegundos.valor), var: variacaoDe(k.tempoParadaSegundos, { menorMelhor: true }) },
    { r: "Backlog", v: numero(kpis.backlog.total), var: null },
    ...(k.recusaPct ? [{ r: "Recusas", v: k.recusaPct.valor === null ? "—" : pct1(k.recusaPct.valor), var: variacaoDe(k.recusaPct, { menorMelhor: true }) }] : []),
  ];
  return (
    <ul aria-label="Números de apoio" className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl bg-panel px-4 py-2 text-sm ring-1 ring-line">
      {itens.map((i) => (
        <li key={i.r} className="tabular-nums"><span className="text-muted">{i.r}</span> <strong className="text-base">{i.v}</strong>
          {i.var && <span className={`ml-1 text-xs font-semibold ${corVar(i.var)}`}>{i.var.texto.replace(" vs período anterior", "")}{i.var.direcao === "melhor" ? " (melhor)" : i.var.direcao === "pior" ? " (pior)" : ""}</span>}
          {i.r === "Backlog" && kpis.backlog.criticas > 0 && <span className="ml-1 text-xs font-semibold text-warn-soft-fg">({plural(kpis.backlog.criticas, "crítica", "críticas")})</span>}
        </li>
      ))}
      <li className="text-xs text-muted">Variação vs período anterior</li>
    </ul>
  );
}

// ======================= Atenção agora (Modo TV) =======================
export interface ItemAtencao { id: string; texto: string }
export function PainelAtencao({ itens, mais = 0, estado, tv = true, cheio = false, hora = null }: { itens: ItemAtencao[]; mais?: number; estado: EstadoDado; tv?: boolean; cheio?: boolean; hora?: string | null }) {
  return (
    <aside aria-label="Atenção agora" className={`flex flex-col rounded-xl bg-panel ring-1 ring-line ${cheio ? "w-full" : ""} ${tv ? "p-4" : "p-3"}`}>
      <h2 className={`font-bold uppercase tracking-wide text-muted ${tv ? "text-[28px] leading-tight" : "text-sm"}`}>Atenção agora</h2>
      {estado === "erro" ? <p role="alert" className="mt-4 inline-flex items-start gap-2 text-[24px] font-semibold text-warn-soft-fg"><Icone nome="alerta" className="mt-1 h-6 w-6 shrink-0" />Atenção agora indisponível.</p>
        : estado === "carregando" ? <p className="mt-4 text-[22px] text-muted">Carregando…</p>
        : itens.length === 0 ? <p className="mt-4 inline-flex items-start gap-2 text-[24px] font-semibold text-ok-soft-fg"><span aria-hidden>✓</span>Nada exige atenção agora.</p>
        : <ul className="mt-4 flex flex-col gap-4">{itens.slice(0, 5).map((i) => <li key={i.id} className="flex items-start gap-2 text-[24px] font-semibold text-warn-soft-fg"><Icone nome="alerta" className="mt-1 h-6 w-6 shrink-0" /><span className="text-fg">{i.texto}</span></li>)}</ul>}
      {mais > 0 && <p className="mt-3 text-[24px] font-semibold text-warn-soft-fg">+{mais} {mais === 1 ? "OM" : "OMs"} além destas</p>}
      {hora && <p className="mt-auto pt-4 text-[22px] text-muted">Atualizado às {hora}</p>}
    </aside>
  );
}
