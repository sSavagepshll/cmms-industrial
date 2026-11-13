import type { ReactNode } from "react";
import { Icone, type NomeIcone } from "./Icones";

const TIPOS: Record<"ok" | "erro" | "atencao" | "info", { cls: string; icone: NomeIcone; papel: "status" | "alert" }> = {
  ok: { cls: "bg-green-100 text-green-900", icone: "checkCirculo", papel: "status" },
  erro: { cls: "bg-red-700 text-white", icone: "alerta", papel: "alert" },
  atencao: { cls: "bg-amber-100 text-amber-900", icone: "alerta", papel: "status" },
  info: { cls: "bg-brand-50 text-primary-fg", icone: "info", papel: "status" },
};

/** Faixa de aviso: ícone + texto (nunca só cor). `erro` usa role="alert". */
export function Faixa({ tipo, children, className = "" }: { tipo: keyof typeof TIPOS; children: ReactNode; className?: string }) {
  const t = TIPOS[tipo];
  return (
    <p role={t.papel} className={`flex items-start gap-2 rounded-xl p-3 font-semibold ${t.cls} ${className}`}>
      <Icone nome={t.icone} className="mt-0.5 h-5 w-5" /><span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}
