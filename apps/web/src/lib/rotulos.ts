import { CATEGORIAS } from "./constants";
import type { CustoTipo, TipoAtivo } from "./types";
import { MOTIVOS } from "./kanban";

/** Fallback defensivo para códigos desconhecidos: tira "_", minúsculas, primeira maiúscula; "OM" sempre em maiúsculas. */
export function humanizar(codigo: string): string {
  const t = codigo.replace(/_/g, " ").trim().toLowerCase().replace(/^./, (c) => c.toUpperCase());
  return t.replace(/\bom\b/gi, "OM");
}

/** Nome do ativo para telas: no predial acrescenta o local ("Manutenção Predial / Geral · RH"); item não cadastrado (grupo OUTROS) mostra o texto digitado. */
export const nomeAtivo = (eq: { nome: string; predial?: boolean }, local?: string | null, item?: string | null) => (item ? item : eq.predial && local ? `${eq.nome} · ${local}` : eq.nome);

/**
 * Setor da OM para telas (Fase 35, RN-72/73): usa o `setorExibicao` do servidor; sem ele deriva do ativo
 * (predial = "Predial · Local: X", item avulso = "Item avulso", demais = setor do equipamento).
 */
export function setorDaOm(om: { setorExibicao?: string | null; localDescricao?: string | null; equipamento: { setor?: string; predial?: boolean; itemLivre?: boolean } }): string {
  if (om.setorExibicao) return om.setorExibicao;
  if (om.equipamento.predial) return om.localDescricao ? `Predial · Local: ${om.localDescricao}` : "Predial";
  if (om.equipamento.itemLivre) return "Item avulso";
  return om.equipamento.setor ?? "";
}

/** Setor do equipamento escolhido no Totem (espelha apps/api setorExibicao): predial = "Predial · Local: X", item avulso = "Item avulso", demais = setor. */
export function rotuloSetor(eq: { setor?: string; predial?: boolean; itemLivre?: boolean }, local?: string | null): string {
  if (eq.predial) return local ? `Predial · Local: ${local}` : "Predial";
  if (eq.itemLivre) return "Item avulso";
  return eq.setor ?? "";
}

/** Perfil de quem aprovou, para a lista de conclusões pendentes. */
export const rotuloPerfilAprovador = (p: string) => ({ OPERADOR: "Operador", LIDER_PRODUCAO: "Líder", ADMIN: "Admin", GERENTE: "Gerente" } as Record<string, string>)[p] ?? humanizar(p);

const CATEGORIA_EXTRA: Record<string, string> = { OUTROS: "Outros" };
export const rotuloCategoria = (c: string) => CATEGORIAS.find((x) => x.key === c)?.label ?? CATEGORIA_EXTRA[c] ?? humanizar(c);
export const rotuloMotivoPausa = (m: string) => { const k = m.split(":")[0]; return MOTIVOS.find((x) => x.key === k)?.label ?? humanizar(k); };

// ---- Tipo de ativo e custo: só exibição (ficha e detalhe da OM). O Totem não pergunta mais (Fase 30). ----
const TIPOS_ATIVO: Record<string, string> = { MOLDE: "Molde", MAQUINA: "Máquina", ROBO: "Robô" };
/** Rótulo do tipo para telas: prefere o do servidor, depois o texto digitado, depois o mapa (inclui ROBO legado). */
export function rotuloTipo(tipo?: TipoAtivo | null, outro?: string | null, rotuloServidor?: string | null): string {
  if (rotuloServidor) return rotuloServidor;
  if (tipo === "OUTRO") return outro || "Outro";
  return (tipo && TIPOS_ATIVO[tipo]) || tipo || "";
}
export const CUSTOS: { key: CustoTipo; label: string }[] = [
  { key: "INTERNO", label: "Interno" },
  { key: "CLIENTE", label: "Cliente" },
];
