/**
 * Tema do TOTEM por configuração global (docs/ux/fase17-etapa2-telas-finais.md §2). Funções puras (sem imports) para
 * poder testá-las isoladas. Modos (só o ADMIN configura): AUTO (segue o sistema), CLARO, ESCURO e HORARIO
 * (escuro entre `inicio` e `fim`, padrão 18:00–06:00, fuso do totem). O toque do operador no botão sol/lua é uma
 * EXCEÇÃO: em HORARIO vale até a próxima virada; nos demais modos vale até o reset (recarga) do dispositivo.
 *
 * Contrato ASSUMIDO (o Back-end ainda não publicou): GET /config/publica -> { temaModo, escuroInicio, escuroFim, setoresCount }.
 */
export type ModoTema = "AUTO" | "CLARO" | "ESCURO" | "HORARIO";
export type TemaEfetivo = "light" | "dark";

export interface ConfigTemaTotem { modo: ModoTema; inicio: string; fim: string }
export const PADRAO_TEMA_TOTEM: ConfigTemaTotem = { modo: "AUTO", inicio: "18:00", fim: "06:00" };
export const MODOS_TEMA: { key: ModoTema; rotulo: string }[] = [
  { key: "AUTO", rotulo: "Automático" }, { key: "CLARO", rotulo: "Claro" }, { key: "ESCURO", rotulo: "Escuro" }, { key: "HORARIO", rotulo: "Por horário" },
];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const horaValida = (v: string) => HHMM.test(v);
const minutos = (v: string) => { const m = HHMM.exec(v); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Lê o corpo de GET /config/publica de forma defensiva. Valores inválidos caem no padrão. */
export function lerConfigPublica(corpo: unknown): { cfg: ConfigTemaTotem; setoresCount: number | null } {
  const o = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  const modo = String(o.temaModo ?? "").toUpperCase();
  const inicio = typeof o.escuroInicio === "string" && horaValida(o.escuroInicio) ? o.escuroInicio : PADRAO_TEMA_TOTEM.inicio;
  const fim = typeof o.escuroFim === "string" && horaValida(o.escuroFim) ? o.escuroFim : PADRAO_TEMA_TOTEM.fim;
  const n = Number(o.setoresCount);
  return {
    cfg: { modo: (["AUTO", "CLARO", "ESCURO", "HORARIO"] as const).find((m) => m === modo) ?? "AUTO", inicio, fim },
    setoresCount: Number.isInteger(n) && n >= 0 ? n : null,
  };
}

/** true se `agora` está dentro da janela escura [inicio, fim), inclusive quando atravessa a meia-noite. */
export function emHorarioEscuro(agora: Date, inicio: string, fim: string): boolean {
  const i = minutos(inicio), f = minutos(fim);
  if (i === null || f === null || i === f) return false;
  const a = agora.getHours() * 60 + agora.getMinutes();
  return i < f ? a >= i && a < f : a >= i || a < f;
}

/** Próximo instante em que o tema por horário muda (o mais próximo entre `inicio` e `fim` depois de `agora`). */
export function proximaVirada(agora: Date, inicio: string, fim: string): Date | null {
  const marcos = [inicio, fim].map(minutos).filter((x): x is number => x !== null);
  if (marcos.length < 2 || marcos[0] === marcos[1]) return null;
  const base = new Date(agora); base.setSeconds(0, 0);
  const candidatos = marcos.flatMap((m) => [0, 1].map((dia) => { const d = new Date(base); d.setDate(d.getDate() + dia); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d; }));
  return candidatos.filter((d) => d.getTime() > agora.getTime()).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}

/** Tema efetivo do totem pela configuração (sem a exceção do operador). */
export function temaPorConfig(cfg: ConfigTemaTotem, agora: Date, sistemaEscuro: boolean): TemaEfetivo {
  switch (cfg.modo) {
    case "CLARO": return "light";
    case "ESCURO": return "dark";
    case "HORARIO": return emHorarioEscuro(agora, cfg.inicio, cfg.fim) ? "dark" : "light";
    default: return sistemaEscuro ? "dark" : "light";
  }
}

export interface Excecao { tema: TemaEfetivo; ate: number | null } // ate = epoch ms; null = até o reset (recarga)
export const excecaoVale = (e: Excecao | null, agora: Date) => !!e && (e.ate === null || agora.getTime() < e.ate);

/** Exceção criada pelo toque do operador: vale até a próxima virada (HORARIO) ou até o reset do dispositivo (demais). */
export function novaExcecao(tema: TemaEfetivo, cfg: ConfigTemaTotem, agora: Date): Excecao {
  const virada = cfg.modo === "HORARIO" ? proximaVirada(agora, cfg.inicio, cfg.fim) : null;
  return { tema, ate: virada ? virada.getTime() : null };
}

/** Texto de apoio da tela de configuração: "Hoje às 14:32 o totem estaria CLARO. Próxima virada: 18:00." */
export function resumoTema(cfg: ConfigTemaTotem, agora: Date, sistemaEscuro: boolean): string {
  const hh = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const hoje = temaPorConfig(cfg, agora, sistemaEscuro) === "dark" ? "ESCURO" : "CLARO";
  const v = cfg.modo === "HORARIO" ? proximaVirada(agora, cfg.inicio, cfg.fim) : null;
  const quando = v ? ` Próxima virada: ${v.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.` : "";
  const base = cfg.modo === "AUTO" ? " (segue o sistema do totem)" : "";
  return `Agora, às ${hh}, o totem estaria ${hoje}${base}.${quando}`;
}
