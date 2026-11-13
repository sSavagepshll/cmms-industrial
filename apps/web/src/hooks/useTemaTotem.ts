"use client";
import { useCallback, useEffect, useRef } from "react";
import { buscarConfigPublica } from "@/lib/api";
import { EVENTO_TEMA } from "@/lib/tema";
import {
  PADRAO_TEMA_TOTEM, excecaoVale, lerConfigPublica, novaExcecao, proximaVirada, temaPorConfig,
  type ConfigTemaTotem, type Excecao, type TemaEfetivo,
} from "@/lib/temaTotem";

const MQ = "(prefers-color-scheme: dark)";
const REFRESCO_MS = 10 * 60 * 1000; // relê a configuração sem recarregar a página

function aplicar(t: TemaEfetivo) {
  document.documentElement.setAttribute("data-theme", t);
  window.dispatchEvent(new Event(EVENTO_TEMA)); // atualiza o ícone do botão
}

/**
 * Tema do totem por configuração global (docs/ux/fase17-etapa2-telas-finais.md §2). Lê GET /config/publica; se não existir
 * (404/sem rede) ou o modo for AUTO, não mexe em nada (vale a preferência do dispositivo). Nos modos CLARO/ESCURO/HORARIO aplica o
 * tema SEM gravar no localStorage e vira no horário sem recarregar. O toque do operador (`alternar`) é uma exceção:
 * em HORARIO vale até a próxima virada; nos demais, até a recarga do dispositivo.
 */
export function useTemaTotem() {
  const cfg = useRef<ConfigTemaTotem | null>(null); // null = sem config gerenciada
  const excecao = useRef<Excecao | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reaplicar = useCallback(() => {
    clearTimeout(timer.current);
    const c = cfg.current;
    if (!c) return;
    const agora = new Date();
    if (excecao.current && !excecaoVale(excecao.current, agora)) excecao.current = null;
    const sistema = !!window.matchMedia?.(MQ).matches;
    aplicar(excecao.current?.tema ?? temaPorConfig(c, agora, sistema));
    const v = c.modo === "HORARIO" ? proximaVirada(agora, c.inicio, c.fim) : null;
    if (v) timer.current = setTimeout(reaplicar, Math.max(1000, v.getTime() - Date.now() + 500));
  }, []);

  useEffect(() => {
    let vivo = true;
    const carregar = async () => {
      try {
        const { cfg: nova } = lerConfigPublica(await buscarConfigPublica());
        if (!vivo) return;
        cfg.current = nova.modo === "AUTO" ? null : nova; // AUTO: segue o sistema/preferência atual (sem interferir)
        if (nova.modo === "AUTO") clearTimeout(timer.current);
        reaplicar();
      } catch { /* sem endpoint ainda: mantém o comportamento atual */ }
    };
    void carregar();
    const id = setInterval(carregar, REFRESCO_MS);
    const mq = window.matchMedia?.(MQ);
    mq?.addEventListener?.("change", reaplicar);
    return () => { vivo = false; clearInterval(id); clearTimeout(timer.current); mq?.removeEventListener?.("change", reaplicar); };
  }, [reaplicar]);

  /** Toque do operador no sol/lua. Devolve true se tratou (config gerenciada); false => usar a preferência do dispositivo. */
  const alternar = useCallback((efetivoAtual: TemaEfetivo): boolean => {
    const c = cfg.current;
    if (!c) return false;
    const novo: TemaEfetivo = efetivoAtual === "dark" ? "light" : "dark";
    excecao.current = novaExcecao(novo, c ?? PADRAO_TEMA_TOTEM, new Date());
    reaplicar();
    return true;
  }, [reaplicar]);

  return { alternar };
}
