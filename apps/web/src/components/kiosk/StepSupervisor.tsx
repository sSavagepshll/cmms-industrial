"use client";
import { useEffect, useState } from "react";
import { listarAprovacoes } from "@/lib/api";
import { decidiveisAgora } from "@/lib/aprovacao";
import type { Aprovacao, Operador } from "@/lib/types";
import { Icone } from "../ui/Icones";
import { Screen } from "./ui";
import { Botao } from "../ui/Botao";
import { Card } from "../ui/Card";

/**
 * Menu pós-login de todos os perfis do Totem (OPERADOR, LIDER_PRODUCAO, ADMIN): aprovar OMs finalizadas ou abrir um chamado.
 * Renderização estável e imediata, sem auto-avanço: o menu aparece no primeiro render e o card de aprovação mostra
 * "Consultando…" / "Nenhuma pendente" / "N aguardando você". Falha de rede nunca bloqueia nem redireciona (RN-57).
 */
export function StepSupervisor({ user, onAprovar, onAbrirChamado, onSair }: {
  user: Operador; onAprovar: () => void; onAbrirChamado: () => void; onSair: () => void;
}) {
  const [lista, setLista] = useState<Aprovacao[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    let vivo = true;
    listarAprovacoes().then((l) => { if (vivo) setLista(l); }).catch(() => { if (vivo) setFalhou(true); });
    return () => { vivo = false; };
  }, []);

  const pendentes = lista ? decidiveisAgora(lista) : null;
  const aguardandoOperador = lista ? lista.length - decidiveisAgora(lista) : 0;
  const titulo = user.perfil === "OPERADOR" ? "Aprovar minhas OMs" : "Aprovar OMs";

  return (
    <Screen title={`Olá, ${user.nome}`} subtitle="O que você deseja fazer?" onBack={onSair} passo={2}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
        <Card como="button" variante="interativo" borda="totem" espaco="lg" autoFocus onClick={onAbrirChamado}
          className="flex min-h-40 flex-col items-center justify-center gap-2 text-center shadow-lg md:min-h-64">
          <Icone nome="ferramenta" className="h-14 w-14 md:h-16 md:w-16" />
          <span className="text-3xl font-extrabold md:text-4xl">Abrir chamado</span>
          <span className="text-xl text-muted md:text-2xl">Reportar falha em um equipamento</span>
        </Card>
        <button onClick={onAprovar}
          className="cursor-pointer disabled:cursor-not-allowed relative flex min-h-40 flex-col items-center justify-center gap-2 rounded-3xl bg-brand-600 p-6 text-white shadow-lg ring-4 ring-primary-edge md:min-h-64">
          <Icone nome="checkCirculo" className="h-14 w-14 md:h-16 md:w-16" />
          <span className="text-3xl font-extrabold md:text-4xl">{titulo}</span>
          <span className="text-xl md:text-2xl">
            {pendentes === null ? (falhou ? "Ver pendentes" : "Consultando…") : pendentes === 0 ? "Nenhuma pendente" : `${pendentes} aguardando você`}
            {aguardandoOperador > 0 && user.perfil !== "OPERADOR" && ` · ${aguardandoOperador} aguardando o operador`}
          </span>
          {!!pendentes && <span aria-label={`${pendentes} pendentes`} className="absolute right-4 top-4 grid min-h-12 min-w-12 place-items-center rounded-full bg-amber-400 px-3 text-3xl font-black text-black">{pendentes}</span>}
        </button>
      </div>
      <Botao tamanho="totem" onClick={onSair} className="mt-auto bg-strong text-strong-on dark:ring-2 dark:ring-primary-edge">Sair</Botao>
    </Screen>
  );
}
