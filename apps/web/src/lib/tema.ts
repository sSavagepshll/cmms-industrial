/**
 * Tema claro/escuro (docs/ux/fase17-tema-escuro.md §3). A preferência do USUÁRIO tem 3 valores (auto|claro|escuro),
 * fica em localStorage["om-tema"] (por dispositivo, sem dado pessoal) e o resultado efetivo vai no atributo
 * data-theme="light"|"dark" do <html>. O reset de sessão do totem NÃO apaga o tema: ele é do dispositivo.
 */
export type PreferenciaTema = "auto" | "claro" | "escuro";
export type TemaEfetivo = "light" | "dark";

export const CHAVE_TEMA = "om-tema";
export const EVENTO_TEMA = "om-tema";
export const ROTULO_TEMA: Record<PreferenciaTema, string> = { auto: "Auto", claro: "Claro", escuro: "Escuro" };

const MQ = "(prefers-color-scheme: dark)";

export function lerPreferencia(): PreferenciaTema {
  try {
    const v = localStorage.getItem(CHAVE_TEMA);
    if (v === "claro" || v === "escuro" || v === "auto") return v;
  } catch { /* localStorage bloqueado (modo privado): segue em Auto */ }
  return "auto";
}

export function resolverTema(p: PreferenciaTema): TemaEfetivo {
  if (p === "claro") return "light";
  if (p === "escuro") return "dark";
  return typeof window !== "undefined" && window.matchMedia?.(MQ).matches ? "dark" : "light";
}

export function aplicarTema(p: PreferenciaTema) {
  document.documentElement.setAttribute("data-theme", resolverTema(p));
}

export function salvarPreferencia(p: PreferenciaTema) {
  try { localStorage.setItem(CHAVE_TEMA, p); } catch { /* sem persistência: vale só nesta sessão da página */ }
  aplicarTema(p);
  window.dispatchEvent(new Event(EVENTO_TEMA));
}

/** Assina mudanças de preferência (esta aba, outras abas) e do tema do sistema (para o modo Auto). */
export function assinarTema(aoMudar: () => void): () => void {
  const mq = window.matchMedia?.(MQ);
  const doSistema = () => { if (lerPreferencia() === "auto") { aplicarTema("auto"); aoMudar(); } };
  window.addEventListener(EVENTO_TEMA, aoMudar);
  window.addEventListener("storage", aoMudar);
  mq?.addEventListener?.("change", doSistema);
  return () => {
    window.removeEventListener(EVENTO_TEMA, aoMudar);
    window.removeEventListener("storage", aoMudar);
    mq?.removeEventListener?.("change", doSistema);
  };
}

/**
 * Script inline do <head>: roda ANTES da pintura e define data-theme, para não piscar o tema errado.
 * Autossuficiente de propósito (não importa nada) e tolerante a localStorage bloqueado.
 */
export const SCRIPT_TEMA = `(function(){var p='auto';try{var v=localStorage.getItem('${CHAVE_TEMA}');if(v==='claro'||v==='escuro'||v==='auto')p=v}catch(e){}var d=p==='escuro'||(p==='auto'&&window.matchMedia&&window.matchMedia('${MQ}').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light')})()`;
