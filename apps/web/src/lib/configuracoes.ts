import { ApiError } from "./api";
import type { ConfiguracaoItem } from "./types";

export const ehVerdadeiro = (v: string | null | undefined) => ["true", "1", "sim", "s", "yes", "on"].includes((v ?? "").trim().toLowerCase());

/** Chaves do SMTP: têm aba própria (E-mail) e ficam fora de Parâmetros. No banco o grupo se chama EMAIL. */
export const ehConfigEmail = (c: Pick<ConfiguracaoItem, "chave">) => c.chave.startsWith("SMTP_") || c.chave === "EMAIL_ATIVO";

/** SECRETO definido volta mascarado; não definido volta nulo/vazio. */
export const temValor = (c: ConfiguracaoItem) => c.valor !== null && c.valor !== "";

export function mensagemErroConfig(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "Sem conexão com o servidor.";
    if (e.status === 403) return "Apenas administradores podem alterar as configurações.";
    if (e.status === 404) return "Parâmetro não encontrado no banco.";
    if (e.status >= 500) return "Erro no servidor ao salvar.";
    return e.message;
  }
  return "Erro inesperado.";
}
