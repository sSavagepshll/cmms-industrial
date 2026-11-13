"use client";
import { useEffect, useRef, useState } from "react";
import { CATEGORIAS, OBS_MAX, SINTOMA_MAX, TRIADE } from "@/lib/constants";
import type { CategoriaKey, Equipamento, Impacto } from "@/lib/types";
import { DockTeclado, Screen, SeloSetor, btnPrimary } from "./ui";
import { rotuloSetor } from "@/lib/rotulos";
import { VirtualKeyboard } from "./VirtualKeyboard";

/** Detalhes da falha (US-15): tipo (tríade), sintomas e condição da máquina. `sintomas`/`observacao` já no formato de POST /ordens. */
export interface DetalhesFalha {
  impacto: Impacto;
  categoria: CategoriaKey;
  sintomas: string[];
  observacao: string;
  /** Estado da tela, para voltar da revisão sem perder o que foi digitado. */
  tipo: "MECANICO" | "ELETRICO" | "OUTROS";
  chips: string[];
  texto: string;
}

/**
 * Texto livre -> API: curto (≤80, sem ';') vira mais um sintoma; longo vai em `observacao` (≤250). Sem chips, o texto longo também
 * entra truncado como único sintoma (a API exige ao menos 1).
 */
export function montarSintomas(chips: string[], textoBruto: string): { sintomas: string[]; observacao: string } {
  const texto = textoBruto.trim().replace(/\s+/g, " ").replace(/;/g, ",");
  if (!texto) return { sintomas: chips, observacao: "" };
  if (texto.length <= SINTOMA_MAX) return { sintomas: [...chips, texto], observacao: "" };
  return { sintomas: chips.length ? chips : [texto.slice(0, SINTOMA_MAX).trimEnd()], observacao: texto };
}

const alvo = (sel: boolean) =>
  `min-h-tap-lg rounded-3xl px-1 text-base font-extrabold ring-4 min-[420px]:px-2 min-[420px]:text-xl md:text-3xl ${sel ? "bg-brand-700 text-white ring-fg" : "bg-panel ring-transparent"}`;

export function StepDetalhes({ equip, initial, onNext, onBack }: {
  equip: Equipamento; initial: Partial<DetalhesFalha>; onNext: (d: DetalhesFalha) => void; onBack: () => void;
}) {
  const [tipo, setTipo] = useState<DetalhesFalha["tipo"] | undefined>(initial.tipo);
  const [chips, setChips] = useState<string[]>(initial.chips ?? []);
  const [texto, setTexto] = useState(initial.texto ?? "");
  const [impacto, setImpacto] = useState<Impacto | undefined>(initial.impacto);

  const campo = useRef<HTMLDivElement>(null);
  useEffect(() => { campo.current?.scrollIntoView({ block: "nearest" }); }, [texto]);
  const predial = !!equip.predial;
  const t = TRIADE.find((x) => x.key === tipo);
  // No fluxo predial, "Outros" envia CIVIL_PREDIAL com os chips prediais (contrato Fase 30 §5.3).
  const categoria: CategoriaKey | undefined = !tipo ? undefined : predial && tipo === "OUTROS" ? "CIVIL_PREDIAL" : tipo;
  const sugestoes = predial && tipo === "OUTROS" ? CATEGORIAS.find((c) => c.key === "CIVIL_PREDIAL")!.sintomas : t?.sintomas ?? [];
  const { sintomas, observacao } = montarSintomas(chips, texto);
  const temSintoma = sintomas.length > 0;
  const ok = !!(categoria && tipo && temSintoma && impacto);
  const pendencias = [!tipo && "o tipo do problema", tipo && !temSintoma && "ao menos um sintoma ou descrição", !impacto && "a condição da máquina"].filter(Boolean) as string[];

  const escolher = (k: DetalhesFalha["tipo"]) => { if (k !== tipo) { setTipo(k); setChips([]); } };
  const alternar = (s: string) => setChips((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));

  return (
    <Screen title={`${equip.codigo} · ${equip.nome}`} subtitle={predial ? "Qual o problema no local?" : "Qual o problema?"} onBack={onBack} passo={4} passoCompacto selo={<SeloSetor texto={rotuloSetor(equip)} />}>
      <section aria-label="Tipo do problema" className="grid grid-cols-3 gap-3 md:gap-4">
        {TRIADE.map((x) => (
          <button key={x.key} aria-pressed={tipo === x.key} onClick={() => escolher(x.key)} className={alvo(tipo === x.key)}>
            {tipo === x.key ? "✓ " : ""}<span aria-hidden className="hidden min-[420px]:inline">{x.icon} </span>{x.label}
          </button>
        ))}
      </section>

      {tipo ? (
        <>
          <section aria-label="Sugestões rápidas" className="flex flex-wrap gap-2 md:gap-3">
            {sugestoes.map((s) => (
              <button key={s} aria-pressed={chips.includes(s)} onClick={() => alternar(s)}
                className={`min-h-14 rounded-full px-4 text-lg font-semibold ring-2 md:min-h-tap-sm md:px-6 md:text-xl ${chips.includes(s) ? "bg-green-700 text-white ring-fg" : "bg-panel ring-line"}`}>
                {chips.includes(s) ? "✓ " : ""}{s}
              </button>
            ))}
          </section>

          <section aria-label="Descrição do problema" className="flex flex-col gap-3">
            <div ref={campo} aria-live="polite" style={{ scrollMarginBottom: "50dvh" }} className="min-h-[72px] rounded-2xl bg-panel p-4 text-xl ring-2 ring-brand-600">
              {texto || <span className="text-muted">Digite detalhes do problema (opcional se escolheu uma sugestão)</span>}
              <span className="float-right text-lg text-muted">{texto.length}/{OBS_MAX}</span>
            </div>
          </section>
        </>
      ) : (
        <p className="rounded-2xl bg-panel p-4 text-xl text-muted ring-1 ring-line">Toque no tipo do problema: as sugestões e o teclado aparecem na hora.</p>
      )}

      <section aria-label="Condição da máquina" className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <button aria-pressed={impacto === "PARADA"} onClick={() => setImpacto("PARADA")}
          className={`min-h-tap-lg rounded-3xl px-3 text-xl font-extrabold ring-4 md:text-2xl ${impacto === "PARADA" ? "bg-red-700 text-white ring-fg" : "bg-red-50 text-red-900 ring-red-300"}`}>
          {impacto === "PARADA" ? "✓ " : ""}🔴 {predial ? "IMPEDE O USO / RISCO" : "MÁQUINA TOTALMENTE PARADA"}
        </button>
        <button aria-pressed={impacto === "OPERANDO"} onClick={() => setImpacto("OPERANDO")}
          className={`min-h-tap-lg rounded-3xl px-3 text-xl font-extrabold ring-4 md:text-2xl ${impacto === "OPERANDO" ? "bg-yellow-500 text-black ring-fg" : "bg-yellow-50 text-yellow-900 ring-yellow-400"}`}>
          {impacto === "OPERANDO" ? "✓ " : ""}🟡 {predial ? "FUNCIONA COM FALHA / REPARO NÃO URGENTE" : "MÁQUINA OPERANDO COM FALHA"}
        </button>
      </section>

      {!ok && <p role="status" className="text-lg text-muted">Falta informar: {pendencias.join(", ")}.</p>}
      {(() => {
        const continuar = (
          <button disabled={!ok} onClick={() => ok && onNext({ impacto, categoria, sintomas, observacao, tipo, chips, texto })}
            className={`${btnPrimary} bg-brand-600 text-white`}>Continuar →</button>
        );
        // Com tipo escolhido há teclado: ele fica ancorado na base e "Continuar" logo acima dele (RN-64).
        return tipo
          ? <DockTeclado acao={continuar}><VirtualKeyboard value={texto} onChange={setTexto} maxLength={OBS_MAX} /></DockTeclado>
          : <div className="mt-auto">{continuar}</div>;
      })()}
    </Screen>
  );
}
