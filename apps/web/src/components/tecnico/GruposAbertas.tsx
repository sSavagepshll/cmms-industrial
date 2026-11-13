"use client";
import { agruparAbertas } from "@/lib/kanban";
import type { OmKanban, Operador } from "@/lib/types";
import { ehGestor } from "@/lib/types";
import { Icone, type NomeIcone } from "../ui/Icones";
import { OmCard } from "./OmCard";

/**
 * Coluna "Abertas" do Kanban em grupos (docs/ux/fase17 §2.4, decisões D1-D3):
 * 1) Reservadas para você · 2) Para puxar (não urgentes + liberadas pelo fallback) · 3) Urgentes aguardando o gerente
 * (somente leitura) · 4) Reservadas para outros (bloqueadas, RN-23).
 */
export function GruposAbertas({ lista, user, onAbrir }: { lista: OmKanban[]; user: Operador; onAbrir: (o: OmKanban) => void }) {
  const gestor = ehGestor(user.perfil);
  const g = agruparAbertas(lista, user.id);
  const blocos: { chave: keyof typeof g; titulo: string; dica: string; icone: NomeIcone }[] = [
    { chave: "reservadasParaVoce", titulo: "Reservadas para você", dica: "Assuma com o seu PIN ou recuse com motivo.", icone: "pino" },
    { chave: "paraPuxar", titulo: "Para puxar", dica: "Não urgentes: toque na OM e assuma com o PIN.", icone: "ferramenta" },
    { chave: "urgentesAguardandoGerente", titulo: gestor ? "Urgentes · aguardando designação" : "Urgentes · aguardando o gerente",
      dica: gestor ? "Designe um técnico (ou assuma você)." : "Somente leitura até o gerente designar ou o prazo liberar.", icone: "cadeado" },
    { chave: "reservadasParaOutros", titulo: "Reservadas para outros técnicos", dica: "Bloqueadas: aguardam o aceite do técnico escolhido.", icone: "cadeado" },
  ];
  const total = blocos.reduce((n, b) => n + g[b.chave].length, 0);
  if (total === 0) return <p className="text-xl text-muted">Nenhuma OM.</p>;

  return (
    <div className="flex flex-col gap-5">
      {blocos.filter((b) => g[b.chave].length > 0).map((b) => (
        <section key={b.chave} aria-label={b.titulo} className="flex flex-col gap-3">
          <header>
            <h3 className="flex items-center gap-2 text-lg font-extrabold"><Icone nome={b.icone} className="h-5 w-5" />{b.titulo} <span className="text-muted">({g[b.chave].length})</span></h3>
            <p className="text-base text-muted">{b.dica}</p>
          </header>
          {g[b.chave].map((o) => <OmCard key={o.id} om={o} user={user} onOpen={() => onAbrir(o)} />)}
        </section>
      ))}
    </div>
  );
}
