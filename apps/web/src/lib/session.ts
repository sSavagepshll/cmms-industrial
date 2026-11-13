/**
 * Token JWT do totem. Fica SOMENTE em memória (variável de módulo): nunca em localStorage/cookie,
 * então não sobrevive a reload e é descartado no auto-logout (clearToken).
 *
 * Trava de segurança do Kiosk (aprovada pela Segurança): a sessão de PIN do totem tem validade curta e absoluta
 * (`SESSAO_PIN_MS`, 15 min). `limitarSessao` arma um prazo; ao vencer, o token é APAGADO da memória ativamente
 * (não só quando a próxima chamada falha) e `aoExpirar` limpa também o estado da UI. `getToken` nunca devolve
 * um token fora do prazo, mesmo que o timer tenha sido atrasado (aba em segundo plano, CPU ocupada).
 */
export const SESSAO_PIN_MS = 900_000;

let token: string | null = null;
/** Device ID da sessão de totem (contrato-sessao-totem): vai em X-Totem-Id em TODA requisição autenticada e em ?totem= no SSE. */
let totemId: string | null = null;
let expiraEmServidor: number | null = null;
let onUnauthorized: (() => void) | null = null;
let venceEm: number | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

function expirou() { return venceEm !== null && Date.now() >= venceEm; }

export const clearToken = () => {
  token = null; venceEm = null; totemId = null; expiraEmServidor = null;
  clearInterval(timer); timer = undefined;
};
export const setToken = (t: string) => { clearToken(); token = t; };
export const getTotemId = () => totemId;
export const setTotemId = (id: string | null) => { totemId = id; };
/** `expiraEmSegundos` do login de totem (prazo absoluto, sem renovação), como informado pelo servidor. */
export const setExpiraEmServidor = (s: number | null) => { expiraEmServidor = s; };
export const getExpiraEmServidor = () => expiraEmServidor;
export const getToken = () => {
  if (token && expirou()) clearToken();
  return token;
};
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn; };
export const notifyUnauthorized = () => onUnauthorized?.();

/** Segundos que faltam para o token vencer (null = sem prazo ou sem token). */
export const segundosRestantes = () => (token && venceEm !== null ? Math.max(0, Math.ceil((venceEm - Date.now()) / 1000)) : null);

/**
 * Limita a vida do token atual a `ms` (a partir de agora). Ao vencer: apaga o token e chama `aoExpirar` (a UI zera o
 * usuário e volta ao repouso). Verifica a cada 1 s e ao voltar o foco da aba. `clearToken` cancela tudo.
 */
export function limitarSessao(ms: number, aoExpirar: () => void) {
  if (!token) return;
  clearInterval(timer);
  venceEm = Date.now() + ms;
  const checar = () => {
    if (!expirou()) return;
    clearToken();
    document.removeEventListener("visibilitychange", checar);
    aoExpirar();
  };
  document.addEventListener("visibilitychange", checar);
  timer = setInterval(checar, 1000);
}
