import type { MotivoPausa, OmKanban, Prioridade, StatusKanban } from "./types";

export const TECNICO_IDLE_MS = 120_000;
export const TECNICO_WARN_MS = 15_000;
export const POLL_MS = 10_000;
export const POLL_COM_SSE_MS = 60_000;

export const COLUNAS: { key: StatusKanban; titulo: string; cor: string }[] = [
  { key: "ABERTO", titulo: "Abertas", cor: "border-sky-400" },
  { key: "EM_ATENDIMENTO", titulo: "Em atendimento", cor: "border-green-400" },
  { key: "PAUSADO", titulo: "Pausadas", cor: "border-amber-400" },
  { key: "AGUARDANDO_APROVACAO", titulo: "Aguardando aprovação", cor: "border-brand-400" },
  { key: "AGUARDANDO_BAIXA", titulo: "Aguardando conclusão", cor: "border-violet-400" },
  { key: "CONCLUIDO", titulo: "Concluídas hoje", cor: "border-slate-500" },
];

export const PRIORIDADE: Record<Prioridade, { label: string; cls: string }> = {
  CRITICA: { label: "CRÍTICA", cls: "bg-red-700 text-white" },
  ALTA: { label: "ALTA", cls: "bg-orange-500 text-black" },
  MEDIA: { label: "MÉDIA", cls: "bg-yellow-400 text-black" },
  BAIXA: { label: "BAIXA", cls: "bg-slate-500 text-white" },
};

export const MOTIVOS: { key: MotivoPausa; label: string; icon: string }[] = [
  { key: "AGUARDANDO_PECA", label: "Aguardando peça", icon: "🔩" },
  { key: "AGUARDANDO_PRODUCAO", label: "Aguardando produção", icon: "🏭" },
  { key: "AGUARDANDO_SUPORTE", label: "Aguardando suporte", icon: "🧑‍🔧" },
  { key: "REFEICAO", label: "Refeição", icon: "🍽️" },
  { key: "TROCA_TURNO", label: "Troca de turno", icon: "🔄" },
  { key: "OUTRO", label: "Outro motivo", icon: "✏️" },
];

/** Notas de pausa são gravadas pela API como "[PAUSA:CODIGO] detalhe". */
export function interpretarNota(texto: string): { pausa?: string; texto: string } {
  const m = /^\[PAUSA:([A-Z_]+)\]\s*(.*)$/s.exec(texto);
  if (!m) return { texto };
  const motivo = MOTIVOS.find((x) => x.key === m[1])?.label ?? m[1];
  return { pausa: motivo, texto: m[2] };
}

export function formatarDuracao(seg: number): string {
  const s = Math.max(0, Math.floor(seg));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(r)}`;
}

export function haQuanto(iso: string): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h} h ${min % 60} min` : `há ${Math.floor(h / 24)} d`;
}


/** "2h 18min" / "14 min" / "45 s": tempos gerenciais legíveis (painel e aprovações). */
export function duracaoHumana(seg: number | null | undefined): string {
  if (seg === null || seg === undefined || seg < 0) return "—";
  const m = Math.round(seg / 60);
  if (m < 1) return `${Math.round(seg)} s`;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}min`;
}

/** Quebra o texto "Causa raiz: …\nAção executada: …\nParecer: …" gravado pela API em /concluir. */
export function lerSolucao(s: string | null): { rotulo: string; texto: string }[] {
  return (s ?? "").split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf(":");
    return i > 0 && i < 24 ? { rotulo: l.slice(0, i), texto: l.slice(i + 1).trim() } : { rotulo: "", texto: l };
  });
}

/** Motivos de recusa da reserva em botões (US-11.4 cen. 3); "Outro" abre o teclado. Todos têm >= 10 caracteres (exigência da API). */
export const MOTIVOS_RECUSA = ["Sem habilidade para o serviço", "Já estou em OM crítica", "Fora do turno", "Outro"] as const;

/**
 * Grupos da coluna "Abertas" para o técnico (D1-D3). Usa a situação calculada pelo SERVIDOR (situacaoAtribuicao),
 * sem recalcular regra no cliente. Sem o campo (API antiga), a OM cai em "Para puxar".
 */
export function agruparAbertas(lista: OmKanban[], userId: string) {
  const g = { reservadasParaVoce: [] as OmKanban[], paraPuxar: [] as OmKanban[], urgentesAguardandoGerente: [] as OmKanban[], reservadasParaOutros: [] as OmKanban[] };
  for (const o of lista) {
    switch (o.situacaoAtribuicao) {
      case "RESERVADA": (o.reservadaPara?.id === userId ? g.reservadasParaVoce : g.reservadasParaOutros).push(o); break;
      case "URGENTE_AGUARDA_GERENTE":
      case "DEVOLVIDA": g.urgentesAguardandoGerente.push(o); break;
      default: g.paraPuxar.push(o); // PARA_PUXAR, LIBERADA ou sem o campo
    }
  }
  return g;
}
