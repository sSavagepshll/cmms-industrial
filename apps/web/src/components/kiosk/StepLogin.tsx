"use client";
import { useState } from "react";
import { ApiError, autenticarPin } from "@/lib/api";
import type { Operador } from "@/lib/types";
import { useInactivity } from "@/hooks/useInactivity";
import { LOGIN_TIMEOUT_MS } from "@/lib/constants";
import { NumericKeypad } from "./NumericKeypad";
import { Icone } from "../ui/Icones";
import { Screen } from "./ui";
import { Botao } from "../ui/Botao";

type Campo = "matricula" | "pin";

export function StepLogin({ onSuccess, onTimeout, onVoltar, totem = false, modo = "totem" }: {
  onSuccess: (u: Operador) => void; onTimeout: () => void; onVoltar?: () => void;
  /** true só no totem (rota /): login com Device ID e sessão curta. Kanban (/tecnico) e painel usam sessão PADRAO. */
  totem?: boolean;
  /** Apresentação e portal: "tecnico" mostra o banner de acesso exclusivo e declara `portal: TECNICO` na API. */
  modo?: "totem" | "tecnico";
}) {
  const tecnico = modo === "tecnico";
  const [matricula, setMatricula] = useState("");
  const [pin, setPin] = useState("");
  const [campo, setCampo] = useState<Campo>("matricula");
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useInactivity(true, LOGIN_TIMEOUT_MS, 0, onTimeout); // US-01 Cenário 4

  async function login(fn: () => Promise<Operador>) {
    setBusy(true);
    try {
      onSuccess(await fn());
    } catch (e) {
      setErro(mensagem(e)); // Cenário 3: alerta, limpa o PIN e mantém foco no teclado
      setPin("");
      if (e instanceof ApiError && e.code?.startsWith("PERFIL_NAO_PERMITIDO")) { setMatricula(""); setCampo("matricula"); } // política: recomeça pela matrícula
      else setCampo("pin");
      navigator.vibrate?.(200);
      beep();
    } finally {
      setBusy(false);
    }
  }

  const press = (d: string) => {
    setErro(null);
    if (campo === "matricula") setMatricula((m) => (m.length < 12 ? m + d : m));
    else setPin((p) => (p.length < 6 ? p + d : p));
  };
  const back = () => (campo === "matricula" ? setMatricula((m) => m.slice(0, -1)) : setPin((p) => p.slice(0, -1)));
  const clear = () => (campo === "matricula" ? setMatricula("") : setPin(""));

  const pronto = matricula.length > 0 && pin.length >= 4;
  const avancar = () => {
    // Mesmas condições do botão: o Enter físico não pode pular a validação.
    if (busy) return;
    if (campo === "matricula") { if (matricula) setCampo("pin"); }
    else if (pronto) void login(() => autenticarPin(matricula, pin, totem, tecnico ? "TECNICO" : undefined));
  };

  const box = (c: Campo) =>
    `flex min-h-14 w-full items-center justify-between rounded-2xl bg-panel px-4 text-2xl font-bold ring-4 md:min-h-16 md:px-5 md:text-3xl ${
      erro && c === "pin" ? "ring-red-500" : campo === c ? "ring-primary-fg" : "ring-line"
    }`;

  return (
    <Screen title={tecnico ? "Identificação do Técnico" : "Identifique-se"}
      subtitle={tecnico ? "Informe sua matrícula e PIN para acessar a central de atendimento" : "Informe sua matrícula e seu PIN (4 a 6 dígitos)"} onBack={onVoltar} passo={tecnico ? undefined : 1} passoCompacto>
      {tecnico && (
        <p role="note" className="flex items-center justify-center gap-3 rounded-2xl bg-amber-500 p-3 text-center text-xl font-extrabold text-black md:text-2xl">
          <Icone nome="ferramenta" className="h-7 w-7 shrink-0" />ACESSO EXCLUSIVO — MANUTENÇÃO TÉCNICA
        </p>
      )}
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 short:max-w-3xl short:flex-row short:items-start short:justify-center short:gap-8">
        <div className="flex flex-1 flex-col gap-3">
          <button className={box("matricula")} onFocus={() => setCampo("matricula")} onClick={() => setCampo("matricula")} aria-label="Campo matrícula" aria-pressed={campo === "matricula"}>
            <span className="text-xl font-normal text-muted">Matrícula</span>
            <span className="tracking-widest">{matricula}</span>
          </button>
          <button className={box("pin")} onFocus={() => setCampo("pin")} onClick={() => setCampo("pin")} aria-label="Campo PIN" aria-pressed={campo === "pin"}>
            <span className="text-xl font-normal text-muted">PIN</span>
            <span className="tracking-[0.4em]">{"●".repeat(pin.length)}</span>
          </button>
          {erro && (
            <p role="alert" className="rounded-xl bg-red-700 text-white p-2.5 text-center text-xl font-semibold">{erro}</p>
          )}
          <Botao tamanho="totem" variante={campo === "pin" ? "sucesso" : "primario"} disabled={busy || (campo === "matricula" ? !matricula : !pronto)} onClick={avancar}>
            {busy ? "Verificando…" : campo === "matricula" ? "Próximo" : "Entrar"}
          </Botao>
          {onVoltar && <Botao tamanho="toque" disabled={busy} onClick={onVoltar}>{tecnico ? "← Voltar ao Totem" : "← Voltar ao início"}</Botao>}
        </div>
        <div className="w-full shrink-0 short:max-w-sm">
          <NumericKeypad disabled={busy} onDigit={press} onBackspace={back} onClear={clear} onEnter={avancar} />
        </div>
      </div>
    </Screen>
  );
}

function mensagem(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0 || e.status >= 500) return "Sistema indisponível. Chame o líder da área.";
    return e.message; // 401: "Matrícula ou PIN incorreto..." | 429: bloqueio temporário
  }
  return "Erro inesperado. Tente novamente.";
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 220;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.18);
  } catch { /* sem áudio */ }
}
