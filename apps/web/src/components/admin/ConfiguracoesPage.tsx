"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Operador } from "@/lib/types";
import { Icone, type NomeIcone } from "../ui/Icones";
import { AuditoriaPage } from "./AuditoriaPage";
import { EmailPage } from "./EmailPage";
import { ParametrosPage } from "./ParametrosPage";
import { GruposTotem } from "./GruposTotem";
import { UsuariosPage } from "./UsuariosPage";

type Secao = "usuarios" | "grupos" | "email" | "parametros" | "auditoria";
const SECOES: { key: Secao; label: string; icone: NomeIcone }[] = [
  { key: "usuarios", label: "Usuários", icone: "usuarios" },
  { key: "grupos", label: "Grupos do Totem", icone: "pino" },
  { key: "email", label: "E-mail (SMTP)", icone: "email" },
  { key: "parametros", label: "Parâmetros", icone: "parametros" },
  { key: "auditoria", label: "Auditoria", icone: "prancheta" },
];

/** Configurações do Sistema (somente ADMIN): Usuários, Grupos do Totem (equipamentos e locais), E-mail (SMTP), Parâmetros globais e Auditoria. */
export function ConfiguracoesPage({ user, abaInicial = "usuarios" }: { user: Operador; abaInicial?: Secao }) {
  const [secao, setSecao] = useState<Secao>(abaInicial);

  // Mantém a aba ativa visível quando a barra rola na horizontal (telas estreitas).
  const lista = useRef<HTMLDivElement>(null);
  useEffect(() => { document.getElementById(`aba-${secao}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [secao]);

  // Setas esquerda/direita trocam de aba (padrão WAI-ARIA de tabs).
  function setas(e: KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = SECOES.findIndex((s) => s.key === secao);
    const prox = SECOES[(i + (e.key === "ArrowRight" ? 1 : SECOES.length - 1)) % SECOES.length].key;
    setSecao(prox);
    requestAnimationFrame(() => document.getElementById(`aba-${prox}`)?.focus());
  }

  return (
    <div className="flex flex-col gap-5 rounded-2xl bg-panel p-4 shadow-sm ring-1 ring-line md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-2xl font-extrabold leading-tight">Configurações do Sistema</h2>
        <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-brand-100 px-3 text-sm font-bold text-primary-fg"><Icone nome="cadeado" className="h-4 w-4" />Somente ADMIN</span>
      </div>
      {/* Abas: mesma altura/padding/ícone; a ativa se marca por borda inferior de largura FIXA (4 px em todas, transparente nas demais), sem deslocar as vizinhas. */}
      <div ref={lista} role="tablist" aria-label="Seções de configuração" onKeyDown={setas}
        className="flex items-stretch gap-2 overflow-x-auto scroll-smooth border-b border-line/50 pb-0 [scroll-snap-type:x_proximity] dark:border-line-soft">
        {SECOES.map((s) => (
          <button key={s.key} id={`aba-${s.key}`} role="tab" aria-selected={secao === s.key} aria-controls={`painel-${s.key}`} tabIndex={secao === s.key ? 0 : -1}
            onClick={() => setSecao(s.key)}
            className={`inline-flex min-h-11 shrink-0 snap-start items-center justify-center gap-2 whitespace-nowrap rounded-t-xl border-b-4 px-4 font-semibold ${secao === s.key ? "border-brand-600 bg-brand-600 text-white" : "border-transparent bg-panel ring-1 ring-line hover:bg-brand-50"}`}>
            <Icone nome={s.icone} className="h-5 w-5 shrink-0" />{s.label}
          </button>
        ))}
      </div>
      {/* Todos ficam montados (só escondidos): trocar de aba não perde alterações não salvas. */}
      <div role="tabpanel" id="painel-usuarios" aria-labelledby="aba-usuarios" hidden={secao !== "usuarios"}><UsuariosPage user={user} /></div>
      <div role="tabpanel" id="painel-grupos" aria-labelledby="aba-grupos" hidden={secao !== "grupos"}><GruposTotem /></div>
      <div role="tabpanel" id="painel-email" aria-labelledby="aba-email" hidden={secao !== "email"}><EmailPage /></div>
      <div role="tabpanel" id="painel-parametros" aria-labelledby="aba-parametros" hidden={secao !== "parametros"}><ParametrosPage /></div>
      <div role="tabpanel" id="painel-auditoria" aria-labelledby="aba-auditoria" hidden={secao !== "auditoria"}><AuditoriaPage /></div>
    </div>
  );
}
