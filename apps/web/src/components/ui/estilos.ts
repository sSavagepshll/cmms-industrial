import { classesBotao } from "./Botao";

/**
 * Classes compartilhadas do Painel Admin (desktop, mouse+teclado: alvos 40-48 px).
 * Só tokens existentes: brand / ink / panel / line / fg / muted. Vermelho de perigo = red-700; `accent` é só identidade.
 */
export const campo = "min-h-11 w-full rounded-xl bg-panel dark:bg-ink px-3 text-base ring-2 ring-line focus:outline-none focus:ring-primary-fg disabled:cursor-not-allowed disabled:bg-ink disabled:opacity-70";
// Botões: aliases DEPRECATED que reexportam as classes do `Botao` (Fase 34). Em telas novas use `<Botao variante=… />`; remover estes só após o QA aprovar.
/** @deprecated `<Botao variante="primario" />` */
export const btnPrim = classesBotao("primario", "compacto");
/** @deprecated `<Botao variante="secundario" />` */
export const btnSec = classesBotao("secundario", "compacto");
/** Ação sensível: contornada em vermelho de perigo (nunca o botão padrão de um diálogo). @deprecated `<Botao variante="perigo" />` */
export const btnPerigo = classesBotao("perigo", "compacto");
/** Confirmação de ação destrutiva (dentro de ConfirmarAcao). @deprecated `<Botao variante="perigo-cheio" />` */
export const btnPerigoCheio = classesBotao("perigo-cheio", "compacto");
