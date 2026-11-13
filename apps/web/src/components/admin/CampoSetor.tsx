"use client";
import type { SetorOpcao } from "@/lib/types";
import { campo } from "../ui/estilos";

/**
 * Select obrigatório de Setor do cadastro de equipamento (Fase 36 / RN-81). Opções = setores ativos e não prediais, por nome
 * (o técnico "Geral" só aparece se for o setor atual do legado). Na edição, o setor atual inativo vira a 1ª opção "Nome (inativo)".
 */
export function CampoSetor({ valor, onChange, opcoes, setorAtual, erro, desabilitado, falhou, onRecarregar }: {
  valor: string; onChange: (id: string) => void; opcoes: SetorOpcao[] | null; setorAtual?: { id: string; nome: string };
  erro?: string; desabilitado?: boolean; falhou?: boolean; onRecarregar?: () => void;
}) {
  const lista = (opcoes ?? [])
    .filter((s) => s.ativo && !s.predial && (s.nome.trim().toLowerCase() !== "geral" || s.id === setorAtual?.id))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const atualFora = setorAtual && !lista.some((s) => s.id === setorAtual.id);
  return (
    <label className="flex flex-col gap-1">
      <span className="font-semibold">Setor</span>
      <select value={valor} onChange={(e) => onChange(e.target.value)} disabled={desabilitado || !opcoes} required aria-invalid={!!erro} aria-describedby="ajuda-setor" className={campo}>
        {!setorAtual && <option value="">{opcoes ? "Selecione o setor" : "Carregando setores…"}</option>}
        {atualFora && setorAtual && <option value={setorAtual.id}>{setorAtual.nome} (inativo)</option>}
        {lista.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
      </select>
      {falhou ? (
        <span id="ajuda-setor" className="text-sm font-semibold text-danger-fg">
          Não foi possível carregar os setores. {onRecarregar && <button type="button" onClick={onRecarregar} className="underline">Tentar de novo</button>}
        </span>
      ) : <span id="ajuda-setor" className={`text-sm ${erro ? "font-semibold text-danger-fg" : "text-muted"}`}>{erro || "Setor onde o equipamento está instalado (obrigatório)."}</span>}
    </label>
  );
}
