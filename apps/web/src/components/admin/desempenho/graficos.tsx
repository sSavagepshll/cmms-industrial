"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AMOSTRA_MIN, plural, rotuloData, tempo, type PontoFluxo } from "@/lib/desempenho";

// SVG próprio, ligado aos tokens --viz-* (dois temas). Sem animação (respeita prefers-reduced-motion por construção).

type Pt = readonly [number, number];
/** Liga APENAS os pontos que têm dado: a linha pula os dias vazios (nada de segmentos soltos). */
function caminhoContinuo(pontos: (Pt | null)[]): string {
  return pontos.filter((p): p is Pt => p !== null).map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
}

/** Mini-gráfico de tendência de um KPI: decorativo (o valor e a variação estão em texto no cartão). Sem interrupções. */
export function Sparkline({ valores }: { valores: (number | null)[] }) {
  const nums = valores.filter((x): x is number => typeof x === "number");
  if (nums.length < 2) return <div aria-hidden className="h-5" />;
  const min = Math.min(...nums), max = Math.max(...nums), W = 100, H = 20, esp = max - min || 1;
  const pts = valores.map((x, i) => (typeof x === "number" ? ([(i / (valores.length - 1)) * W, H - 3 - ((x - min) / esp) * (H - 6)] as const) : null));
  const ult = [...pts].reverse().find(Boolean);
  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-5 w-full overflow-visible">
      <path d={caminhoContinuo(pts)} fill="none" stroke="var(--viz-1)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      {ult && <circle cx={ult[0]} cy={ult[1]} r={2.5} fill="var(--viz-1)" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** Eixo redondo de tempo: passos de 15/30 min, 1/2/3/4/6/12/24 h, no máximo ~4 marcas. Rótulos em pt-BR ("1,5 h"). */
export function eixoTempo(maxSeg: number): { passo: number; topo: number; marcas: number[] } {
  const PASSOS = [900, 1800, 3600, 7200, 10800, 14400, 21600, 43200, 86400];
  const passo = PASSOS.find((p) => maxSeg / p <= 4) ?? 86400;
  const n = Math.max(1, Math.ceil(maxSeg / passo));
  return { passo, topo: n * passo, marcas: Array.from({ length: n + 1 }, (_, i) => i * passo) };
}
export const rotuloEixoTempo = (s: number) => (s === 0 ? "0" : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`);

/** Teto "redondo" para o eixo Y de contagem (1, 2, 5 × 10^n). */
function teto(max: number): number {
  if (max <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(max)), f = max / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}

const W = 800, PAD_L = 48, PAD_R = 12;
const HALO = { paintOrder: "stroke", stroke: "var(--c-panel)", strokeWidth: 4, strokeLinejoin: "round" } as const;

/**
 * FluxoOms: DOIS gráficos alinhados no MESMO eixo X (sem eixo duplo). Em cima, colunas agrupadas Abertas (slot 1) × Concluídas
 * (slot 2); embaixo, a linha do MTTR (mão de obra) ligando só os dias com dado, com a meta em tracejado longo (rótulo na linha) e o
 * período anterior em pontilhado `muted`. Altura flexível: ocupa o espaço que o cartão oferece. Pontos focáveis (Tab) com tooltip.
 */
export function FluxoGraficos({ serie, anterior, metaMttrSegundos }: { serie: PontoFluxo[]; anterior?: PontoFluxo[]; metaMttrSegundos?: number | null }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 800, h: 300 });
  useEffect(() => {
    const el = caixa.current; if (!el) return;
    const ler = () => setDim({ w: el.clientWidth || 800, h: el.clientHeight || 300 });
    ler();
    const ro = new ResizeObserver(ler); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = serie.length;
  const escala = dim.w / W;                         // px por unidade do viewBox
  const totalU = Math.max(150, dim.h / escala);     // altura disponível em unidades do viewBox
  const rodape = 18, topoPad = 20, linhaPad = 24;
  const topoH = Math.round((totalU - rodape) * 0.5), linhaH = Math.round(totalU - rodape - topoH);
  const pw = W - PAD_L - PAD_R, banda = pw / n, cx = (i: number) => PAD_L + banda * (i + 0.5);
  const bw = Math.max(3, Math.min(16, banda * 0.36));

  const maxVol = teto(Math.max(1, ...serie.flatMap((s) => [s.abertas ?? 0, s.ordensConcluidas])));
  const yv = (v: number) => topoPad + (topoH - topoPad) * (1 - v / maxVol);
  const iPicoVol = serie.reduce((m, s, i) => (Math.max(s.abertas ?? 0, s.ordensConcluidas) > Math.max(serie[m].abertas ?? 0, serie[m].ordensConcluidas) ? i : m), 0);

  const valores = serie.map((s) => s.mttrLiquidoSegundos);
  const prev = anterior?.map((s) => s.mttrLiquidoSegundos) ?? [];
  const eixo = eixoTempo(Math.max(1, metaMttrSegundos ?? 0, ...valores.map((v) => v ?? 0), ...prev.map((v) => v ?? 0)));
  const yt = (v: number) => linhaPad + (linhaH - linhaPad - 4) * (1 - v / eixo.topo);
  const reais = valores.map((v, i) => (v === null ? null : i)).filter((x): x is number => x !== null);
  const iPicoT = reais.length ? reais.reduce((m, i) => ((valores[i] ?? 0) > (valores[m] ?? 0) ? i : m), reais[0]) : -1;
  const iUltT = reais.length ? reais[reais.length - 1] : -1;
  const yMeta = metaMttrSegundos ? yt(metaMttrSegundos) : null;
  const ponto = (vs: (number | null)[]) => vs.map((v, i) => (v === null ? null : ([cx(i), yt(v)] as const)));

  const resumo = `Fluxo de OMs por período: ${serie.reduce((a, s) => a + (s.abertas ?? 0), 0)} abertas e ${serie.reduce((a, s) => a + s.ordensConcluidas, 0)} concluídas. MTTR do último ponto com dado: ${tempo(valores[iUltT] ?? null)}.`;
  const slots = (alto: number, focavel: boolean) => serie.map((s, i) => (
    <rect key={i} x={PAD_L + banda * i} y={0} width={banda} height={alto} fill="transparent" tabIndex={focavel ? 0 : -1}
      aria-label={`${rotuloData(s.periodo)}: ${plural(s.abertas ?? 0, "aberta", "abertas")}, ${plural(s.ordensConcluidas, "concluída", "concluídas")}, MTTR ${tempo(s.mttrLiquidoSegundos)}${s.ordensConcluidas > 0 && s.ordensConcluidas < AMOSTRA_MIN ? ", amostra baixa" : ""}`}
      onMouseEnter={() => setAtivo(i)} onMouseLeave={() => setAtivo((a) => (a === i ? null : a))} onFocus={() => setAtivo(i)} onBlur={() => setAtivo((a) => (a === i ? null : a))}
      className="viz-foco" />
  ));
  const s = ativo !== null ? serie[ativo] : null;
  const esq = ativo !== null ? (cx(ativo) / W) * 100 : 0;
  const rotuloT = (i: number) => {
    // Halo na cor do cartão e fora da linha de meta: se o ponto está colado na meta, o rótulo sobe acima dela.
    const y = yt(valores[i] ?? 0);
    const yRot = yMeta !== null && Math.abs(y - yMeta) < 16 ? Math.min(y, yMeta) - 9 : y - 8;
    return <text key={i} x={Math.min(Math.max(cx(i), PAD_L + 26), W - PAD_R - 26)} y={yRot} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--c-fg)" className="tabular-nums" style={HALO}>{tempo(valores[i])}</text>;
  };

  return (
    <div ref={caixa} className="absolute inset-0" onMouseLeave={() => setAtivo(null)}>
      <div role="group" aria-label={resumo}>
        <svg viewBox={`0 0 ${W} ${topoH}`} className="block w-full" role="presentation" style={{ height: topoH * escala }}>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={yv(maxVol * t)} y2={yv(maxVol * t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} />
              <text x={PAD_L - 6} y={yv(maxVol * t) + 4} textAnchor="end" fontSize={11} fill="var(--c-muted)" className="tabular-nums">{Math.round(maxVol * t)}</text>
            </g>
          ))}
          {ativo !== null && <rect x={PAD_L + banda * ativo} y={topoPad - 4} width={banda} height={topoH - topoPad + 4} fill="var(--viz-track)" opacity={0.6} />}
          {serie.map((p, i) => {
            const a = p.abertas ?? 0, c = p.ordensConcluidas;
            return (
              <g key={i}>
                <rect x={cx(i) - bw - 0.5} y={yv(a)} width={bw} height={Math.max(0, yv(0) - yv(a))} rx={3} fill="var(--viz-1)" />
                <rect x={cx(i) + 0.5} y={yv(c)} width={bw} height={Math.max(0, yv(0) - yv(c))} rx={3} fill="var(--viz-2)" />
                {(i === iPicoVol || i === n - 1) && (
                  <>
                    {a > 0 && <text x={cx(i) - bw / 2 - 0.5} y={yv(a) - 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--c-fg)" className="tabular-nums" style={HALO}>{a}</text>}
                    {c > 0 && <text x={cx(i) + bw / 2 + 0.5} y={yv(c) - 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--c-fg)" className="tabular-nums" style={HALO}>{c}</text>}
                  </>
                )}
              </g>
            );
          })}
          {slots(topoH, true)}
        </svg>
        <svg viewBox={`0 0 ${W} ${linhaH + rodape}`} className="block w-full" role="presentation" style={{ height: (linhaH + rodape) * escala }}>
          {eixo.marcas.map((m, k) => (
            <g key={m}>
              <line x1={PAD_L} x2={W - PAD_R} y1={yt(m)} y2={yt(m)} stroke={k === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} />
              <text x={PAD_L - 6} y={yt(m) + 4} textAnchor="end" fontSize={11} fill="var(--c-muted)" className="tabular-nums">{rotuloEixoTempo(m)}</text>
            </g>
          ))}
          {yMeta !== null && metaMttrSegundos ? (
            <g>
              <line x1={PAD_L} x2={W - PAD_R} y1={yMeta} y2={yMeta} stroke="var(--c-muted)" strokeWidth={1.5} strokeDasharray="10 5" />
              <text x={PAD_L + 4} y={yMeta - 4} fontSize={11} fill="var(--c-muted)" style={HALO}>meta {tempo(metaMttrSegundos)}</text>
            </g>
          ) : null}
          {prev.some((v) => v !== null) && <path d={caminhoContinuo(ponto(prev))} fill="none" stroke="var(--c-muted)" strokeWidth={2} strokeDasharray="0.1 5" strokeLinecap="round" opacity={0.85} />}
          <path d={caminhoContinuo(ponto(valores))} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {ponto(valores).map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={ativo === i ? 5 : 3} fill="var(--viz-1)" />)}
          {[iPicoT, iUltT].filter((x, k, a) => x >= 0 && a.indexOf(x) === k).map(rotuloT)}
          {ativo !== null && <line x1={cx(ativo)} x2={cx(ativo)} y1={0} y2={linhaH} stroke="var(--viz-axis)" strokeDasharray="2 3" />}
          {[0, Math.floor((n - 1) / 2), n - 1].filter((x, k, a) => a.indexOf(x) === k).map((i) => (
            <text key={i} x={cx(i)} y={linhaH + 13} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill="var(--c-muted)" className="tabular-nums">{rotuloData(serie[i].periodo)}</text>
          ))}
          {slots(linhaH, false)}
        </svg>
      </div>
      {s && (
        <div aria-hidden className="pointer-events-none absolute top-0 z-10 w-max max-w-[15rem] rounded-lg bg-panel-2 p-2 text-left text-xs text-fg shadow-lg ring-1 ring-line"
          style={{ left: `${Math.min(Math.max(esq, 12), 82)}%`, transform: "translate(-50%, -4px)" }}>
          <strong className="block">{rotuloData(s.periodo)}</strong>
          <span className="block tabular-nums"><span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: "var(--viz-1)" }} />Abertas {s.abertas ?? 0}</span>
          <span className="block tabular-nums"><span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: "var(--viz-2)" }} />Concluídas {s.ordensConcluidas}</span>
          <span className="block tabular-nums text-muted">MTTR {tempo(s.mttrLiquidoSegundos)}</span>
          {anterior?.[ativo!] && <span className="block tabular-nums text-muted">Anterior: {anterior[ativo!].ordensConcluidas} concl. · MTTR {tempo(anterior[ativo!].mttrLiquidoSegundos)}</span>}
          {s.ordensConcluidas > 0 && s.ordensConcluidas < AMOSTRA_MIN && <span className="block text-warn-soft-fg">⚠ amostra baixa</span>}
        </div>
      )}
    </div>
  );
}

/** Legenda do fluxo. Meta = tracejado LONGO (rótulo na própria linha); período anterior = PONTILHADO claro. */
export function LegendaFluxo({ comparando, comMeta }: { comparando: boolean; comMeta: boolean }) {
  const item = (cor: ReactNode, t: string) => <li className="inline-flex items-center gap-1.5">{cor}{t}</li>;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
      {item(<span aria-hidden className="h-3 w-3 rounded-sm" style={{ background: "var(--viz-1)" }} />, "Abertas")}
      {item(<span aria-hidden className="h-3 w-3 rounded-sm" style={{ background: "var(--viz-2)" }} />, "Concluídas")}
      {item(<svg aria-hidden width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--viz-1)" strokeWidth="2" /></svg>, "MTTR (mão de obra)")}
      {comparando && item(<svg aria-hidden width="22" height="6"><line x1="1" y1="3" x2="21" y2="3" stroke="var(--c-muted)" strokeWidth="2" strokeDasharray="0.1 5" strokeLinecap="round" /></svg>, "Período anterior")}
      {comMeta && item(<svg aria-hidden width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" stroke="var(--c-muted)" strokeWidth="1.5" strokeDasharray="10 5" /></svg>, "Meta de MTTR")}
    </ul>
  );
}

/** Barra empilhada horizontal (partes ordinais). Contagem em texto acima de cada parte; separadores de 2 px na cor do cartão. */
export function BarraEmpilhada({ partes, rotuloGeral }: { partes: { rotulo: string; n: number; cor: string }[]; rotuloGeral: string }) {
  const total = partes.reduce((a, p) => a + p.n, 0) || 1;
  return (
    <div role="group" aria-label={rotuloGeral}>
      <div className="flex gap-[2px]" aria-hidden>
        {partes.map((p) => p.n > 0 && (
          <span key={p.rotulo} className="min-w-[1.5rem] text-sm font-bold tabular-nums text-fg" style={{ flexGrow: p.n, flexBasis: 0 }}>{p.n}</span>
        ))}
      </div>
      <div aria-hidden className="mt-1 flex h-5 gap-[2px] overflow-hidden rounded-[4px] bg-viz-track">
        {partes.map((p) => p.n > 0 && <span key={p.rotulo} className={`h-5 min-w-[1.5rem] ${p.cor}`} style={{ flexGrow: p.n, flexBasis: 0 }} />)}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {partes.map((p) => (
          <li key={p.rotulo} className="inline-flex items-center gap-1.5"><span aria-hidden className={`h-3 w-3 rounded-sm ${p.cor}`} /><span className="text-fg">{p.rotulo}</span><span className="tabular-nums text-muted">{p.n} ({Math.round((p.n / total) * 100)} %)</span></li>
        ))}
      </ul>
    </div>
  );
}

/** Anel de meta: 1 razão contra um limite. Trilho + arco; o estado vem em ícone + texto fora do anel. */
export function Anel({ pct, classeArco, centro }: { pct: number; classeArco: string; centro: ReactNode }) {
  const R = 52, C = 2 * Math.PI * R, p = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative mx-auto h-40 w-40">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--viz-track)" strokeWidth={10} />
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth={10} strokeLinecap="round" className={classeArco} strokeDasharray={`${(p / 100) * C} ${C}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{centro}</div>
    </div>
  );
}

// ======================= Gráficos separados (Fase 27) =======================
/** Largura/altura (px) da caixa que o cartão oferece; os gráficos preenchem o espaço todo. */
function useCaixa() {
  const caixa = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 800, h: 260 });
  useEffect(() => {
    const el = caixa.current; if (!el) return;
    const ler = () => setDim({ w: el.clientWidth || 800, h: el.clientHeight || 260 });
    ler();
    const ro = new ResizeObserver(ler); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { caixa, dim };
}

/** Volume de OMs: colunas agrupadas Abertas (--viz-1) × Concluídas (--viz-2). Períodos focáveis (Tab) com tooltip; valor no pico e no último período. */
export function GraficoVolumeOms({ serie }: { serie: PontoFluxo[] }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const { caixa, dim } = useCaixa();
  const n = serie.length;
  const escala = dim.w / W, H = Math.max(140, dim.h / escala), rodape = 18, topoPad = 16, base = H - rodape;
  const pw = W - PAD_L - PAD_R, banda = pw / n, cx = (i: number) => PAD_L + banda * (i + 0.5);
  const bw = Math.max(3, Math.min(18, banda * 0.36));
  const maxVol = teto(Math.max(1, ...serie.flatMap((s) => [s.abertas ?? 0, s.ordensConcluidas])));
  const y = (v: number) => topoPad + (base - topoPad) * (1 - v / maxVol);
  const tot = (s: PontoFluxo) => Math.max(s.abertas ?? 0, s.ordensConcluidas);
  const iPico = serie.reduce((m, s, i) => (tot(s) > tot(serie[m]) ? i : m), 0);
  const totA = serie.reduce((a, s) => a + (s.abertas ?? 0), 0), totC = serie.reduce((a, s) => a + s.ordensConcluidas, 0);
  const s = ativo !== null ? serie[ativo] : null;
  const rot = (x: number, v: number, k: string) => v > 0 && <text key={k} x={x} y={y(v) - 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--c-fg)" className="tabular-nums" style={HALO}>{v}</text>;
  return (
    <div ref={caixa} className="absolute inset-0" onMouseLeave={() => setAtivo(null)}>
      <div role="group" aria-label={`Volume de OMs por período: ${plural(totA, "aberta", "abertas")} e ${plural(totC, "concluída", "concluídas")} no total.`}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="presentation" style={{ height: H * escala }}>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(maxVol * t)} y2={y(maxVol * t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} />
              <text x={PAD_L - 6} y={y(maxVol * t) + 4} textAnchor="end" fontSize={11} fill="var(--c-muted)" className="tabular-nums">{Math.round(maxVol * t)}</text>
            </g>
          ))}
          {ativo !== null && <rect x={PAD_L + banda * ativo} y={topoPad - 4} width={banda} height={base - topoPad + 4} fill="var(--viz-track)" opacity={0.6} />}
          {serie.map((p, i) => {
            const a = p.abertas ?? 0, c = p.ordensConcluidas, mostra = i === iPico || i === n - 1;
            return (
              <g key={i}>
                <rect x={cx(i) - bw - 0.5} y={y(a)} width={bw} height={Math.max(0, y(0) - y(a))} rx={3} fill="var(--viz-1)" />
                <rect x={cx(i) + 0.5} y={y(c)} width={bw} height={Math.max(0, y(0) - y(c))} rx={3} fill="var(--viz-2)" />
                {mostra && rot(cx(i) - bw / 2 - 0.5, a, "a")}{mostra && rot(cx(i) + bw / 2 + 0.5, c, "c")}
              </g>
            );
          })}
          {[0, Math.floor((n - 1) / 2), n - 1].filter((x, k, a) => a.indexOf(x) === k).map((i) => (
            <text key={i} x={cx(i)} y={base + 13} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill="var(--c-muted)" className="tabular-nums">{rotuloData(serie[i].periodo)}</text>
          ))}
          {serie.map((p, i) => (
            <rect key={i} x={PAD_L + banda * i} y={0} width={banda} height={base} fill="transparent" tabIndex={0} className="viz-foco"
              aria-label={`${rotuloData(p.periodo)}: ${plural(p.abertas ?? 0, "aberta", "abertas")}, ${plural(p.ordensConcluidas, "concluída", "concluídas")}`}
              onMouseEnter={() => setAtivo(i)} onMouseLeave={() => setAtivo((a) => (a === i ? null : a))} onFocus={() => setAtivo(i)} onBlur={() => setAtivo((a) => (a === i ? null : a))} />
          ))}
        </svg>
      </div>
      {s && ativo !== null && (
        <div aria-hidden className="pointer-events-none absolute top-0 z-10 w-max max-w-[15rem] rounded-lg bg-panel-2 p-2 text-left text-xs text-fg shadow-lg ring-1 ring-line"
          style={{ left: `${Math.min(Math.max((cx(ativo) / W) * 100, 12), 82)}%`, transform: "translate(-50%, -4px)" }}>
          <strong className="block">{rotuloData(s.periodo)}</strong>
          <span className="block tabular-nums"><span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: "var(--viz-1)" }} />Abertas {s.abertas ?? 0}</span>
          <span className="block tabular-nums"><span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: "var(--viz-2)" }} />Concluídas {s.ordensConcluidas}</span>
        </div>
      )}
    </div>
  );
}

/** Evolução do MTTR (mão de obra): linha ligando só os períodos com dado, meta em tracejado longo e período anterior pontilhado (quando `anterior`). */
export function GraficoMttrEvolucao({ serie, anterior, metaMttrSegundos }: { serie: PontoFluxo[]; anterior?: PontoFluxo[]; metaMttrSegundos?: number | null }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const { caixa, dim } = useCaixa();
  const n = serie.length;
  const escala = dim.w / W, H = Math.max(140, dim.h / escala), rodape = 18, topoPad = 22, base = H - rodape;
  const pw = W - PAD_L - PAD_R, banda = pw / n, cx = (i: number) => PAD_L + banda * (i + 0.5);
  const valores = serie.map((s) => s.mttrLiquidoSegundos);
  const prev = anterior?.map((s) => s.mttrLiquidoSegundos) ?? [];
  const eixo = eixoTempo(Math.max(1, metaMttrSegundos ?? 0, ...valores.map((v) => v ?? 0), ...prev.map((v) => v ?? 0)));
  const yt = (v: number) => topoPad + (base - topoPad - 4) * (1 - v / eixo.topo);
  const reais = valores.map((v, i) => (v === null ? null : i)).filter((x): x is number => x !== null);
  const iPico = reais.length ? reais.reduce((m, i) => ((valores[i] ?? 0) > (valores[m] ?? 0) ? i : m), reais[0]) : -1;
  const iUlt = reais.length ? reais[reais.length - 1] : -1;
  const yMeta = metaMttrSegundos ? yt(metaMttrSegundos) : null;
  const ponto = (vs: (number | null)[]) => vs.map((v, i) => (v === null ? null : ([cx(i), yt(v)] as const)));
  const s = ativo !== null ? serie[ativo] : null;
  const rotulo = (i: number) => {
    const yy = yt(valores[i] ?? 0);
    const yRot = yMeta !== null && Math.abs(yy - yMeta) < 16 ? Math.min(yy, yMeta) - 9 : yy - 8;
    return <text key={i} x={Math.min(Math.max(cx(i), PAD_L + 26), W - PAD_R - 26)} y={yRot} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--c-fg)" className="tabular-nums" style={HALO}>{tempo(valores[i])}</text>;
  };
  return (
    <div ref={caixa} className="absolute inset-0" onMouseLeave={() => setAtivo(null)}>
      <div role="group" aria-label={`Evolução do MTTR (mão de obra) por período. Último ponto com dado: ${tempo(valores[iUlt] ?? null)}${metaMttrSegundos ? `; meta ${tempo(metaMttrSegundos)}` : ""}.`}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="presentation" style={{ height: H * escala }}>
          {eixo.marcas.map((m, k) => (
            <g key={m}>
              <line x1={PAD_L} x2={W - PAD_R} y1={yt(m)} y2={yt(m)} stroke={k === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} />
              <text x={PAD_L - 6} y={yt(m) + 4} textAnchor="end" fontSize={11} fill="var(--c-muted)" className="tabular-nums">{rotuloEixoTempo(m)}</text>
            </g>
          ))}
          {yMeta !== null && metaMttrSegundos ? (
            <g>
              <line x1={PAD_L} x2={W - PAD_R} y1={yMeta} y2={yMeta} stroke="var(--c-muted)" strokeWidth={1.5} strokeDasharray="10 5" />
              <text x={PAD_L + 4} y={yMeta - 4} fontSize={11} fill="var(--c-muted)" style={HALO}>meta {tempo(metaMttrSegundos)}</text>
            </g>
          ) : null}
          {prev.some((v) => v !== null) && <path d={caminhoContinuo(ponto(prev))} fill="none" stroke="var(--c-muted)" strokeWidth={2} strokeDasharray="0.1 5" strokeLinecap="round" opacity={0.85} />}
          <path d={caminhoContinuo(ponto(valores))} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {ponto(valores).map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={ativo === i ? 5 : 3} fill="var(--viz-1)" />)}
          {[iPico, iUlt].filter((x, k, a) => x >= 0 && a.indexOf(x) === k).map(rotulo)}
          {ativo !== null && <line x1={cx(ativo)} x2={cx(ativo)} y1={topoPad - 6} y2={base} stroke="var(--viz-axis)" strokeDasharray="2 3" />}
          {[0, Math.floor((n - 1) / 2), n - 1].filter((x, k, a) => a.indexOf(x) === k).map((i) => (
            <text key={i} x={cx(i)} y={base + 13} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill="var(--c-muted)" className="tabular-nums">{rotuloData(serie[i].periodo)}</text>
          ))}
          {serie.map((p, i) => (
            <rect key={i} x={PAD_L + banda * i} y={0} width={banda} height={base} fill="transparent" tabIndex={0} className="viz-foco"
              aria-label={`${rotuloData(p.periodo)}: MTTR ${tempo(p.mttrLiquidoSegundos)}${p.ordensConcluidas > 0 && p.ordensConcluidas < AMOSTRA_MIN ? ", amostra baixa" : ""}`}
              onMouseEnter={() => setAtivo(i)} onMouseLeave={() => setAtivo((a) => (a === i ? null : a))} onFocus={() => setAtivo(i)} onBlur={() => setAtivo((a) => (a === i ? null : a))} />
          ))}
        </svg>
      </div>
      {s && ativo !== null && (
        <div aria-hidden className="pointer-events-none absolute top-0 z-10 w-max max-w-[15rem] rounded-lg bg-panel-2 p-2 text-left text-xs text-fg shadow-lg ring-1 ring-line"
          style={{ left: `${Math.min(Math.max((cx(ativo) / W) * 100, 12), 82)}%`, transform: "translate(-50%, -4px)" }}>
          <strong className="block">{rotuloData(s.periodo)}</strong>
          <span className="block tabular-nums">MTTR {tempo(s.mttrLiquidoSegundos)}</span>
          {anterior?.[ativo] && <span className="block tabular-nums text-muted">Anterior: {tempo(anterior[ativo].mttrLiquidoSegundos)}</span>}
          {s.ordensConcluidas > 0 && s.ordensConcluidas < AMOSTRA_MIN && <span className="block text-warn-soft-fg">⚠ amostra baixa</span>}
        </div>
      )}
    </div>
  );
}
