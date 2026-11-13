import type { Aprovacao } from "./types";

/**
 * Escopo GLOBAL (decisão do usuário, 08/10/2026): não há equipes nem setores. O LIDER_PRODUCAO enxerga TODAS as OMs
 * pendentes e decide as de qualquer operador depois do prazo (RN-21); o OPERADOR só recebe da API as que ele abriu.
 * Por isso o front não filtra a lista por perfil: tudo vem escopado do servidor.
 */

/** Texto do motivo pelo qual o usuário NÃO pode decidir agora (os botões Aprovar/Reprovar ficam ocultos). */
export function textoBloqueio(a: Pick<Aprovacao, "motivoBloqueio" | "solicitante">): string | null {
  switch (a.motivoBloqueio) {
    case "AGUARDE_OPERADOR": return `Aguardando o operador (${a.solicitante.nome}).`;
    case "AUTOAPROVACAO_PROIBIDA": return "Você executou esta OM e não pode decidir sobre ela.";
    case "ACESSO_NEGADO": return "Seu perfil não decide sobre esta OM.";
    default: return a.motivoBloqueio ? "Você não pode decidir sobre esta OM." : null;
  }
}

/** Quantas OMs o usuário pode decidir AGORA (sem a flag, em API antiga, conta como decidível). */
export const decidiveisAgora = (lista: Aprovacao[]) => lista.filter((a) => a.podeAprovar !== false).length;
