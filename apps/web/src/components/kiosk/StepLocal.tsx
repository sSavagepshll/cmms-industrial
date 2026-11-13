"use client";
import { useState } from "react";
import { LOCAL_MAX } from "@/lib/constants";
import { Screen, btnPrimary } from "./ui";
import { VirtualKeyboard } from "./VirtualKeyboard";

/**
 * "Onde é o problema?" para manutenção predial/geral. Fase 22: os atalhos vêm do cadastro (`locais`, só os ativos, na ordem
 * definida pelo Admin); lista vazia = somente o campo de texto livre. Texto livre via teclado virtual (Fase 20).
 */
export function StepLocal({ inicial = "", locais = [], onConfirmar, onBack }: { inicial?: string; locais?: string[]; onConfirmar: (local: string) => void; onBack: () => void }) {
  const [local, setLocal] = useState(inicial);
  const [osk, setOsk] = useState(false);
  const texto = local.trim().replace(/\s+/g, " ");

  return (
    <Screen title="Manutenção predial / geral" subtitle="Onde é o problema?" onBack={onBack} passo={3}>
      {locais.length > 0 && <section aria-label="Locais rápidos" className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        {locais.map((l) => (
          <button key={l} aria-pressed={texto.toLowerCase() === l.toLowerCase()} onClick={() => { setLocal(l); setOsk(false); }}
            className={`min-h-24 rounded-3xl px-3 text-2xl font-extrabold ring-4 md:min-h-[110px] md:text-3xl ${texto.toLowerCase() === l.toLowerCase() ? "bg-brand-700 text-white ring-fg" : "bg-panel ring-transparent"}`}>
            {texto.toLowerCase() === l.toLowerCase() ? "✓ " : ""}{l}
          </button>
        ))}
      </section>}

      <section aria-label="Outro local" className="flex flex-col gap-3">
        <h2 className="text-xl font-bold text-muted md:text-2xl">{locais.length > 0 ? "Ou digite o local" : "Digite o local"}</h2>
        <button onClick={() => setOsk((v) => !v)} aria-label="Digitar o local"
          className="min-h-16 rounded-2xl bg-panel p-4 text-left text-2xl font-bold ring-1 ring-line md:min-h-tap-md">
          {local || <span className="text-xl font-normal text-muted">Toque para digitar (ex.: Administração - sala 2)</span>}
          <span className="float-right text-lg font-normal text-muted">{local.length}/{LOCAL_MAX}</span>
        </button>
        {osk && <VirtualKeyboard value={local} onChange={setLocal} maxLength={LOCAL_MAX} />}
      </section>

      <button disabled={!texto} onClick={() => texto && onConfirmar(texto)} className={`${btnPrimary} mt-auto bg-brand-600 text-white`}>Continuar →</button>
    </Screen>
  );
}
