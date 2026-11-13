import type { ReactNode } from "react";
import { campo } from "./estilos";

/**
 * Campo de segredo WRITE-ONLY (senha SMTP etc.): o valor atual nunca é exibido nem pré-preenchido.
 * Em branco = manter o atual; digitado = substituir. `definido` vem da API (SECRETO definido vem mascarado; não definido, nulo).
 */
export function CampoSecreto({ id, rotulo, valor, onChange, definido, alterado = false, erro, extra, desabilitado = false }: {
  id: string; rotulo: string; valor: string; onChange: (v: string) => void; definido: boolean;
  alterado?: boolean; erro?: string; extra?: ReactNode; desabilitado?: boolean;
}) {
  const dica = `${id}-dica`;
  const ring = erro ? "ring-danger-fg" : alterado ? "ring-amber-500" : "";
  const texto = erro
    ?? (valor ? "A senha atual será substituída ao salvar."
      : definido ? "Senha definida e oculta. Em branco = manter a atual."
        : "Nenhuma senha definida.");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">{rotulo}{alterado && <span aria-label="alterado" className="ml-1 text-amber-700">●</span>}</label>
      <input id={id} type="password" autoComplete="new-password" value={valor} disabled={desabilitado}
        onChange={(e) => onChange(e.target.value)} aria-invalid={!!erro} aria-describedby={dica}
        placeholder={definido ? "●●●●●●●●  oculta · digite para substituir" : "Digite para definir"} className={`${campo} ${ring}`} />
      <span id={dica} className={`text-sm ${erro ? "font-semibold text-red-800" : "text-muted"}`}>{texto}{extra}</span>
    </div>
  );
}
