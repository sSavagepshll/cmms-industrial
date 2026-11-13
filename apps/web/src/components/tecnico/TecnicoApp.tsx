"use client";
import { useCallback, useEffect, useState } from "react";
import { encerrarSessao } from "@/lib/api";
import { setUnauthorizedHandler } from "@/lib/session";
import { TECNICO_IDLE_MS, TECNICO_WARN_MS } from "@/lib/kanban";
import { MSG_PORTAL_TECNICO, podeNoPortalTecnico, type Operador } from "@/lib/types";
import { useInactivity } from "@/hooks/useInactivity";
import { StepLogin } from "../kiosk/StepLogin";
import { Modal } from "../kiosk/ui";
import { Botao } from "../ui/Botao";
import { Board } from "./Board";

/** Fluxo do técnico: login (matrícula + PIN, mesmo da API Kiosk) -> Kanban. Token só em memória. */
export function TecnicoApp() {
  const [user, setUser] = useState<Operador | null>(null);
  const [loginKey, setLoginKey] = useState(0);
  const [aviso, setAviso] = useState<string>();

  const sair = useCallback((msg?: string) => {
    encerrarSessao();
    setUser(null);
    setAviso(msg);
    setLoginKey((k) => k + 1);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => sair("Sessão expirada. Identifique-se novamente."));
    return () => setUnauthorizedHandler(null);
  }, [sair]);

  // Guard de render: perfil fora da política nunca monta o Kanban (estado inconsistente / HMR).
  const proibido = !!user && !podeNoPortalTecnico(user.perfil);
  useEffect(() => { if (proibido) sair(MSG_PORTAL_TECNICO); }, [proibido, sair]);

  const idle = useInactivity(!!user && !proibido, TECNICO_IDLE_MS, TECNICO_WARN_MS, () => sair("Sessão encerrada por inatividade."));

  if (!user || proibido) {
    return (
      <>
        {aviso && <p role="status" className="bg-amber-500 p-3 text-center text-xl font-semibold text-black">{aviso}</p>}
        <StepLogin key={loginKey} modo="tecnico" onTimeout={() => setLoginKey((k) => k + 1)} onVoltar={() => window.location.assign("/")} onSuccess={(u) => { if (!podeNoPortalTecnico(u.perfil)) { sair(MSG_PORTAL_TECNICO); return; } setAviso(undefined); setUser(u); }} />
      </>
    );
  }
  return (
    <>
      <Board user={user} onLogout={() => sair()} />
      {idle.warning && (
        <Modal label="Sessão prestes a expirar">
          <p className="text-4xl font-extrabold">Você ainda está aí?</p>
          <p className="mt-3 text-2xl" role="timer">Saindo em <strong className={idle.remaining <= 3 ? "text-danger-fg" : "text-warn-fg"}>{idle.remaining}s</strong>. Cronômetros em andamento continuam rodando.</p>
          <Botao tamanho="totem" variante="sucesso" bloco className="mt-6" onClick={idle.reset}>Sim, continuar</Botao>
        </Modal>
      )}
    </>
  );
}
