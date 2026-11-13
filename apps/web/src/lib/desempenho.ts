/**
 * Dashboard de desempenho da equipe (docs/ux/fase18-dashboard-desempenho-equipe.md; contrato: docs/api/contrato-fase18-dashboard-equipe.md).
 * Tipos do contrato, filtros (estado <-> URL) e utilidades de formatação. Sem imports de React: testável isolado.
 */
export type Prio = "BAIXA" | "MEDIA" | "ALTA" | "CRITICA";
export const PRIORIDADES: Prio[] = ["BAIXA", "MEDIA", "ALTA", "CRITICA"];
export const TIPOS_OM: { key: string; rotulo: string }[] = [
  { key: "CORRETIVA", rotulo: "Corretiva" }, { key: "PREVENTIVA", rotulo: "Preventiva" }, { key: "PREDITIVA", rotulo: "Preditiva" },
];

// ---------------- filtros ----------------
export interface FiltroDesempenho {
  /** 7 | 30 | 90 = período relativo (termina agora); 0 = personalizado (usa `de`/`ate`, AAAA-MM-DD). */
  dias: 0 | 7 | 30 | 90;
  de: string; ate: string;
  tec: string[]; prio: Prio[]; tipo: string; comp: boolean;
  /** Visão do painel: executiva (gráficos redondos, padrão) ou operacional (detalhe). Na URL: ?vis=exec|op. */
  vis: "exec" | "op";
}
export const FILTRO_PADRAO: FiltroDesempenho = { dias: 30, de: "", ate: "", tec: [], prio: [], tipo: "CORRETIVA", comp: false, vis: "exec" };
const DIA = 86_400_000;

/** URL: `?p=30` (relativo) ou `?de=AAAA-MM-DD&ate=AAAA-MM-DD`; `tec`, `prio` (CSV), `tipo`, `comp=1`. Valor inválido cai no padrão. */
export function lerFiltro(busca: string): FiltroDesempenho {
  const q = new URLSearchParams(busca);
  const data = (v: string | null) => (v && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) ? v : "");
  const p = Number(q.get("p"));
  const de = data(q.get("de")), ate = data(q.get("ate"));
  const dias: FiltroDesempenho["dias"] = p === 7 || p === 30 || p === 90 ? p : de && ate ? 0 : 30;
  const csv = (v: string | null) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
  const tipo = q.get("tipo")?.toUpperCase() ?? "";
  return {
    dias, de: dias === 0 ? de : "", ate: dias === 0 ? ate : "",
    tec: csv(q.get("tec")).filter((x) => /^[0-9]+$/.test(x)),
    prio: csv(q.get("prio")).map((x) => x.toUpperCase()).filter((x): x is Prio => (PRIORIDADES as string[]).includes(x)),
    tipo: TIPOS_OM.some((t) => t.key === tipo) ? tipo : "CORRETIVA",
    comp: q.get("comp") === "1" || q.get("comp") === "true",
    vis: q.get("vis") === "op" ? "op" : "exec",
  };
}

export function filtroParaBusca(f: FiltroDesempenho): string {
  const q = new URLSearchParams();
  if (f.dias === 0) { if (f.de) q.set("de", f.de); if (f.ate) q.set("ate", f.ate); } else if (f.dias !== 30) q.set("p", String(f.dias));
  if (f.tec.length) q.set("tec", f.tec.join(","));
  if (f.prio.length) q.set("prio", f.prio.join(","));
  if (f.tipo !== "CORRETIVA") q.set("tipo", f.tipo);
  if (f.comp) q.set("comp", "1");
  if (f.vis === "op") q.set("vis", "op");
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const filtroAtivo = (f: FiltroDesempenho) => f.tec.length > 0 || f.prio.length > 0 || f.tipo !== "CORRETIVA" || f.comp;

/** Intervalo efetivo em ISO. Personalizado: do início de `de` ao fim de `ate` (hora local); inválido/invertido cai em 30 dias. */
export function intervaloDe(f: FiltroDesempenho, agora = new Date()): { de: string; ate: string; dias: number } {
  if (f.dias === 0 && f.de && f.ate) {
    const d = new Date(`${f.de}T00:00:00`), a = new Date(`${f.ate}T23:59:59`);
    if (!Number.isNaN(d.getTime()) && !Number.isNaN(a.getTime()) && d < a && a.getTime() - d.getTime() <= 366 * DIA)
      return { de: d.toISOString(), ate: a.toISOString(), dias: Math.max(1, Math.round((a.getTime() - d.getTime()) / DIA)) };
  }
  const dias = f.dias === 7 || f.dias === 90 ? f.dias : 30;
  return { de: new Date(agora.getTime() - dias * DIA).toISOString(), ate: agora.toISOString(), dias };
}

/** Parâmetros comuns de todos os endpoints de métricas. */
export function paramsMetricas(f: FiltroDesempenho, agora = new Date()): Record<string, string | undefined> {
  const { de, ate } = intervaloDe(f, agora);
  return {
    de, ate, tipo: f.tipo, comparar: f.comp ? "true" : undefined,
    tecnicoIds: f.tec.length ? f.tec.join(",") : undefined, prioridade: f.prio.length ? f.prio.join(",") : undefined,
  };
}

// ---------------- contrato ----------------
export interface KpiNum {
  valor: number | null; anterior?: number | null; variacaoPct?: number | null; variacaoPp?: number | null;
  amostra?: number; base?: number; semApontamento?: number; serie?: (number | null)[];
}
export interface KpisResp {
  periodo: { de: string; ate: string }; anterior: { de: string; ate: string } | null; serieBucketDias?: number;
  kpis: { mttrLiquidoSegundos: KpiNum; mttaSegundos: KpiNum; tempoParadaSegundos: KpiNum; concluidas: KpiNum; retrabalhoPct?: KpiNum; recusaPct?: KpiNum };
  backlog: { total: number; criticas: number };
}
export interface PontoFluxo {
  periodo: string; abertas?: number; ordensConcluidas: number;
  mttrLiquidoSegundos: number | null; mttrTotalSegundos?: number | null; mttaSegundos?: number | null;
}
export interface FluxoResp { periodo: { de: string; ate: string }; serie: PontoFluxo[]; anterior?: PontoFluxo[] }
export type ZonaSrv = "OK" | "ATENCAO" | "CRITICA" | null;
/** Limiares de zona vindos do servidor (US-12). Cada um é null enquanto não aprovado: SEM LIMIAR = SEM ZONA (o front não pinta cor). */
export interface ZonasSrv { metaOkPct: number | null; metaAtencaoPct: number | null; mttrAtencaoPct: number | null }
export interface MetaResp {
  configurada: boolean; metasMttaSegundos?: Partial<Record<Prio, number | null>>; metaMttrSegundos?: number | null;
  geral?: { dentroDaMeta: number; total: number; pct: number | null; anteriorPct?: number | null; zona?: ZonaSrv };
  /** Velocímetro nº 2: valor e % da meta já calculados pelo servidor (menor é melhor). Pode vir mesmo com configurada:false. */
  mttr?: { metaSegundos: number; valorSegundos: number | null; pctDaMeta: number | null; amostra: number; anteriorPctDaMeta?: number | null; zona?: ZonaSrv };
  zonas?: ZonasSrv;
  porPrioridade?: { prioridade: Prio; dentroDaMeta: number; total: number; pct: number | null }[];
  geradoEm?: string;
}
export type EstadoTecnico = "EM_ATENDIMENTO" | "PAUSADO" | "COM_RESERVA" | "DISPONIVEL";
export interface TecnicoEquipe {
  id: string; nome: string;
  agora: { estado: EstadoTecnico; emAtendimento: number; reservadas: number; pausadas: number; omAtual: { id: string; numero: string; equipamento: string; inicioCronometro: string } | null };
  periodo: { concluidas: number; mttrLiquidoSegundos: number | null; mttaSegundos: number | null; retrabalhoPct: number | null; horasApontadasSegundos: number; retroativoPct?: number; amostraSuficiente: boolean };
}
export interface EquipeResp { periodo?: { de: string; ate: string }; tecnicos: TecnicoEquipe[] }
export interface BacklogResp {
  total: number; criticas: number;
  porStatus: { aguardandoTecnico: number; emAtendimento: number; pausadas: number; aguardandoAprovacao: number; /** Fase 21 (aditivo): aprovadas, aguardando conclusão do gestor. */ aguardandoConclusao?: number };
  porIdade: { faixa: string; n: number }[]; porPrioridade: Record<Prio, number>; geradoEm?: string;
}

// ---------------- formatação ----------------
export const AMOSTRA_MIN = 5;

/** "2h 05min", "10 min", "45 s", "—". */
export function tempo(seg: number | null | undefined): string {
  if (seg === null || seg === undefined || !Number.isFinite(seg) || seg < 0) return "—";
  const m = Math.round(seg / 60);
  if (m < 1) return `${Math.round(seg)} s`;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}min`;
}
export const pct1 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} %`);
export const numero = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("pt-BR"));

/** Rótulo curto do ponto da série: "08/10" (dia/semana) ou "10/2026" (mês). */
export function rotuloData(iso: string): string {
  const m = /^([0-9]{4})-([0-9]{2})(?:-([0-9]{2}))?/.exec(iso);
  if (!m) return iso;
  return m[3] ? `${m[3]}/${m[2]}` : `${m[2]}/${m[1]}`;
}

export type Direcao = "melhor" | "pior" | "neutra" | "igual";
export interface Variacao { texto: string; direcao: Direcao }
/**
 * Variação com TEXTO (nunca só seta/cor). `menorMelhor`: tempos (▼ = melhor). `neutra`: contagens (sem juízo de valor).
 * Usa `variacaoPp` para taxas (pontos percentuais) e `variacaoPct` para valores.
 */
export function variacaoDe(k: KpiNum | undefined, opc: { menorMelhor?: boolean; neutra?: boolean } = {}): Variacao | null {
  if (!k) return null;
  const pp = k.variacaoPp, pc = k.variacaoPct;
  const v = pp !== undefined && pp !== null ? pp : pc;
  if (v === undefined || v === null) return k.anterior === null || k.anterior === undefined ? null : null;
  const unid = pp !== undefined && pp !== null ? "pp" : "%";
  const abs = Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  if (Math.abs(v) < 0.05) return { texto: `= sem variação vs período anterior`, direcao: "igual" };
  const seta = v < 0 ? "▼" : "▲";
  const direcao: Direcao = opc.neutra ? "neutra" : (v < 0) === !!opc.menorMelhor ? "melhor" : "pior";
  return { texto: `${seta} ${abs} ${unid === "pp" ? "pp" : "%"} vs período anterior`, direcao };
}

// CSV: ver lib/csv.ts (helper único, Fase 35).

/** "1 OM", "4 OMs" (pluralização correta, sem "(s)"). */
export const plural = (n: number | null | undefined, um: string, varios: string) => `${numero(n ?? 0)} ${n === 1 ? um : varios}`;

// ======================= Visão executiva (docs/ux/fase18-dashboard-executivo.md) =======================
export type Zona = "ok" | "atencao" | "perigo";
/** Zona do servidor (OK/ATENCAO/CRITICA) -> zona visual. null = sem zona (sem limiar ou sem amostra). */
export const zonaDeServidor = (z: ZonaSrv | undefined): Zona | null => (z === "OK" ? "ok" : z === "ATENCAO" ? "atencao" : z === "CRITICA" ? "perigo" : null);
export const ZONA_TEXTO: Record<Zona, string> = { ok: "dentro da meta", atencao: "atenção", perigo: "abaixo da meta" };

export interface Fatia { rotulo: string; valor: number; outros?: boolean; detalhe?: string }
/**
 * Regra dura: no máximo 4 fatias = 3 cores nominais + "Outros" (cinza). Ordena do maior para o menor, mantém só valor > 0 e agrupa o
 * resto em "Outros" (que vai SEMPRE por último). Com 4 ou mais itens, o 4º em diante vira "Outros".
 */
export function topMaisOutros(itens: { rotulo: string; valor: number }[], n = 3): Fatia[] {
  const v = itens.filter((i) => Number.isFinite(i.valor) && i.valor > 0).sort((a, b) => b.valor - a.valor);
  if (v.length <= n) return v.map((i) => ({ rotulo: i.rotulo, valor: i.valor }));
  const resto = v.slice(n);
  return [
    ...v.slice(0, n).map((i) => ({ rotulo: i.rotulo, valor: i.valor })),
    { rotulo: "Outros", valor: resto.reduce((a, i) => a + i.valor, 0), outros: true, detalhe: resto.map((i) => i.rotulo).join(", ") },
  ];
}

/**
 * Frase-resumo do período por MODELO FIXO: só fatos, sem adjetivos; o trecho sem dado é omitido.
 * "Nos últimos 30 dias a equipe concluiu 82 OMs (▲ 7,9 % vs período anterior); 63 % foram atendidas dentro da meta; há 17 OMs em backlog, 2 críticas."
 */
export function fraseResumo(o: { dias: number; concluidas?: number | null; variacaoPct?: number | null; metaPct?: number | null; backlog?: number | null; criticas?: number | null }): string {
  const partes: string[] = [];
  if (o.concluidas !== null && o.concluidas !== undefined) {
    let v = "";
    if (o.variacaoPct !== null && o.variacaoPct !== undefined && Math.abs(o.variacaoPct) >= 0.05) v = " (" + (o.variacaoPct < 0 ? "▼" : "▲") + " " + Math.abs(o.variacaoPct).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " % vs período anterior)";
    partes.push("Nos últimos " + o.dias + " dias a equipe concluiu " + plural(o.concluidas, "OM", "OMs") + v);
  }
  if (o.metaPct !== null && o.metaPct !== undefined) partes.push(Math.round(o.metaPct) + " % foram atendidas dentro da meta");
  if (o.backlog !== null && o.backlog !== undefined) partes.push("há " + plural(o.backlog, "OM", "OMs") + " em backlog" + (o.criticas ? ", " + plural(o.criticas, "crítica", "críticas") : ""));
  return partes.length ? partes.join("; ") + "." : "";
}

/** Tempo curto para o centro dos velocímetros: "2h 00", "45 min". */
export function tempoCompacto(seg: number | null | undefined): string {
  if (seg === null || seg === undefined || !Number.isFinite(seg) || seg < 0) return "—";
  const m = Math.round(seg / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}`;
}
