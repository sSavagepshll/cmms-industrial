"use client";
import { tempoCurto, useContagem } from "@/hooks/useContagem";
import type { Aprovacao } from "@/lib/types";
import { Icone, type NomeIcone } from "../ui/Icones";

/**
 * Etiqueta de situação de uma OM na lista de aprovações, para o usuário LOGADO (flags calculadas pelo servidor):
 * "Decide agora" · "Aguardando o operador · libera em N min" · "Você executou". Ícone + texto, nunca só cor.
 * `onAtualizar` dispara quando a contagem chega a zero (a OM passa a ser decidível: recarregar a lista).
 */
export function SituacaoAprovacao({ a, grande = false, onAtualizar }: { a: Aprovacao; grande?: boolean; onAtualizar?: () => void }) {
  const aguarde = a.podeAprovar === false && a.motivoBloqueio === "AGUARDE_OPERADOR";
  const falta = useContagem(aguarde ? a.aprovaEmSegundos : undefined, onAtualizar);
  const base = `inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-bold ${grande ? "text-lg" : "text-sm"}`;
  const ic = grande ? "h-5 w-5" : "h-4 w-4";
  const chip = (cls: string, icone: NomeIcone, texto: string) => <span className={`${base} ${cls}`}><Icone nome={icone} className={ic} />{texto}</span>;

  if (a.podeAprovar === false) {
    if (a.motivoBloqueio === "AUTOAPROVACAO_PROIBIDA") return chip("bg-primary-soft text-primary-soft-fg", "cadeado", "Você executou");
    if (aguarde) return chip("bg-warn-soft text-warn-soft-fg", "relogio", `Aguardando o operador${falta !== null && falta > 0 ? ` · libera em ${tempoCurto(falta)}` : ""}`);
    return chip("bg-primary-soft text-primary-soft-fg", "cadeado", "Sem permissão");
  }
  return chip("bg-ok-soft text-ok-soft-fg", "check", a.decideEmNomeDe ? `Decide agora · em nome de ${a.decideEmNomeDe}` : "Decide agora");
}
