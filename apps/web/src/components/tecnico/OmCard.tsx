import { nomeAtivo, setorDaOm } from "@/lib/rotulos";
import { PRIORIDADE, formatarDuracao, haQuanto } from "@/lib/kanban";
import { segundosDe, tempoServidor, useTick } from "@/hooks/useTempoOm";
import { ehGestor, type OmKanban, type Operador } from "@/lib/types";
import { SeloAtribuicao } from "../ui/Selos";

export function OmCard({ om, user, onOpen }: { om: OmKanban; user: Operador; onOpen: () => void }) {
  const p = PRIORIDADE[om.prioridade];
  const t = tempoServidor(om);
  useTick(!!t?.since);
  const paraMim = om.situacaoAtribuicao === "RESERVADA" && om.reservadaPara?.id === user.id;
  const bloqueada = om.situacaoAtribuicao === "RESERVADA" && !paraMim;
  return (
    <button onClick={onOpen}
      className={`flex min-h-[120px] flex-col gap-2 rounded-2xl bg-panel p-4 text-left ring-2 ${paraMim ? "border-l-8 border-primary-fg ring-primary-fg" : om.prioridade === "CRITICA" ? "ring-red-500" : "ring-line"} ${bloqueada ? "opacity-80" : ""}`}>
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="whitespace-nowrap text-lg font-bold tabular-nums text-primary-fg">{om.numero}</span>
        <span className={`rounded-full px-3 py-1 text-lg font-extrabold ${p.cls}`}>{p.label}</span>
      </span>
      <span className="text-2xl font-extrabold">{om.equipamento.codigo} · {nomeAtivo(om.equipamento, om.localDescricao, om.itemDescricao)}</span>
      <span className="text-lg text-muted">{om.equipamento.predial ? "" : `${setorDaOm(om)} · `}{om.sintomas.join(", ") || om.titulo}</span>
      {om.statusKanban === "ABERTO" && <SeloAtribuicao om={om} userId={user.id} gestor={ehGestor(user.perfil)} />}
      {om.statusKanban === "AGUARDANDO_APROVACAO" && <span className="rounded-full bg-brand-100 px-3 py-1 text-lg font-bold text-primary-fg">Aguardando aprovação</span>}
      {om.statusKanban === "AGUARDANDO_BAIXA" && <span className="rounded-full bg-violet-100 px-3 py-1 text-lg font-bold text-violet-900">Aguardando conclusão{om.aprovadoPor ? ` · aprovada por ${om.aprovadoPor.nome}` : ""}</span>}
      {t && om.statusKanban !== "ABERTO" && om.statusKanban !== "AGUARDANDO_APROVACAO" && om.statusKanban !== "AGUARDANDO_BAIXA" && om.statusKanban !== "CONCLUIDO" && (
        <span className={`font-mono text-2xl font-bold ${t.rodando ? "text-ok-fg" : "text-amber-800"}`}>{t.rodando ? "▶" : "⏸"} {formatarDuracao(segundosDe(t))}</span>
      )}
      <span className="mt-auto flex items-baseline justify-between gap-2 text-lg text-muted">
        <span className="min-w-0 truncate">{om.responsavel ? om.responsavel.nome : `por ${om.solicitante.nome}`}</span>
        <span className="whitespace-nowrap">{haQuanto(om.dataAbertura)}</span>
      </span>
    </button>
  );
}
