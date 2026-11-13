"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buscarAtencao, buscarBacklog, buscarEquipe, buscarFluxo, buscarKpis, buscarMeta, buscarOfensoresDe, buscarPausasDe, type AtencaoResp } from "@/lib/api";
import { FILTRO_PADRAO, filtroParaBusca, intervaloDe, lerFiltro, paramsMetricas, tempo, type FiltroDesempenho } from "@/lib/desempenho";
import { conectarEventos } from "@/lib/sse";
import { Icone } from "../ui/Icones";
import { CaixaMetas, useBloco, useCaixaMetas, type Dado } from "./desempenho/comum";
import { BacklogBloco, BlocoMttrEvolucao, BlocoVolumeOms, EquipeAgora, MttrPor, Ofensores, PausasMotivo } from "./desempenho/blocos";
import { CardAprovadas, CardBacklog, CardCategorias, CardConcluidas, CardMtta, CardMttaDireto, CardMttr, CardMttrDireto, CardPausas, CardTempoParada, PainelAtencao, ResumoPeriodo, type ItemAtencao } from "./desempenho/executiva";
import { FiltrosDesempenho } from "./desempenho/FiltrosDesempenho";

/** Modo TV: período FIXO de 7 dias, sem filtros editáveis (docs/ux/fase18-dashboard-executivo.md §7). */
const FILTRO_TV: FiltroDesempenho = { ...FILTRO_PADRAO, dias: 7 };
const POLL_SEM_SSE_MS = 60_000;
const DEBOUNCE_SSE_MS = 5_000;
const DESATUALIZADO_MS = 2 * 60_000;   // TV sem operador não pode mostrar número velho como atual
const DESLOCAR_TELA_MS = 10 * 60_000;  // proteção de tela: 1–2 px a cada 10 min
const CURSOR_MS = 3_000;

const TEXTO_ATENCAO: Record<string, string> = { CRITICA_SEM_RESPONSAVEL: "crítica sem responsável", MAIS_DE_8H: "aberta há mais de 8 h", RESERVA_SEM_ACEITE: "reserva sem aceite" };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
/** Itens reais de GET /metricas/atencao (até 5). A reserva sem aceite mostra o tempo que falta para expirar. */
const itensDaApi = (r: AtencaoResp): ItemAtencao[] => r.itens.slice(0, 5).map((i) => ({
  id: `${i.tipo}-${i.id}`,
  texto: `${i.numero}${i.equipamento ? ` · ${i.equipamento}` : ""}: ${TEXTO_ATENCAO[i.tipo] ?? i.tipo}${i.tipo === "RESERVA_SEM_ACEITE" && typeof i.expiraEmSegundos === "number" ? ` (expira em ${mmss(i.expiraEmSegundos)})` : i.idadeSegundos ? ` (${tempo(i.idadeSegundos)})` : ""}`,
}));

/**
 * Dashboard unificado de desempenho da equipe, em camadas progressivas: resumo + 6 cartões simples, CaixaMetas (MTTA/MTTR) e detalhe operacional. Com Modo TV.
 * Cada bloco busca e falha sozinho; filtros e visão na URL; relê por SSE (debounce de 5 s) ou polling de 60 s.
 * Princípio ético: nada de ranking nem gráfico redondo por pessoa; média individual só com 5 ou mais OMs.
 */
export function DashboardPage({ pendentes, onIrAprovacoes, onIrOrdens, onIrParametros, onModoTv }: {
  pendentes: number; onIrAprovacoes: () => void; onIrOrdens: () => void; onIrParametros: () => void; onModoTv?: (ativo: boolean) => void;
}) {
  const [filtroUsuario, setFiltro] = useState<FiltroDesempenho>(() => (typeof window === "undefined" ? FILTRO_PADRAO : lerFiltro(window.location.search)));
  const [tv, setTv] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tv") === "1");
  const [nonce, setNonce] = useState(0);
  const [agoraMs, setAgoraMs] = useState(() => Date.now());
  const [deslocamento, setDeslocamento] = useState(0);
  // O painel é desenhado para 1920×1080 (paisagem) ou 1080×1920 (retrato) e ESCALADO nos dois sentidos, limitado a 0,5–1,5 (US-18, RN-67):
  // uma TV não tem mouse nem rolagem. Ultrawide (largura/altura ≥ 2,2) ganha mais colunas em vez de esticar os cartões.
  const [escalaTv, setEscalaTv] = useState(1);
  const [orientTv, setOrientTv] = useState<"normal" | "retrato" | "ultra">("normal");
  const [cursorOculto, setCursorOculto] = useState(false);
  // Flag de desenvolvimento: ?tvciclo=5 reduz o ciclo de proteção de tela de 10 min para 5 s (lido uma vez: a URL é limpa depois).
  const [cicloTv] = useState(() => (typeof window === "undefined" ? 0 : Number(new URLSearchParams(window.location.search).get("tvciclo")) || 0));
  const filtro = tv ? FILTRO_TV : filtroUsuario;
  const botaoTv = useRef<HTMLButtonElement>(null);
  const secaoTv = useRef<HTMLElement>(null);

  // Filtros e visão na URL (?p|de&ate&tec&prio&tipo&comp&vis); ao sair do Dashboard a URL volta limpa. Em TV a URL não muda.
  useEffect(() => { if (!tv) window.history.replaceState(null, "", `${window.location.pathname}${filtroParaBusca(filtroUsuario)}`); }, [filtroUsuario, tv]);
  useEffect(() => () => { window.history.replaceState(null, "", window.location.pathname); }, []);

  // Datas relativas dependem de "agora": recalculadas a cada releitura (nonce), não a cada render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const params = useMemo(() => paramsMetricas(filtro), [filtro, nonce]);
  const { dias } = intervaloDe(filtro);
  const gran = dias <= 31 ? "day" : dias <= 120 ? "week" : "month";
  const chave = useMemo(() => JSON.stringify([filtro, gran]), [filtro, gran]);
  const pRef = useRef(params); pRef.current = params;

  const kpis = useBloco(() => buscarKpis({ ...pRef.current, comparar: "true" }), chave, nonce);
  const fluxo = useBloco(() => buscarFluxo(pRef.current, gran), chave, nonce);
  // Metas/zonas (CaixaMetas): GET /desempenho/meta só é chamado com a caixa aberta (ou em Modo TV, que a mostra sempre).
  const [metasAberta, setMetasAberta] = useCaixaMetas("executivo");
  const meta = useBloco(() => buscarMeta({ ...pRef.current, comparar: "true" }), chave, nonce, tv || metasAberta);
  const equipe = useBloco(() => buscarEquipe(pRef.current), chave, nonce);
  const backlog = useBloco(() => buscarBacklog(pRef.current), chave, nonce);
  const ofensores = useBloco(() => buscarOfensoresDe(pRef.current), chave, nonce);
  const pausas = useBloco(() => buscarPausasDe(pRef.current), chave, nonce);
  // Atenção agora (TV): GET /metricas/atencao (real). `total` > 5 vira "+N" no painel.
  const atencao = useBloco(() => buscarAtencao(pRef.current), chave, nonce);
  const itensAtencao = atencao.dados ? itensDaApi(atencao.dados) : [];
  const maisAtencao = Math.max(0, (atencao.dados?.total ?? 0) - itensAtencao.length);

  const blocos: Dado<unknown>[] = [kpis, fluxo, meta, backlog, pausas, equipe, ofensores];
  const ultimaOk = Math.max(0, ...blocos.map((b) => (b.estado === "ok" || b.dados ? b.em ?? 0 : 0)));
  const atrasoMs = ultimaOk ? agoraMs - ultimaOk : 0;
  const desatualizado = tv && ultimaOk > 0 && atrasoMs > DESATUALIZADO_MS;
  const hora = ultimaOk ? new Date(ultimaOk).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;

  useEffect(() => {
    if (!tv) return;
    const ajustar = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const retrato = h > w;
      setOrientTv(retrato ? "retrato" : w / h >= 2.2 ? "ultra" : "normal");
      const ref = retrato ? Math.min(w / 1080, h / 1920) : Math.min(w / 1920, h / 1080);
      setEscalaTv(Math.max(0.5, Math.min(1.5, ref)));
    };
    ajustar(); window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, [tv]);

  // Ajuste fino: se, já escalado, o conteúdo ainda for mais alto que a área útil (100dvh), reduz a escala em passos de 4 % até caber
  // (piso 0,5). A base é recalculada a cada resize/orientação; aqui só encolhe, então converge sem laço.
  useEffect(() => {
    const el = secaoTv.current;
    if (!tv || !el) return;
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) setEscalaTv((e) => (e > 0.5 ? Math.max(0.5, Math.round(e * 96) / 100) : e));
  });

  // Relógio da TV (frescor, hora), proteção de tela e cursor.
  useEffect(() => { const id = setInterval(() => setAgoraMs(Date.now()), tv ? 15_000 : 60_000); return () => clearInterval(id); }, [tv]);
  useEffect(() => {
    if (!tv) { setDeslocamento(0); setCursorOculto(false); return; }
    const desloca = setInterval(() => setDeslocamento((d) => (d + 1) % 3), cicloTv > 0 ? cicloTv * 1000 : DESLOCAR_TELA_MS);
    let t: ReturnType<typeof setTimeout> | undefined;
    const mexeu = () => { setCursorOculto(false); clearTimeout(t); t = setTimeout(() => setCursorOculto(true), CURSOR_MS); };
    mexeu(); window.addEventListener("mousemove", mexeu); window.addEventListener("keydown", mexeu);
    return () => { clearInterval(desloca); clearTimeout(t); window.removeEventListener("mousemove", mexeu); window.removeEventListener("keydown", mexeu); };
  }, [tv, cicloTv]);

  // Tempo real: evento de OM -> relê (debounce 5 s). Sem SSE: polling de 60 s.
  const sseOk = useRef(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const agendar = () => { clearTimeout(t); t = setTimeout(() => setNonce((n) => n + 1), DEBOUNCE_SSE_MS); };
    const parar = conectarEventos(() => agendar(), (s) => { sseOk.current = s === "conectado"; });
    const poll = setInterval(() => { if (!sseOk.current) setNonce((n) => n + 1); }, POLL_SEM_SSE_MS);
    return () => { parar(); clearTimeout(t); clearInterval(poll); };
  }, []);

  const releitura = useCallback(() => setNonce((n) => n + 1), []);

  // Modo TV: tela cheia real (Esc do navegador sai) + fallback de teclado; suspende o timer de inatividade do painel.
  const entrarTv = () => { setTv(true); onModoTv?.(true); document.documentElement.requestFullscreen?.().catch(() => undefined); };
  const sairTv = useCallback(() => {
    setTv(false); onModoTv?.(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    requestAnimationFrame(() => botaoTv.current?.focus());
  }, [onModoTv]);
  useEffect(() => { if (tv) onModoTv?.(true); }, [tv, onModoTv]); // ?tv=1 já abre em TV (sem gesto, não há tela cheia)
  useEffect(() => {
    if (!tv) return;
    const tecla = (ev: globalThis.KeyboardEvent) => { if (ev.key === "Escape") sairTv(); };
    const tela = () => { if (!document.fullscreenElement) sairTv(); };
    window.addEventListener("keydown", tecla); document.addEventListener("fullscreenchange", tela);
    return () => { window.removeEventListener("keydown", tecla); document.removeEventListener("fullscreenchange", tela); };
  }, [tv, sairTv]);
  useEffect(() => () => { onModoTv?.(false); }, [onModoTv]);

  const tipoTxt = filtro.tipo === "CORRETIVA" ? "corretivas" : filtro.tipo === "PREVENTIVA" ? "preventivas" : "preditivas";
  // Uma linha de resumo quando a caixa está recolhida e as metas já foram lidas alguma vez.
  const g = meta.dados?.configurada ? meta.dados.geral : null;
  const resumoMetas = g && g.pct !== null && g.pct !== undefined ? `Atendimento na meta (MTTA): ${Math.round(g.pct)} % (${g.dentroDaMeta} de ${g.total} OMs)` : undefined;
  // Dentro da CaixaMetas (dados avançados): TUDO de MTTA/MTTR: valores diretos, velocímetros vs meta (zonas, % da meta, tabela por prioridade,
  // atalho para Parâmetros) e MTTR por quebra. Fora da caixa ficam só números simples.
  const medidores = (t: boolean) => (
    <div className="flex flex-col gap-3">
    <div className={`grid gap-3 ${t ? "grid-cols-4" : "md:grid-cols-2 2xl:grid-cols-4"}`}>
      <CardMttrDireto kpis={kpis.dados} estado={kpis.estado} onTentar={kpis.recarregar} tv={t} />
      <CardMttaDireto kpis={kpis.dados} estado={kpis.estado} onTentar={kpis.recarregar} tv={t} />
      <CardMtta meta={meta.dados} estado={meta.estado} onTentar={meta.recarregar} onIrParametros={onIrParametros} tv={t} />
      <CardMttr kpis={kpis.dados} meta={meta.dados} estado={kpis.estado} onTentar={meta.recarregar} onIrParametros={onIrParametros} tv={t} />
    </div>
    {!t && <div className="grade-painel grid gap-5 xl:grid-cols-12"><MttrPor dados={fluxo.dados} estado={fluxo.estado} onTentar={fluxo.recarregar} /></div>}
    </div>
  );
  const cartoes = (t: boolean) => (
    <>
      <CardConcluidas kpis={kpis.dados} estado={kpis.estado} onTentar={kpis.recarregar} tv={t} />
      <CardBacklog backlog={backlog.dados} estado={backlog.estado} onTentar={backlog.recarregar} tv={t} />
      <CardPausas pausas={pausas.dados} estado={pausas.estado} onTentar={pausas.recarregar} tv={t} />
      <CardCategorias fluxo={fluxo.dados} totalConcluidas={kpis.dados?.kpis.concluidas.valor ?? null} estado={fluxo.estado} onTentar={fluxo.recarregar} tv={t} />
      <CardAprovadas kpis={kpis.dados} estado={kpis.estado} onTentar={kpis.recarregar} tv={t} />
      <CardTempoParada kpis={kpis.dados} estado={kpis.estado} onTentar={kpis.recarregar} tv={t} />
    </>
  );

  // ======================= MODO TV (1920×1080, sem rolagem, sem interação) =======================
  if (tv) {
    return (
      <section ref={secaoTv} aria-label="Painel TV: desempenho da equipe" data-tv="1" data-vis="tv" data-tv-orient={orientTv} style={{ transform: `translate(${deslocamento}px, ${deslocamento}px)`, ...(escalaTv !== 1 ? { zoom: escalaTv } : {}) }}
        className={`fixed inset-0 z-50 flex flex-col gap-3 overflow-hidden bg-ink p-3 ${cursorOculto ? "tv-sem-cursor" : ""}`}>
        {desatualizado && (
          <div role="alert" className="flex items-center gap-3 rounded-xl bg-warn-soft px-5 py-0 text-[26px] font-bold text-warn-soft-fg ring-2 ring-warn-fg">
            <Icone nome="alerta" className="h-7 w-7 shrink-0" />Dados desatualizados há {Math.max(2, Math.round(atrasoMs / 60_000))} min
          </div>
        )}
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-[32px] font-extrabold leading-tight">Apex Industrial · Manutenção · Desempenho da equipe <span className="text-[24px] font-normal text-muted">Últimos 7 dias</span></h1>
          <div className="flex items-center gap-4 text-[24px]">
            <span role="status" className="inline-flex items-center gap-2 text-muted"><span aria-hidden className={`h-3 w-3 rounded-full ${desatualizado ? "bg-viz-4" : "bg-viz-3"}`} />{desatualizado ? "sem atualização" : "ao vivo"} · {hora ?? "…"}</span>
            <button autoFocus onClick={sairTv} className={`min-h-12 rounded-lg bg-panel px-4 text-[22px] font-semibold ring-2 ring-line transition-opacity ${cursorOculto ? "opacity-0" : "opacity-100"}`}>Sair (Esc)</button>
          </div>
        </header>
        {!desatualizado && <ResumoPeriodo kpis={kpis.dados} meta={null} dias={7} tv />}
        {orientTv === "retrato" ? (
          // 9:16: coluna única (atenção no topo, cartões 2×3, metas), sem encolher o layout de paisagem.
          <div style={desatualizado ? { filter: "saturate(0.6)" } : undefined} className="grid min-h-0 grow grid-cols-2 content-start gap-3">
            <div className="col-span-2 flex max-h-[22%] min-h-0"><PainelAtencao itens={itensAtencao} mais={maisAtencao} estado={atencao.estado} cheio hora={hora} /></div>
            {cartoes(true)}
            <div className="col-span-2"><CaixaMetas id="metas-tv" aberta forcada tv onAlternar={() => undefined} resumo={resumoMetas}>{medidores(true)}</CaixaMetas></div>
          </div>
        ) : (
          // Paisagem: 3 colunas + painel lateral; ultrawide 21:9: os 6 cartões numa linha (6 colunas + painel).
          <div style={{ ...(desatualizado ? { filter: "saturate(0.6)" } : {}), gridTemplateColumns: `repeat(${orientTv === "ultra" ? 6 : 3}, minmax(0, 1fr)) 17.5rem` }} className="grid min-h-0 grow gap-3">
            {cartoes(true)}
            <div style={{ gridColumn: `1 / span ${orientTv === "ultra" ? 6 : 3}` }}><CaixaMetas id="metas-tv" aberta forcada tv onAlternar={() => undefined} resumo={resumoMetas}>{medidores(true)}</CaixaMetas></div>
            <div style={{ gridColumn: orientTv === "ultra" ? 7 : 4, gridRow: orientTv === "ultra" ? "1 / span 2" : "1 / span 3" }} className="flex min-h-0"><PainelAtencao itens={itensAtencao} mais={maisAtencao} estado={atencao.estado} cheio hora={hora} /></div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Dashboard de desempenho da equipe" className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div>
          <h1 className="text-2xl font-extrabold">Dashboard · Desempenho da equipe</h1>
          <p className="sr-only">OMs {tipoTxt} concluídas e aprovadas no período. Foco no processo e no fluxo de trabalho, sem ranking de pessoas.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {pendentes > 0 && (
            <button onClick={onIrAprovacoes} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-warn-soft px-4 font-semibold text-warn-soft-fg ring-2 ring-warn-fg">
              <Icone nome="alerta" className="h-4 w-4" />{pendentes} aguardando aprovação →
            </button>
          )}
          <span role="status" className="inline-flex items-center gap-1.5 text-muted"><span aria-hidden className="h-2 w-2 rounded-full bg-viz-3" />Atualizado {hora ?? "…"}</span>
          <button onClick={releitura} aria-label="Atualizar agora" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-panel px-3 font-semibold ring-2 ring-line hover:bg-brand-50"><Icone nome="atualizar" className="h-4 w-4" />Atualizar</button>
          <button ref={botaoTv} onClick={entrarTv} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-panel px-3 font-semibold ring-2 ring-line hover:bg-brand-50"><span aria-hidden>⛶</span>Modo TV</button>
        </div>
      </header>

      <FiltrosDesempenho filtro={filtroUsuario} onChange={setFiltro} />

      {/* Camada 1 (topo): resumo do período e 6 cartões simples. */}
      <ResumoPeriodo kpis={kpis.dados} meta={null} dias={dias} />
      <div data-grade="executiva" className="grid gap-3 lg:grid-cols-3">{cartoes(false)}</div>

      {/* Camada 2 (meio): MTTA e MTTR, valores diretos, metas e zonas. */}
      <CaixaMetas id="metas-executivo" aberta={metasAberta} onAlternar={setMetasAberta} resumo={resumoMetas}>{medidores(false)}</CaixaMetas>

      {/* Camada 3 (base): detalhe operacional. */}
      <h2 className="mt-2 text-lg font-extrabold">Detalhe operacional <span className="text-sm font-normal text-muted">fluxo no tempo · equipe agora · backlog por idade · ofensores · pausas</span></h2>
      <div id="detalhe-operacional" className="grade-painel grid gap-5 xl:grid-cols-12">
        <BlocoVolumeOms dados={fluxo.dados} estado={fluxo.estado} onTentar={fluxo.recarregar} />
        <BlocoMttrEvolucao dados={fluxo.dados} estado={fluxo.estado} onTentar={fluxo.recarregar} comparando={filtroUsuario.comp} metaMttrSegundos={meta.dados?.metaMttrSegundos ?? null} />
        <EquipeAgora dados={equipe.dados} estado={equipe.estado} onTentar={equipe.recarregar} />
        <BacklogBloco dados={backlog.dados} estado={backlog.estado} onTentar={backlog.recarregar} />
        <Ofensores dados={ofensores.dados?.itens ?? null} estado={ofensores.estado} onTentar={ofensores.recarregar} />
        <PausasMotivo dados={pausas.dados} estado={pausas.estado} onTentar={pausas.recarregar} />
      </div>
    </section>
  );
}
