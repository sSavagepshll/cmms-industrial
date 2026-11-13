"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { AMOSTRA_MIN } from "@/lib/desempenho";
import { baixarCsv } from "@/lib/csv";
import { Icone } from "../../ui/Icones";

// ---------------- carregamento por bloco (cada bloco falha sozinho) ----------------
export type EstadoDado = "carregando" | "erro" | "ok";
export interface Dado<T> { estado: EstadoDado; dados: T | null; status?: number; /** epoch ms da última leitura bem-sucedida (usa `geradoEm` do servidor quando existir) */ em?: number }

/**
 * Busca um bloco. Mantém os dados anteriores durante a releitura (sem piscar), expõe `recarregar` e relê quando `chave` muda.
 * 401 é tratado pelo handler global (logout); aqui só vira "erro".
 */
export function useBloco<T>(buscar: () => Promise<T>, chave: string, nonce: number, ativo = true): Dado<T> & { recarregar: () => void } {
  const [d, setD] = useState<Dado<T>>({ estado: "carregando", dados: null });
  const [local, setLocal] = useState(0);
  const ultima = useRef(chave);
  useEffect(() => {
    let vivo = true;
    if (ultima.current !== chave) { ultima.current = chave; setD({ estado: "carregando", dados: null }); }
    if (!ativo) return; // carga sob demanda (ex.: metas só ao abrir a CaixaMetas)
    buscar()
      .then((r) => vivo && setD({ estado: "ok", dados: r, em: instanteDe(r) }))
      .catch((e) => vivo && setD((p) => ({ estado: "erro", dados: p.dados, em: p.em, status: e instanceof ApiError ? e.status : 0 })));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, nonce, local, ativo]);
  const recarregar = useCallback(() => { setD((p) => ({ ...p, estado: "carregando" })); setLocal((n) => n + 1); }, []);
  return { ...d, recarregar };
}

/** `geradoEm` do servidor (D8) quando houver; senão o instante em que o cliente recebeu a resposta. */
function instanteDe(r: unknown): number {
  const g = r && typeof r === "object" ? Date.parse(String((r as { geradoEm?: unknown }).geradoEm ?? "")) : NaN;
  return Number.isFinite(g) ? g : Date.now();
}

// ---------------- peças ----------------
export function AmostraBaixa({ n }: { n: number }) {
  return n < AMOSTRA_MIN ? <span className="inline-flex items-center gap-1 text-warn-soft-fg"><Icone nome="alerta" className="h-3.5 w-3.5" />amostra baixa</span> : null;
}

/** Erro de bloco: aviso com ícone + texto e "Tentar novamente" (nunca só cor). */
export function ErroBloco({ texto, onTentar }: { texto: string; onTentar: () => void }) {
  return (
    <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-warn-soft p-3 text-warn-soft-fg">
      <Icone nome="alerta" className="h-5 w-5 shrink-0" />
      <span className="min-w-0 flex-1">{texto}</span>
      <button onClick={onTentar} className="min-h-11 rounded-lg bg-panel px-3 font-semibold text-fg ring-2 ring-warn-fg">Tentar novamente</button>
    </div>
  );
}

export function Vazio({ texto, dica }: { texto: string; dica?: string }) {
  return <div className="py-8 text-center text-muted"><p>{texto}</p>{dica && <p className="mt-1 text-sm">{dica}</p>}</div>;
}

export function EsqueletoBarras({ linhas = 4 }: { linhas?: number }) {
  return (
    <ul aria-hidden className="mt-3 flex flex-col gap-3">
      {Array.from({ length: linhas }, (_, i) => (
        <li key={i}><div className="h-4 w-2/3 rounded bg-viz-track motion-safe:animate-pulse" /><div className="mt-1 h-3 rounded-[4px] bg-viz-track motion-safe:animate-pulse" /></li>
      ))}
    </ul>
  );
}
export function EsqueletoBloco({ alto }: { alto: number }) {
  return <div aria-hidden className="mt-3 rounded-xl bg-viz-track motion-safe:animate-pulse" style={{ height: alto }} />;
}

/** Barra horizontal: trilho `viz-track`, 4 px de raio só na ponta do dado, largura mínima de 8 px. Texto em fg/muted. */
export function BarraLinha({ rotulo, valor, pct, cor = "bg-viz-1", extra }: { rotulo: string; valor: string; pct: number; cor?: string; extra?: ReactNode }) {
  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-semibold text-fg">{rotulo}</span>
        <span className="tabular-nums text-muted">{valor}{extra && <> · {extra}</>}</span>
      </div>
      <div aria-hidden className="mt-1 h-3 overflow-hidden rounded-[4px] bg-viz-track">
        <div className={`h-3 rounded-r-[4px] ${cor}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%`, minWidth: pct > 0 ? 8 : 0 }} />
      </div>
    </li>
  );
}

/** Tabela alternativa (`<details>`) + Exportar CSV do bloco. */
export function TabelaAlt({ titulo, colunas, linhas, arquivo }: { titulo: string; colunas: string[]; linhas: (string | number | null)[][]; arquivo: string }) {
  function exportar() { baixarCsv(arquivo, [colunas, ...linhas]); }
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-semibold text-primary-fg">Ver como tabela</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <caption className="sr-only">{titulo}</caption>
          <thead className="text-muted"><tr>{colunas.map((c) => <th key={c} scope="col" className="py-1 pr-3">{c}</th>)}</tr></thead>
          <tbody>{linhas.map((l, i) => (
            <tr key={i} className="border-t border-line/30 dark:border-line-soft">{l.map((c, j) => <td key={j} className="py-1 pr-3">{c ?? "—"}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
      <button onClick={exportar} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg bg-panel px-3 font-semibold ring-2 ring-line hover:bg-brand-50"><Icone nome="baixar" className="h-4 w-4" />Exportar CSV</button>
    </details>
  );
}

/** Cartão de bloco: título, estados (carregando/erro/vazio) e área de conteúdo. */
export function Bloco({ titulo, nota, estado, vazio, erroTexto, onTentar, esqueleto, className = "", children }: {
  titulo: string; nota?: string; estado: EstadoDado | "vazio"; vazio?: ReactNode; erroTexto?: string; onTentar: () => void;
  esqueleto: ReactNode; className?: string; children?: ReactNode;
}) {
  return (
    <article aria-label={titulo} aria-busy={estado === "carregando"} className={`flex flex-col rounded-2xl bg-panel p-4 ring-1 ring-line ${className}`}>
      <h2 className="text-lg font-extrabold">{titulo}{nota && <span className="ml-1 text-sm font-normal text-muted">{nota}</span>}</h2>
      {estado === "carregando" ? esqueleto
        : estado === "erro" ? <ErroBloco texto={erroTexto ?? "Não foi possível carregar este bloco."} onTentar={onTentar} />
        : estado === "vazio" ? vazio : children}
    </article>
  );
}

// ---------------- caixa expansível de metas (Fase 22, itens 4 e 5) ----------------
/** Preferência de abertura da CaixaMetas por painel (`om.dash.metas.<painel>`), lembrada neste navegador. Recolhida por padrão. */
export function useCaixaMetas(painel: "executivo" | "operacional"): [boolean, (a: boolean) => void] {
  const chave = `om.dash.metas.${painel}`;
  const [aberta, setAberta] = useState(false);
  useEffect(() => { try { setAberta(localStorage.getItem(chave) === "1"); } catch { /* storage bloqueado: segue recolhida */ } }, [chave]);
  const definir = useCallback((a: boolean) => { setAberta(a); try { localStorage.setItem(chave, a ? "1" : "0"); } catch { /* sem persistência */ } }, [chave]);
  return [aberta, definir];
}

/**
 * Caixa expansível "Análise de metas": o card principal do painel mostra números diretos e as metas/zonas (medidores) ficam aqui.
 * Cabeçalho é um botão (aria-expanded/aria-controls; Enter/Espaço nativos). O conteúdo só é renderizado quando aberta.
 * `forcada` (Modo TV): sempre aberta e sem o botão de recolher.
 */
export function CaixaMetas({ id, aberta, onAlternar, forcada = false, resumo, children, tv = false }: {
  id: string; aberta: boolean; onAlternar: (a: boolean) => void; forcada?: boolean; resumo?: ReactNode; children: ReactNode; tv?: boolean;
}) {
  const aberto = forcada || aberta;
  const painel = `${id}-conteudo`;
  const titulo = (
    <>
      <span className={`font-extrabold ${tv ? "text-[28px]" : "text-base"}`}>Análise de metas</span>
      <span className={`min-w-0 flex-1 truncate text-muted ${tv ? "text-[22px]" : "text-sm"}`}>{resumo ?? "MTTA e MTTR em relação às metas, com zonas"}</span>
    </>
  );
  return (
    <section aria-label="Análise de metas" className={`rounded-xl bg-panel ring-1 ring-line ${tv ? "p-3" : ""}`}>
      {forcada ? <div className="flex items-center gap-3 px-1 pb-2">{titulo}</div> : (
        <button type="button" id={`${id}-botao`} aria-expanded={aberto} aria-controls={painel} onClick={() => onAlternar(!aberta)}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-4 text-left hover:bg-brand-50 focus-visible:ring-2">
          <span aria-hidden className="w-4 shrink-0">{aberto ? "▼" : "▶"}</span>{titulo}
        </button>
      )}
      {aberto && <div id={painel} role="region" aria-labelledby={forcada ? undefined : `${id}-botao`} className={forcada ? "" : "border-t border-line/40 p-3 dark:border-line-soft"}>{children}</div>}
    </section>
  );
}
