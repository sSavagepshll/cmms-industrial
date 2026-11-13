"use client";
import { useEffect, useRef, useState } from "react";
import { omAbertaDoEquipamento } from "@/lib/api";
import type { Equipamento, OmAberta } from "@/lib/types";
import { DockTeclado, Modal, Screen } from "./ui";
import { Botao } from "../ui/Botao";
import { VirtualKeyboard } from "./VirtualKeyboard";

export const ITEM_MIN = 3, ITEM_MAX = 100;
/** Espaços colapsados e aparados (mesma normalização do servidor). */
export const normalizarItem = (v: string) => v.trim().replace(/\s+/g, " ");

/**
 * Grupo "Outros" (US-16): item sem cadastro, descrito em texto livre (3–100). Sem busca de TAG nem lista de máquinas.
 * Antes de avançar consulta a duplicidade (RN-04) pelo mesmo texto normalizado.
 */
export function StepItemLivre({ equip, initial, onNext, onComplement, onBack }: {
  equip: Equipamento; initial?: string; onNext: (item: string, confirmarDuplicidade: boolean) => void;
  onComplement: (item: string, om: OmAberta) => void; onBack: () => void;
}) {
  const [texto, setTexto] = useState(initial ?? "");
  const [dup, setDup] = useState<{ item: string; om: OmAberta } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const campo = useRef<HTMLDivElement>(null);
  useEffect(() => { campo.current?.scrollIntoView({ block: "nearest" }); }, [texto]);
  const item = normalizarItem(texto);
  const ok = item.length >= ITEM_MIN && item.length <= ITEM_MAX;

  async function continuar() {
    if (!ok) { setAviso(`Informe o que está com defeito (mínimo de ${ITEM_MIN} caracteres)`); return; }
    if (busy) return;
    setBusy(true); setAviso(null);
    try {
      const om = await omAbertaDoEquipamento(equip.id, { item });
      if (om) setDup({ item, om }); else onNext(item, false);
    } catch { setAviso("Não foi possível verificar chamados abertos. Tente novamente."); }
    finally { setBusy(false); }
  }

  const hora = dup && new Date(dup.om.dataAbertura).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <Screen title="Item não cadastrado" subtitle="O que está com defeito?" onBack={onBack} passo={3} passoCompacto>
      <section aria-label="Descrição do item">
        <div ref={campo} aria-live="polite" style={{ scrollMarginBottom: "50dvh" }} className="min-h-[72px] rounded-2xl bg-panel p-4 text-xl ring-2 ring-brand-600 md:text-2xl">
          {texto || <span className="text-muted">Ex.: carrinho de transporte, bancada 3, furadeira de mão…</span>}
          <span className="float-right text-lg text-muted">{item.length}/{ITEM_MAX}</span>
        </div>
      </section>
      {aviso && <p role="alert" className="text-xl font-semibold text-danger-fg">{aviso}</p>}
      <DockTeclado acao={
        <Botao tamanho="totem" desabilitadoSuave={!ok || busy} onClick={() => void continuar()} variante="primario">
          {busy ? "Verificando…" : "Continuar →"}
        </Botao>}>
        <VirtualKeyboard value={texto} onChange={(v) => { setAviso(null); setTexto(v); }} maxLength={ITEM_MAX} fisico={!dup} onEnter={() => void continuar()} />
      </DockTeclado>

      {dup && (
        <Modal label="Atenção: OM já aberta">
          <p className="text-2xl font-extrabold text-amber-800 md:text-3xl">⚠️ Atenção</p>
          <p className="mt-4 text-xl leading-relaxed md:text-2xl">
            O item &quot;{dup.item}&quot; já possui a OM {dup.om.numero} em aberto pelo operador {dup.om.solicitante.nome} às {hora}.
            Deseja ver a OM existente ou abrir uma nova solicitação?
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Botao tamanho="toque" variante="primario" onClick={() => onComplement(dup.item, dup.om)}>Ver OM Existente</Botao>
            <Botao tamanho="toque" variante="alerta" onClick={() => onNext(dup.item, true)}>Abrir Nova OM Mesmo Assim</Botao>
            <Botao tamanho="toque" onClick={() => setDup(null)}>Voltar</Botao>
          </div>
        </Modal>
      )}
    </Screen>
  );
}
