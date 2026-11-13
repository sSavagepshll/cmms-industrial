/**
 * CSV corporativo único (Fase 35 / RN-76; docs/arch/fase35-arquitetura-emails-pdf-csv.md §4). Gerado no navegador.
 * BOM UTF-8, `;` entre colunas, CRLF entre linhas e ao final, texto sempre entre aspas (aspas internas duplicadas, quebras preservadas),
 * número sem aspas com vírgula decimal, data `dd/MM/yyyy HH:mm:ss`, booleano Sim/Não, vazio para null/undefined.
 * Texto iniciado por `=`, `+`, `-`, `@`, TAB ou CR recebe `'` na frente (injeção de fórmula, OWASP).
 */
export type Celula = string | number | boolean | Date | null | undefined;

const BOM = "﻿";
const pad = (n: number) => String(n).padStart(2, "0");

const dataHora = (d: Date) =>
  `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const texto = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;

function celula(v: Celula): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v).replace(".", ",") : "";
  if (typeof v === "boolean") return texto(v ? "Sim" : "Não");
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : texto(dataHora(v));
  return texto(v);
}

/** Texto completo do arquivo, já com BOM. `diretivaSep` (padrão true, Fase 36 §4): primeira linha `sep=;` (diretiva do Excel, sem escape); `false` para consumidores que não são planilha. */
export function gerarCsv(linhas: Celula[][], opc: { diretivaSep?: boolean } = {}): string {
  return BOM + ((opc.diretivaSep ?? true) ? "sep=;\r\n" : "") + linhas.map((l) => l.map(celula).join(";") + "\r\n").join("");
}

/** Baixa `<nomeBase>-AAAA-MM-DD.csv`. */
export function baixarCsv(nomeBase: string, linhas: Celula[][], opc: { diretivaSep?: boolean } = {}): void {
  const hoje = new Date();
  const dia = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
  const url = URL.createObjectURL(new Blob([gerarCsv(linhas, opc)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${nomeBase}-${dia}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
