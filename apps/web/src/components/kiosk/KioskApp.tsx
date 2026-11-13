"use client";
import { useCallback, useEffect, useState } from "react";
import { criarOm, encerrarSessao } from "@/lib/api";
import { SESSAO_PIN_MS, getExpiraEmServidor, limitarSessao, setUnauthorizedHandler } from "@/lib/session";
import { IDLE_TIMEOUT_MS, IDLE_WARNING_MS, TOTEM_ID } from "@/lib/constants";
import { msgBloqueioTotem, podeNoTotem, type Equipamento, type OmAberta, type OmCriada, type Operador } from "@/lib/types";
import { useInactivity } from "@/hooks/useInactivity";
import { useTemaTotem } from "@/hooks/useTemaTotem";
import { StepIdle } from "./StepIdle";
import { StepLogin } from "./StepLogin";
import { StepEquipment } from "./StepEquipment";
import { StepNote } from "./StepNote";
import { StepDetalhes, type DetalhesFalha } from "./StepDetalhes";
import { StepItemLivre } from "./StepItemLivre";
import { StepReview } from "./StepReview";
import { StepSuccess } from "./StepSuccess";
import { StepSupervisor } from "./StepSupervisor";
import { StepAprovacoes } from "./StepAprovacoes";
import { Modal } from "./ui";
import { Botao } from "../ui/Botao";

type Step = "idle" | "login" | "supervisor" | "aprovacoes" | "equipment" | "item" | "note" | "detalhes" | "review" | "success";

interface Session {
  user?: Operador;
  equip?: Equipamento;
  existing?: OmAberta;
  duplicidadeConfirmada?: boolean;
  /** Fase 20: local da manutenção predial (setor "Outros"). */
  local?: string;
  /** Fase 31: descrição do item não cadastrado (grupo OUTROS). */
  itemDescricao?: string;
  detalhes?: DetalhesFalha;
  om?: OmCriada;
}

/**
 * Máquina de estados do fluxo Kiosk (US-01..US-04). Estado e token JWT vivem só em memória;
 * `reset` (auto-logout) descarta ambos.
 */
export function KioskApp() {
  const [step, setStep] = useState<Step>("idle");
  const [s, setS] = useState<Session>({});
  const [notice, setNotice] = useState<string>();
  const tema = useTemaTotem();
  // Só monta a árvore do totem no cliente: extensões do navegador (Dark Reader etc.) alteram o DOM antes da hidratação e o
  // desencontro com o HTML do servidor deixava a tela sem eventos. Sem HTML de servidor para comparar, não há o que desencontrar.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  const reset = useCallback((aviso?: string) => {
    encerrarSessao(); // limpa o JWT
    setS({});
    setNotice(aviso);
    setStep("idle");
  }, []);
  const resetSimples = useCallback(() => reset(), [reset]);

  // 401 em rota protegida (token expirou, ex.: JWT_EXPIRES_IN=5m): volta ao repouso
  useEffect(() => {
    setUnauthorizedHandler(() => reset("Sessão expirada. Identifique-se novamente."));
    return () => setUnauthorizedHandler(null);
  }, [reset]);

  // RN-05: 45s de inatividade nas telas intermediárias, aviso nos últimos 10s
  const guarded = step === "supervisor" || step === "aprovacoes" || step === "equipment" || step === "item" || step === "note" || step === "detalhes" || step === "review";
  const idle = useInactivity(guarded, IDLE_TIMEOUT_MS, IDLE_WARNING_MS, resetSimples);
  // Trocar de tela (inclusive avanço automático) recomeça a contagem: a tela nova nunca herda o tempo ocioso da anterior.
  const { reset: reiniciarOcioso } = idle;
  useEffect(() => { reiniciarOcioso(); }, [step, reiniciarOcioso]);

  // US-17: o Totem atende só OPERADOR, LIDER_PRODUCAO e ADMIN, sempre via menu (supervisor); técnico usa /tecnico.
  const destinoAposLogin = (user: Operador): Step | null => (podeNoTotem(user.perfil) ? "supervisor" : null);

  // Guard de render: perfil proibido nunca vê telas internas (estado inconsistente / HMR).
  const proibido = step !== "idle" && step !== "login" && !!s.user && !podeNoTotem(s.user.perfil);
  useEffect(() => { if (proibido && s.user) reset(msgBloqueioTotem(s.user.perfil)); }, [proibido, s.user, reset]);

  // Começar o atendimento: falha aqui nunca pode deixar o toque "mudo" (aviso na própria tela de repouso).
  function iniciar() {
    try { setNotice(undefined); setStep("login"); }
    catch { setNotice("Não foi possível iniciar. Toque novamente."); }
  }

  async function confirmar() {
    const { user, equip, detalhes, duplicidadeConfirmada } = s;
    if (!user || !equip || !detalhes) return;
    const om: OmCriada = await criarOm({
      equipamentoId: equip.id, // solicitante vem do token (RN-01)
      maquinaParada: detalhes.impacto === "PARADA",
      categoria: detalhes.categoria,
      sintomas: detalhes.sintomas,
      totemIdOrigem: TOTEM_ID,
      observacao: detalhes.observacao.trim() || undefined,
      confirmarDuplicidade: !!duplicidadeConfirmada,
      ...(equip.predial && s.local && { localDescricao: s.local }),
      ...(equip.itemLivre && s.itemDescricao && { itemDescricao: s.itemDescricao }),
      // US-15/16: sem tipoAtivo/custoTipo/centroCusto — o custo é definido só no encerramento.
    });
    encerrarSessao(); // OM aberta: o token não é mais necessário
    setS((p) => ({ ...p, om }));
    setStep("success");
  }

  if (!montado) return <div className="min-h-dvh bg-ink" suppressHydrationWarning />;

  return (
    <>
      {step === "idle" && (
        <StepIdle notice={notice} aoAlternarTema={tema.alternar} onStart={iniciar} />
      )}
      {step === "login" && (
        <StepLogin totem onTimeout={resetSimples} onVoltar={resetSimples}
          onSuccess={(user) => {
            const destino = destinoAposLogin(user);
            if (!destino) { reset(msgBloqueioTotem(user.perfil)); return; } // sem token, sem sessão: volta ao repouso com aviso
            setS({ user }); setStep(destino);
            // Trava de segurança (contrato-sessao-totem): a sessão de totem dura no máximo `expiraEmSegundos` (15 min) para QUALQUER perfil,
            // sem renovação. No vencimento o JWT é apagado da memória e a UI zerada (usuário, tela), voltando ao repouso.
            limitarSessao((getExpiraEmServidor() ?? SESSAO_PIN_MS / 1000) * 1000, () => reset("Sessão do totem encerrada (limite de 15 minutos). Identifique-se novamente."));
          }} />
      )}
      {step === "supervisor" && s.user && (
        <StepSupervisor user={s.user} onSair={resetSimples} onAprovar={() => setStep("aprovacoes")} onAbrirChamado={() => setStep("equipment")} />
      )}
      {step === "aprovacoes" && <StepAprovacoes onBack={() => setStep("supervisor")} onSair={resetSimples} />}
      {step === "equipment" && s.user && (
        <StepEquipment user={s.user} onBack={resetSimples}
          onSelect={(equip, dup, local) => { setS((p) => ({ ...p, equip, existing: undefined, duplicidadeConfirmada: dup, local, itemDescricao: undefined, detalhes: p.equip?.id === equip.id ? p.detalhes : undefined })); setStep("detalhes"); }}
          onItemLivre={(equipamentoId, g) => {
            // Pseudo-ativo do grupo OUTROS: o id vem da API; o texto digitado passa a ser o "nome" exibido nas telas seguintes.
            setS((p) => ({ ...p, equip: { id: equipamentoId, codigo: "Item não cadastrado", nome: "", setor: "", localizacao: null, omsAtivas: 0, itemLivre: true, grupo: g.codigo }, existing: undefined, local: undefined }));
            setStep("item");
          }}
          onComplement={(equip, existing) => { setS((p) => ({ ...p, equip, existing })); setStep("note"); }} />
      )}
      {step === "item" && s.equip && (
        <StepItemLivre equip={s.equip} initial={s.itemDescricao} onBack={() => setStep("equipment")}
          onNext={(item, dup) => { setS((p) => ({ ...p, itemDescricao: item, duplicidadeConfirmada: dup, equip: p.equip && { ...p.equip, nome: item }, detalhes: p.itemDescricao === item ? p.detalhes : undefined })); setStep("detalhes"); }}
          onComplement={(item, existing) => { setS((p) => ({ ...p, itemDescricao: item, equip: p.equip && { ...p.equip, nome: item }, existing })); setStep("note"); }} />
      )}
      {step === "note" && s.equip && s.existing && (
        <StepNote equip={s.equip} om={s.existing} onDone={resetSimples} onBack={() => setStep(s.equip?.itemLivre ? "item" : "equipment")} />
      )}
      {step === "detalhes" && s.equip && (
        <StepDetalhes equip={s.equip} initial={s.detalhes ?? {}} onBack={() => setStep(s.equip?.itemLivre ? "item" : "equipment")}
          onNext={(detalhes) => { setS((p) => ({ ...p, detalhes })); setStep("review"); }} />
      )}
      {step === "review" && s.user && s.equip && s.detalhes && (
        <StepReview user={s.user} equip={s.equip} c={s.detalhes} local={s.local} onConfirm={confirmar} onBack={() => setStep("detalhes")} />
      )}
      {step === "success" && s.om && s.equip && <StepSuccess om={s.om} equip={s.equip} local={s.local} onExit={resetSimples} />}

      {idle.warning && guarded && (
        <Modal label="Sessão prestes a expirar">
          <p className="text-3xl font-extrabold md:text-4xl">Você ainda está aí?</p>
          <p className="mt-3 text-2xl" role="timer">A sessão será cancelada em <strong className={idle.remaining <= 3 ? "text-danger-fg" : "text-warn-fg"}>{idle.remaining}s</strong></p>
          <Botao tamanho="totem" variante="sucesso" bloco className="mt-6" onClick={idle.reset}>Sim, continuar</Botao>
        </Modal>
      )}
    </>
  );
}
