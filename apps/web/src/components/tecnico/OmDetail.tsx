"use client";
import { useEffect, useState } from "react";
import { ApiError, assumirOm, cancelarDelegacao, concluirOm, pausarOm, playOm } from "@/lib/api";
import { PRIORIDADE, formatarDuracao } from "@/lib/kanban";
import { segundosDe, tempoServidor } from "@/hooks/useTempoOm";
import { concluiOm, ehGestor, type ConclusaoOm, type MotivoPausa, type OmKanban, type Operador } from "@/lib/types";
import { CUSTOS, rotuloTipo, setorDaOm } from "@/lib/rotulos";
import { btnBase, btnPrimary } from "../kiosk/ui";
import { AtribuirTecnico } from "../despacho/AtribuirTecnico";
import { AvisoDesfazer } from "../despacho/AvisoDesfazer";
import { BarraAcoes } from "../ui/BarraAcoes";
import { ConfirmarAcao } from "../ui/ConfirmarAcao";
import { Icone, type NomeIcone } from "../ui/Icones";
import { PedirPin } from "../ui/PedirPin";
import { SeloAtribuicao } from "../ui/Selos";
import { RecusarDialog } from "./RecusarDialog";
import { ConcludeForm } from "./ConcludeForm";
import { AprovacaoDaOm } from "../aprovacao/AprovacaoDaOm";
import { FichaOm } from "./FichaOm";
import { MateriaisTab } from "./MateriaisTab";
import { NotesPanel } from "./NotesPanel";
import { PauseModal } from "./PauseModal";
import { TempoTab } from "./TempoTab";
import { TestesTab } from "./TestesTab";

/** Cronômetro local: base (s, vindo do servidor) + tempo desde `since`. O servidor é a fonte da verdade (RN-08). */
interface Tempo { base: number; since: number | null }

type Aba = "resumo" | "ficha" | "tempo" | "materiais" | "testes" | "notas";
const ABAS: { key: Aba; label: string; icone?: NomeIcone }[] = [
  { key: "resumo", label: "Resumo" },
  { key: "ficha", label: "Ficha", icone: "prancheta" },
  { key: "tempo", label: "Tempo", icone: "relogio" },
  { key: "materiais", label: "Materiais", icone: "ferramenta" },
  { key: "testes", label: "Testes", icone: "checkCirculo" },
  { key: "notas", label: "Notas", icone: "editar" },
];

/**
 * Detalhe da OM (Kanban). As AÇÕES (assumir/recusar/atribuir; play/pause/finalizar) ficam numa BARRA FIXA no rodapé,
 * visível em qualquer aba (docs/ux/fase17-tema-escuro.md §10, K1): antes ficavam abaixo da dobra em 1440x900.
 * Cronômetro e avisos continuam em `controles` (aba Resumo e aba Tempo).
 */
export function OmDetail({ om, user, podeAgir, onClose, onChanged }: {
  om: OmKanban; user: Operador; podeAgir: boolean; onClose: () => void; onChanged: () => Promise<void> | void;
}) {
  const [aba, setAba] = useState<Aba>("resumo");
  const [tempoLocal, setTempo] = useState<Tempo | null>(null);
  // null = desconhecido (OM aberta por outra sessão): mostra Play e Pause; a API desempata com 409.
  const [rodandoLocal, setRodando] = useState<boolean | null>(om.statusKanban === "PAUSADO" ? false : null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pausando, setPausando] = useState(false);
  const [concluindo, setConcluindo] = useState(false);
  const [notasKey, setNotasKey] = useState(0);
  const [pedindoPin, setPedindoPin] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [atribuindo, setAtribuindo] = useState(false);
  const [cancelandoReserva, setCancelandoReserva] = useState(false);
  const [erroReserva, setErroReserva] = useState<string | null>(null);
  const [avisoDesfazer, setAvisoDesfazer] = useState<string | null>(null);
  const [, tick] = useState(0);

  // Fonte da verdade: campos do servidor (fila + SSE). Fallback: estado local das respostas de play/pause.
  const srv = tempoServidor(om);
  const tempo: Tempo | null = srv ?? tempoLocal;
  const rodando: boolean | null = srv ? srv.rodando : rodandoLocal;

  useEffect(() => {
    if (!tempo?.since) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [tempo?.since]);

  const p = PRIORIDADE[om.prioridade];
  const souResponsavel = om.responsavel?.id === user.id;
  const admin = user.perfil === "ADMIN";
  const encerrada = om.statusKanban === "CONCLUIDO";
  const aguardando = om.statusKanban === "AGUARDANDO_APROVACAO"; // finalizada pelo técnico; só quem pode decide
  const aguardandoBaixa = om.statusKanban === "AGUARDANDO_BAIXA"; // aprovada pela produção; o gestor conclui (Painel Admin)
  const operador = podeAgir && (souResponsavel || admin) && !encerrada && !aguardando && !aguardandoBaixa; // RN-07: só o responsável (ou ADMIN) lança
  const segundos = tempo ? segundosDe(tempo) : null;

  async function acao(fn: () => Promise<void>) {
    setBusy(true); setErro(null);
    try { await fn(); await onChanged(); setNotasKey((k) => k + 1); }
    catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "CRONOMETRO_JA_ATIVO" && (e.body as { mesmaOrdem?: boolean })?.mesmaOrdem) setRodando(true);
        if (e.code === "SEM_CRONOMETRO_ATIVO") setRodando(false);
        setErro(e.status === 0 ? "Sem conexão com o servidor." : e.message);
        await onChanged(); // estado pode ter mudado (ex.: outro técnico assumiu)
      } else setErro("Erro inesperado.");
    } finally { setBusy(false); }
  }

  // Assumir (puxar ou aceitar a reserva) exige o PIN. Erro de PIN fica no diálogo; qualquer outra falha
  // (ex.: outro técnico assumiu antes) atualiza a fila, e a mensagem da API aparece no diálogo.
  async function assumirComPin(pin: string) {
    try { await assumirOm(om.id, pin); }
    catch (e) {
      if (!(e instanceof ApiError && (e.code === "PIN_INVALIDO" || e.status === 429))) void onChanged();
      throw e;
    }
    setPedindoPin(false); setRodando(false); await onChanged(); setNotasKey((k) => k + 1);
  }
  async function cancelarReserva() {
    setBusy(true); setErroReserva(null);
    try { await cancelarDelegacao(om.id); setCancelandoReserva(false); await onChanged(); }
    catch (e) { setErroReserva(e instanceof ApiError ? (e.code === "OM_NAO_DISPONIVEL" ? "O técnico já aceitou a OM: não dá mais para cancelar a reserva." : e.message) : "Erro inesperado."); void onChanged(); }
    finally { setBusy(false); }
  }
  const play = () => acao(async () => {
    const r = await playOm(om.id);
    setTempo({ base: r.tempoLiquidoSegundos, since: Date.now() }); setRodando(true);
  });
  const pausar = (m: MotivoPausa, d?: string) => acao(async () => {
    const r = await pausarOm(om.id, m, d);
    setTempo({ base: r.tempoLiquidoSegundos, since: null }); setRodando(false); setPausando(false);
  });
  const concluir = (c: ConclusaoOm) => acao(async () => { await concluirOm(om.id, c); setConcluindo(false); onClose(); });
  const recarregar = () => { setNotasKey((k) => k + 1); void onChanged(); };

  const linhas: [string, string][] = [
    om.itemDescricao ? ["Identificação do equipamento", om.itemDescricao] : [om.equipamento.predial ? "Ativo" : "Máquina", `${om.equipamento.codigo} · ${om.equipamento.nome}`],
    ...(om.itemDescricao ? [] : om.equipamento.predial
      ? (om.localDescricao ? [["Local", om.localDescricao] as [string, string]] : [])
      : [["Setor", `${setorDaOm(om)}${om.equipamento.localizacao ? ` · ${om.equipamento.localizacao}` : ""}`] as [string, string]]),
    ...(om.tipoAtivo ? [["Tipo", rotuloTipo(om.tipoAtivo, om.tipoAtivoOutro, om.tipoAtivoRotulo)] as [string, string]] : []),
    ["Custo", om.custoTipo ? CUSTOS.find((c) => c.key === om.custoTipo)?.label ?? om.custoTipo : encerrada ? "—" : "A definir"] as [string, string],
    ...(om.centroCusto ? [["Centro de custo", om.centroCusto] as [string, string]] : []),
    ...(om.aprovadoPor ? [["Aprovado por", `${om.aprovadoPor.nome}${om.dataAprovacao ? ` · ${new Date(om.dataAprovacao).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}`] as [string, string]] : []),
    ...(encerrada ? [["Concluído por", om.concluidoPor ? `${om.concluidoPor.nome}${om.concluidoEm ? ` · ${new Date(om.concluidoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}` : "—"] as [string, string]] : []),
    ["Solicitante", `${om.solicitante.nome}${om.totemIdOrigem ? ` (${om.totemIdOrigem})` : ""}`],
    ["Aberta em", new Date(om.dataAbertura).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })],
    ["Responsável", om.responsavel?.nome ?? "—"],
  ];

  const gestor = ehGestor(user.perfil);
  const reservada = om.situacaoAtribuicao === "RESERVADA";
  const podeAssumirOm = om.podeAssumir ?? podeAgir; // sem a flag (API antiga), mantém o comportamento anterior
  const ativa = !encerrada && !aguardando && !aguardandoBaixa;
  const aberta = om.statusKanban === "ABERTO";
  const executa = podeAgir && (souResponsavel || admin); // quem opera o cronômetro (RN-07)

  // ----- ações da barra fixa -----
  const acoesAberta = ativa && aberta && podeAgir && (podeAssumirOm || !!om.podeRecusar || gestor);
  const acoesExecucao = ativa && !aberta && executa;
  const barra = acoesAberta ? (
    <div className="flex flex-col gap-3">
      {gestor && (
        // gestão (Atribuir/Reatribuir/Cancelar reserva): compacta, acima do par principal, sem espremê-lo
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => setAtribuindo(true)} className="min-h-14 rounded-xl bg-panel px-5 text-lg font-bold ring-2 ring-primary-fg">{reservada ? "Reatribuir técnico" : "Atribuir técnico"}</button>
          {reservada && <button disabled={busy} onClick={() => { setErroReserva(null); setCancelandoReserva(true); }} className="min-h-14 rounded-xl bg-panel px-5 text-lg font-bold text-danger-fg ring-2 ring-danger-fg">Cancelar reserva</button>}
        </div>
      )}
      {(podeAssumirOm || om.podeRecusar) && (
        // RECUSAR (secundário, ≥ 80 px) à esquerda, isolado ≥ 24 px de ASSUMIR (primário, ≥ 96 px) à direita: Fase 9.
        // gap-8: o ring-4 de RECUSAR come 4 px do espaço visível, então 32 px de gap deixam 28 px (≥ 24).
        <div className="flex items-stretch gap-8">
          {om.podeRecusar && <button disabled={busy} onClick={() => setRecusando(true)} className={`${btnBase} ${podeAssumirOm ? "w-1/3" : "w-full"} bg-panel text-danger-fg ring-4 ring-danger-fg`}>RECUSAR</button>}
          {podeAssumirOm && <button disabled={busy} onClick={() => setPedindoPin(true)} className={`${btnPrimary} flex-1 bg-brand-700 text-white`}>ASSUMIR</button>}
        </div>
      )}
    </div>
  ) : acoesExecucao ? (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
      {rodando !== true && <button disabled={busy} onClick={play} className={`${btnPrimary} bg-green-700 text-white`}>{rodando === false && om.statusKanban === "PAUSADO" ? "RETOMAR" : "PLAY"}</button>}
      {rodando !== false && <button disabled={busy} onClick={() => setPausando(true)} className={`${btnPrimary} bg-amber-500 text-black`}>PAUSE</button>}
      <button disabled={busy} onClick={() => setConcluindo(true)} className={`${btnPrimary} bg-strong text-strong-on dark:ring-2 dark:ring-primary-edge`}>FINALIZAR</button>
    </div>
  ) : null;

  // Cronômetro + avisos: aparecem no Resumo e na aba Tempo (as ações estão na barra fixa).
  const controles = (
    <div className="flex flex-col gap-4">
      {(segundos !== null || rodando !== null) && !encerrada && !aguardando && !aguardandoBaixa && !aberta && (
        <div className={`rounded-2xl p-4 text-center ${rodando ? "bg-green-50 ring-2 ring-green-600" : "bg-panel ring-1 ring-line"}`}>
          <p className="inline-flex items-center gap-2 text-lg text-muted"><Icone nome="relogio" className="h-5 w-5" />{rodando ? "Cronômetro em andamento" : "Cronômetro parado"}</p>
          {segundos !== null && <p className="font-mono text-5xl font-extrabold md:text-6xl" role="timer" aria-label="Tempo líquido de atendimento">{formatarDuracao(segundos)}</p>}
        </div>
      )}
      {erro && <p role="alert" className="rounded-xl bg-red-700 text-white p-3 text-xl font-semibold">{erro}</p>}

      {aguardandoBaixa && (
        <p role="status" className="flex items-start gap-2 rounded-2xl bg-violet-50 p-4 text-xl font-bold text-violet-900 ring-2 ring-violet-300">
          <Icone nome="relogio" className="mt-1 h-6 w-6" />
          <span>Aprovada{om.aprovadoPor ? ` por ${om.aprovadoPor.nome}` : ""}: aguardando conclusão pelo gestor. {concluiOm(user.perfil) ? "Use Conclusões pendentes no Painel Administrativo." : "Sem ações nesta etapa."}</span>
        </p>
      )}
      {aguardando && <AprovacaoDaOm omId={om.id} user={user} onDecidida={() => { void onChanged(); onClose(); }} />}
      {!!om.motivoReprovacao && !aguardando && !encerrada && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-red-50 p-4 text-xl font-semibold text-red-900 ring-2 ring-danger-fg"><Icone nome="alerta" className="mt-1 h-6 w-6" /><span>Reprovada pelo supervisor: {om.motivoReprovacao}</span></p>
      )}
      {ativa && aberta && <SeloAtribuicao om={om} userId={user.id} gestor={gestor} grande />}
      {ativa && aberta && podeAgir && !podeAssumirOm && !om.podeRecusar && !gestor && !om.situacaoAtribuicao && (
        <p className="rounded-xl bg-panel p-4 text-xl text-amber-800">Você não pode assumir esta OM.</p>
      )}
      {ativa && !aberta && !executa && (
        podeAgir
          ? <p className="rounded-xl bg-panel p-4 text-xl text-amber-800">Esta OM está com {om.responsavel?.nome ?? "outro técnico"}. Apenas o responsável pode operar o cronômetro, lançar tempo/materiais e concluir.</p>
          : <p className="rounded-xl bg-panel p-4 text-xl text-amber-800">Somente leitura para o seu perfil.</p>
      )}
      {ativa && aberta && !podeAgir && <p className="rounded-xl bg-panel p-4 text-xl text-amber-800">Somente leitura para o seu perfil.</p>}
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label={`OM ${om.numero}`} className="fixed inset-0 z-40 overflow-y-auto bg-ink">
      {/* min-h-dvh + barra mt-auto: com pouco conteúdo a barra fica no rodapé; com muito, fica fixa (sticky) sobre a rolagem */}
      <div className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-4 p-3 md:gap-5 md:p-4">
        <header className="flex items-center gap-3">
          <button onClick={onClose} aria-label="Voltar" className="min-h-14 min-w-14 rounded-2xl bg-panel text-3xl font-bold ring-1 ring-line md:min-h-tap-md md:min-w-tap-md md:text-4xl">←</button>
          <h1 className="min-w-0 flex-1 whitespace-nowrap text-2xl font-extrabold tabular-nums md:text-3xl">{om.numero}</h1>
          <span className={`rounded-full px-3 py-2 text-lg font-extrabold md:px-4 md:text-xl ${p.cls}`}>{p.label}</span>
        </header>
        {avisoDesfazer && <AvisoDesfazer omId={om.id} mensagem={avisoDesfazer} onFechar={() => setAvisoDesfazer(null)} onDesfeito={() => { setAvisoDesfazer(null); void onChanged(); }} />}

        <div role="tablist" aria-label="Seções da OM" className="sticky top-0 z-10 -mx-3 flex gap-2 overflow-x-auto bg-ink px-3 py-2 md:mx-0 md:gap-3 md:px-0">
          {ABAS.map((a) => (
            <button key={a.key} role="tab" aria-selected={aba === a.key} onClick={() => setAba(a.key)}
              className={`inline-flex min-h-14 shrink-0 items-center gap-2 rounded-xl px-4 text-lg font-bold md:min-h-tap-md md:px-6 md:text-2xl ${aba === a.key ? "bg-brand-700 text-white ring-2 ring-fg" : "bg-panel ring-1 ring-line"}`}>
              {a.icone && <Icone nome={a.icone} className="h-6 w-6" />}{a.label}
            </button>
          ))}
        </div>

        <div role="tabpanel">
          {aba === "resumo" && (
            <div className="flex flex-col gap-4 md:gap-5">
              <p className="text-xl font-semibold md:text-2xl">{om.sintomas.join(", ") || om.titulo}</p>
              {om.descricao && <p className="whitespace-pre-wrap rounded-xl bg-panel p-3 text-xl text-muted">{om.descricao}</p>}
              <dl className="divide-y divide-line dark:divide-line-soft rounded-2xl bg-panel ring-1 ring-line">
                {linhas.map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-1 p-3 text-lg sm:flex-row sm:gap-4 md:text-xl"><dt className="shrink-0 text-muted sm:w-36">{k}</dt><dd className="font-semibold">{v}</dd></div>
                ))}
              </dl>
              {controles}
            </div>
          )}
          {aba === "ficha" && <FichaOm om={om} key={notasKey} />}
          {aba === "tempo" && <TempoTab omId={om.id} controles={controles} podeLancar={operador} refreshKey={notasKey} onChanged={recarregar} />}
          {aba === "materiais" && <MateriaisTab omId={om.id} podeEditar={operador} refreshKey={notasKey} onChanged={recarregar} />}
          {aba === "testes" && <TestesTab />}
          {aba === "notas" && <NotesPanel omId={om.id} encerrada={encerrada} refreshKey={notasKey} />}
        </div>

        {/* Em abas que não exibem `controles` o erro de uma ação ainda precisa aparecer */}
        {erro && aba !== "resumo" && aba !== "tempo" && <p role="alert" className="rounded-xl bg-red-700 p-3 text-xl font-semibold text-white">{erro}</p>}
        {barra && <BarraAcoes margem="painel" rotulo="Ações da OM">{barra}</BarraAcoes>}
      </div>

      {pedindoPin && (
        <PedirPin modo="totem" titulo={reservada && om.reservadaPara?.id === user.id ? "Assumir a OM reservada" : "Assumir a OM"} rotuloConfirmar="Assumir" onCancelar={() => setPedindoPin(false)} onConfirmar={assumirComPin}>
          <p><strong className="tabular-nums">{om.numero}</strong> · {om.equipamento.codigo} · {om.itemDescricao ?? om.equipamento.nome}</p>
        </PedirPin>
      )}
      {recusando && <RecusarDialog om={om} onCancelar={() => setRecusando(false)} onRecusada={() => { setRecusando(false); void onChanged(); onClose(); }} />}
      {atribuindo && (
        <AtribuirTecnico grande om={{ id: om.id, numero: om.numero, prioridade: om.prioridade, equipamento: om.equipamento, reservadaPara: om.reservadaPara }}
          onFechar={() => setAtribuindo(false)} onAtualizar={() => void onChanged()}
          onAtribuido={(a) => { setAtribuindo(false); setAvisoDesfazer(`${om.numero} ${a.reatribuicao ? "reatribuída" : "reservada"} para ${a.tecnico.nome}.`); void onChanged(); }} />
      )}
      {cancelandoReserva && (
        <ConfirmarAcao titulo="Cancelar a reserva?" rotuloConfirmar="Cancelar reserva" busy={busy} erro={erroReserva} onCancelar={() => setCancelandoReserva(false)} onConfirmar={() => void cancelarReserva()}>
          <p>A OM <strong>{om.numero}</strong> deixa de estar reservada para <strong>{om.reservadaPara?.nome}</strong> e volta à fila para nova designação.</p>
        </ConfirmarAcao>
      )}
      {pausando && <PauseModal busy={busy} onConfirm={pausar} onCancel={() => setPausando(false)} />}
      {concluindo && <ConcludeForm busy={busy} onConfirm={concluir} onCancel={() => setConcluindo(false)} />}
    </div>
  );
}
