"use client";
import { useEffect, useState } from "react";
import { SUCCESS_COUNTDOWN_S } from "@/lib/constants";
import { nomeAtivo } from "@/lib/rotulos";
import type { Equipamento, OmCriada } from "@/lib/types";
import { Botao } from "../ui/Botao";
import { StepperTotem } from "./Stepper";

export function StepSuccess({ om, equip, local, onExit }: { om: OmCriada; equip: Equipamento; local?: string; onExit: () => void }) {
  const [left, setLeft] = useState(SUCCESS_COUNTDOWN_S);

  useEffect(() => {
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { if (left <= 0) onExit(); }, [left, onExit]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-green-700 text-white p-6 text-center md:gap-6 md:p-8">
      <div className="w-full max-w-3xl rounded-card bg-panel px-card-md py-2 text-fg"><StepperTotem passo={5} concluido /></div>
      <svg viewBox="0 0 52 52" className="h-28 w-28 md:h-36 md:w-36" style={{ animation: "pop .5s ease-out" }} aria-hidden>
        <circle cx="26" cy="26" r="24" fill="none" stroke="white" strokeWidth="3" />
        <path d="M14 27l8 8 16-17" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray="40" strokeDashoffset="40" style={{ animation: "draw .5s .3s ease-out forwards" }} />
      </svg>
      <h1 className="text-4xl font-extrabold tabular-nums sm:text-6xl">#{om.numero}</h1>
      <p className="text-xl md:text-3xl">{equip.codigo} · {nomeAtivo(equip, local)}</p>
      <p className="text-xl md:text-3xl">Prioridade: <strong>{om.prioridade}</strong></p>
      <p className="text-xl font-semibold md:text-3xl" role="status">Equipe de Manutenção notificada com sucesso!</p>
      <p className="text-2xl" aria-live="off">Saindo em {Math.max(left, 0)}s</p>
      <Botao tamanho="totem" onClick={onExit} className="bg-white px-10 text-[#166534] ring-0 active:bg-white/80">
        Concluir / Sair Agora
      </Botao>
    </main>
  );
}
