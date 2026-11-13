/** Utilitários de data/hora para os campos numéricos do totem (entrada só com teclado numérico). */

/** Aplica máscara: mask("16072026", "##/##/####") -> "16/07/2026" (mostra só o que foi digitado). */
export function mascarar(digitos: string, padrao: string): string {
  let i = 0, out = "";
  for (const c of padrao) {
    if (i >= digitos.length) break;
    out += c === "#" ? digitos[i++] : c;
  }
  return out;
}

export const MASK_DATA = "##/##/####";
export const MASK_HORA = "##:##";

/** "DDMMAAAA" -> {d,m,y} se for data real; senão null. */
export function lerData(d8: string): { d: number; m: number; y: number } | null {
  if (!/^\d{8}$/.test(d8)) return null;
  const d = +d8.slice(0, 2), m = +d8.slice(2, 4), y = +d8.slice(4);
  const dt = new Date(y, m - 1, d);
  return y >= 2000 && dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? { d, m, y } : null;
}

/** "HHMM" -> minutos desde 00:00; null se inválido. */
export function lerHora(h4: string): number | null {
  if (!/^\d{4}$/.test(h4)) return null;
  const h = +h4.slice(0, 2), m = +h4.slice(2);
  return h < 24 && m < 60 ? h * 60 + m : null;
}

export function dataEmDigitos(offsetDias = 0): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - offsetDias);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(dt.getDate())}${p(dt.getMonth() + 1)}${dt.getFullYear()}`;
}

/** Data (local) + minutos -> Date. */
export const montar = (d: { d: number; m: number; y: number }, min: number) =>
  new Date(d.y, d.m - 1, d.d, Math.floor(min / 60), min % 60);

/** Horas decimais com vírgula, como no formulário ("6,5"). */
export const horasDecimais = (seg: number) => (seg / 3600).toFixed(1).replace(".", ",");

export const fmtDia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
export const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
