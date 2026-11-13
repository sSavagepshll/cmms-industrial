"use client";
import { useEffect, useState, type ReactNode } from "react";
import { numero, type Fatia, type Zona } from "@/lib/desempenho";

// Gráficos REDONDOS em SVG próprio (docs/ux/fase18-dashboard-executivo.md §4): velocímetro 180°, anel, rosca e pizza.
// Sem 3D, sem gradiente, sem fatia explodida, escala sempre a partir de 0, cores só pelos tokens (--viz-*, --c-*).

const COR_ZONA: Record<Zona, string> = { ok: "var(--c-ok-fg)", atencao: "var(--viz-zona-atencao)", perigo: "var(--c-danger-fg)" };
const COR_NOMINAL = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"];

const rad = (g: number) => (g * Math.PI) / 180;
/** Ponto no círculo medido a partir das 12 h, no sentido horário (graus). */
const doTopo = (cx: number, cy: number, r: number, g: number) => [cx + r * Math.sin(rad(g)), cy - r * Math.cos(rad(g))] as const;
/** Setor anelar (ri = 0 vira fatia de pizza), em graus a partir das 12 h. */
function setor(cx: number, cy: number, re: number, ri: number, a0: number, a1: number): string {
  const f = (n: number) => n.toFixed(2);
  const fim = Math.min(a1, a0 + 359.99);
  const [x0, y0] = doTopo(cx, cy, re, a0), [x1, y1] = doTopo(cx, cy, re, fim);
  const grande = fim - a0 > 180 ? 1 : 0;
  if (ri <= 0) return `M${f(cx)} ${f(cy)}L${f(x0)} ${f(y0)}A${re} ${re} 0 ${grande} 1 ${f(x1)} ${f(y1)}Z`;
  const [x2, y2] = doTopo(cx, cy, ri, fim), [x3, y3] = doTopo(cx, cy, ri, a0);
  return `M${f(x0)} ${f(y0)}A${re} ${re} 0 ${grande} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${ri} ${ri} 0 ${grande} 0 ${f(x3)} ${f(y3)}Z`;
}

// ======================= Rosca e Pizza =======================
export interface PropsRosca {
  fatias: Fatia[];
  /** Cores por fatia (ordinais). Padrão: 3 nominais + "Outros" cinza. */
  cores?: string[];
  /** Pizza = sem furo; rosca = centro com o total. */
  pizza?: boolean;
  centro?: { valor: string; rotulo?: string };
  formatar?: (v: number) => string;
  ariaLabel: string;
  tv?: boolean;
}

export function Rosca({ fatias, cores, pizza = false, centro, formatar = numero, ariaLabel, tv = false }: PropsRosca) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const total = fatias.reduce((a, f) => a + f.valor, 0);
  const cor = (f: Fatia, i: number) => (f.outros ? "var(--viz-outros)" : cores?.[i] ?? COR_NOMINAL[i] ?? "var(--viz-1)");
  const CX = 100, CY = 100, RE = 84, RI = pizza ? 0 : 54;
  let acc = 0;
  const arcos = fatias.map((f, i) => {
    const a0 = (acc / (total || 1)) * 360; acc += f.valor; const a1 = (acc / (total || 1)) * 360;
    return { f, i, a0, a1, d: setor(CX, CY, RE, RI, a0, a1) };
  });
  const pctDe = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  return (
    <div role="group" aria-label={ariaLabel} className={`flex items-center ${tv ? "gap-5" : "gap-4"}`}>
      <div className={`relative shrink-0 ${tv ? "h-[240px] w-[240px]" : "h-[130px] w-[130px]"}`}>
        <svg viewBox="0 0 200 200" role="presentation" className="h-full w-full">
          {total === 0 ? <circle cx={CX} cy={CY} r={(RE + RI) / 2} fill="none" stroke="var(--viz-track)" strokeWidth={RE - RI || 2 * RE} /> : arcos.map(({ f, i, d }) => (
            <path key={f.rotulo + i} d={d} fill={cor(f, i)} stroke={ativo === i ? "var(--c-fg)" : "var(--c-panel)"} strokeWidth={ativo === i ? 3 : 2} strokeLinejoin="round"
              tabIndex={tv ? -1 : 0} className="viz-foco" aria-label={`${f.rotulo}: ${formatar(f.valor)}, ${pctDe(f.valor)} %`}
              onMouseEnter={() => setAtivo(i)} onMouseLeave={() => setAtivo(null)} onFocus={() => setAtivo(i)} onBlur={() => setAtivo(null)} />
          ))}
          {!pizza && centro && (
            <g pointerEvents="none" textAnchor="middle" fill="var(--c-fg)">
              <text x={CX} y={centro.rotulo ? CY + 8 : CY + 14} fontSize={tv ? 54 : 40} fontWeight={800} className="tabular-nums">{centro.valor}</text>
              {centro.rotulo && <text x={CX} y={CY + 28} fontSize={tv ? 19 : 19} fill="var(--c-muted)">{centro.rotulo}</text>}
            </g>
          )}
        </svg>
        {ativo !== null && !tv && fatias[ativo] && (
          <div aria-hidden className="pointer-events-none absolute -top-1 left-1/2 z-10 w-max max-w-[14rem] -translate-x-1/2 -translate-y-full rounded-lg bg-panel-2 p-2 text-left text-xs text-fg shadow-lg ring-1 ring-line">
            <strong className="block">{fatias[ativo].rotulo}</strong>
            <span className="block tabular-nums">{formatar(fatias[ativo].valor)} · {pctDe(fatias[ativo].valor)} %</span>
            {fatias[ativo].detalhe && <span className="block text-muted">{fatias[ativo].detalhe}</span>}
          </div>
        )}
      </div>
      <ul className={`min-w-0 flex-1 ${tv ? "flex flex-col gap-2 text-[22px]" : "flex flex-col gap-1 text-[13px]"}`}>
        {fatias.map((f, i) => (
          <li key={f.rotulo + i} className="flex flex-col">
            <span className="flex items-start gap-2">
              <span aria-hidden className={tv ? "mt-1.5 h-5 w-5 shrink-0 rounded-sm" : "mt-1 h-3 w-3 shrink-0 rounded-sm"} style={{ background: cor(f, i) }} />
              <span className="min-w-0 pr-3 font-semibold leading-tight text-fg" title={f.detalhe ?? f.rotulo}>{f.rotulo.split("/").join("/\u200b")}</span>
            </span>
            <span className={tv ? "pl-7 tabular-nums leading-tight text-fg" : "pl-5 tabular-nums leading-tight text-fg"}>{formatar(f.valor)} <span className="text-muted">· {pctDe(f.valor)} %</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ======================= Anel (razão natural 0–100 %, sem zonas) =======================
export function AnelPct({ pct, valorTexto, rotulo, ariaLabel, tv = false }: { pct: number | null; valorTexto: string; rotulo?: string; ariaLabel: string; tv?: boolean }) {
  const R = 64, C = 2 * Math.PI * R, p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div role="group" aria-label={ariaLabel} className={`relative mx-auto ${tv ? "h-[350px] w-[350px]" : "h-[150px] w-[150px]"}`}>
      <svg viewBox="0 0 160 160" role="presentation" className="h-full w-full">
        <g transform="rotate(-90 80 80)">
          <circle cx="80" cy="80" r={R} fill="none" stroke="var(--viz-track)" strokeWidth={12} />
          {pct !== null && <circle cx="80" cy="80" r={R} fill="none" stroke="var(--viz-1)" strokeWidth={12} strokeLinecap="round" strokeDasharray={`${(p / 100) * C} ${C}`} />}
        </g>
        <g textAnchor="middle" fill="var(--c-fg)" pointerEvents="none">
          <text x="80" y={rotulo ? 86 : 94} fontSize={tv ? 42 : 34} fontWeight={800} className="tabular-nums">{tv && valorTexto.endsWith(" %") ? <>{valorTexto.slice(0, -2)}<tspan fontSize={22}>%</tspan></> : valorTexto}</text>
          {rotulo && <text x="80" y="110" fontSize={tv ? 13 : 13} fill="var(--c-muted)">{rotulo}</text>}
        </g>
      </svg>
    </div>
  );
}

// ======================= Velocímetro 180° =======================
export interface ZonaArco { de: number; ate: number; zona: Zona }
export interface PropsVelocimetro {
  /** Valor na escala 0..max (já em % da meta ou % de atendimento). null = sem ponteiro. */
  valor: number | null;
  max: number;
  zonas: ZonaArco[];
  ticks: number[];
  /** Texto grande no centro (ex.: "63 %" ou "2 h 00"). */
  centro: string;
  /** "semMeta": arco cinza + sem ponteiro. "poucos": arco cinza + sem zona. */
  modo: "dados" | "semMeta" | "poucos" | "semZona";
  ariaLabel: string;
  tv?: boolean;
}

export function Velocimetro({ valor, max, zonas, ticks, centro, modo, ariaLabel, tv = false }: PropsVelocimetro) {
  const CX = 120, CY = 112, RE = 96, RI = 80;
  const ang = (v: number) => (Math.max(0, Math.min(max, v)) / max) * 180;
  const doEsq = (r: number, a: number) => [CX - r * Math.cos(rad(a)), CY - r * Math.sin(rad(a))] as const;
  const arco = (a0: number, a1: number) => {
    const [x0, y0] = doEsq(RE, a0), [x1, y1] = doEsq(RE, a1), [x2, y2] = doEsq(RI, a1), [x3, y3] = doEsq(RI, a0);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${RE} ${RE} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}A${RI} ${RI} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`;
  };
  const mostrarZonas = modo === "dados";
  const comPonteiro = (modo === "dados" || modo === "semZona") && valor !== null;
  const alvo = comPonteiro ? ang(valor as number) : 0;
  // Varredura inicial de 600 ms do ponteiro (sem animação com prefers-reduced-motion): começa em 0 e vai ao valor.
  const [giro, setGiro] = useState(0);
  useEffect(() => { const id = requestAnimationFrame(() => setGiro(alvo)); return () => cancelAnimationFrame(id); }, [alvo]);
  const GAP = 1.2; // ≈ 2 px de vão entre zonas
  return (
    <div role="group" aria-label={ariaLabel} className={`mx-auto ${tv ? "w-full max-w-[560px]" : "w-full max-w-[250px]"}`}>
      <svg viewBox="-6 -12 252 136" role="presentation" className="block w-full">
        {mostrarZonas
          ? zonas.map((z) => <path key={z.zona + z.de} d={arco(ang(z.de) + (z.de > 0 ? GAP / 2 : 0), ang(z.ate) - (z.ate < max ? GAP / 2 : 0))} fill={COR_ZONA[z.zona]} />)
          : <path d={arco(0, 180)} fill="var(--viz-track)" />}
        {mostrarZonas && ticks.map((t) => {
          const [x, y] = doEsq(RE + 11, ang(t)), [xa, ya] = doEsq(RE + 2, ang(t));
          // Nas laterais o texto ancora para FORA (start/end) e não invade o arco; no topo fica centralizado.
          const lado = ang(t) < 65 ? "end" : ang(t) > 115 ? "start" : "middle";
          return (
            <g key={t}>
              <line x1={xa} y1={ya} x2={doEsq(RE + 6, ang(t))[0]} y2={doEsq(RE + 6, ang(t))[1]} stroke="var(--c-line)" strokeWidth={1.5} />
              <text x={x + (lado === "end" ? -2 : lado === "start" ? 2 : 0)} y={y + (lado === "middle" ? 0 : 4)} fontSize={12} textAnchor={lado} fill="var(--c-muted)" className="tabular-nums">{t}{max === 100 || max === 150 ? "%" : ""}</text>
            </g>
          );
        })}
        {comPonteiro && (
          <g style={{ transform: `rotate(${giro}deg)`, transformOrigin: `${CX}px ${CY}px` }} className="transition-transform duration-[600ms] ease-out motion-reduce:transition-none">
            <line x1={CX - 60} y1={CY} x2={CX - 92} y2={CY} stroke="var(--c-panel)" strokeWidth={6} strokeLinecap="round" />
            <line x1={CX - 60} y1={CY} x2={CX - 92} y2={CY} stroke="var(--c-fg)" strokeWidth={3} strokeLinecap="round" />
            <circle cx={CX - 60} cy={CY} r={6.5} fill="var(--c-panel)" />
            <circle cx={CX - 60} cy={CY} r={5} fill="var(--c-fg)" />
          </g>
        )}
        {(modo === "dados" || modo === "semZona") && <text x={CX} y={CY - 8} textAnchor="middle" fontSize={tv ? (centro.length > 6 ? 41 : 45) : 40} fontWeight={800} fill="var(--c-fg)" className="tabular-nums" pointerEvents="none">{centro}</text>}
      </svg>
    </div>
  );
}

/** Estado em palavras com ícone (nunca só cor), abaixo do gráfico. */
export function EstadoZona({ zona, children, tv = false }: { zona: Zona; children?: ReactNode; tv?: boolean }) {
  const ic = zona === "ok" ? "✓" : zona === "atencao" ? "⚠" : "✖";
  const cls = zona === "ok" ? "text-ok-soft-fg" : zona === "atencao" ? "text-warn-soft-fg" : "text-danger-soft-fg";
  const txt = zona === "ok" ? "dentro da meta" : zona === "atencao" ? "atenção" : "abaixo da meta";
  return <p className={`inline-flex items-center justify-center gap-1.5 font-semibold ${cls} ${tv ? "text-[28px]" : "text-base"}`}><span aria-hidden>{ic}</span>{children ?? txt}</p>;
}
