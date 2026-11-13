"use client";
import { useEffect, useState } from "react";
import { listarEquipamentos, listarGrupos, listarLocaisPrediais, omAbertaDoEquipamento } from "@/lib/api";
import { ICONES_GRUPO } from "@/lib/constants";
import type { Equipamento, GrupoAtivo, LocalPredial, OmAberta, Operador } from "@/lib/types";
import { Modal, Screen } from "./ui";
import { Botao } from "../ui/Botao";
import { Card } from "../ui/Card";
import { BuscaTag } from "./BuscaTag";
import { StepLocal } from "./StepLocal";

/**
 * Escolha do equipamento (US-15/16): 1º nível = os 4 grupos de GET /equipamentos/grupos; 2º nível = equipamentos do grupo com a busca de
 * TAG minimizada (RN-48). Fase 35: 4 áreas (Produtivos, Improdutivos, Moldes, Predial e Outros); PREDIAL_OUTROS lista o card predial (locais) e o card de item avulso (`onItemLivre`).
 */
export function StepEquipment({ user, onSelect, onItemLivre, onComplement, onBack }: {
  user: Operador;
  onSelect: (e: Equipamento, confirmarDuplicidade: boolean, local?: string) => void;
  onItemLivre: (equipamentoId: string, grupo: GrupoAtivo) => void;
  onComplement: (e: Equipamento, om: OmAberta) => void;
  onBack: () => void;
}) {
  const [grupos, setGrupos] = useState<GrupoAtivo[] | null>(null);
  const [grupo, setGrupo] = useState<GrupoAtivo | null>(null);
  const [equips, setEquips] = useState<Equipamento[]>([]);
  const [filtrados, setFiltrados] = useState<Equipamento[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dup, setDup] = useState<{ equip: Equipamento; om: OmAberta; local?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  // Pseudo-ativo predial escolhido, aguardando o local; os locais padrão vêm de GET /equipamentos/locais (só carrega se necessário).
  const [predial, setPredial] = useState<Equipamento | null>(null);
  const [locais, setLocais] = useState<LocalPredial[] | null>(null);

  const falha = () => setMsg("Não foi possível carregar os dados. Tente novamente.");

  useEffect(() => { listarGrupos().then(setGrupos).catch(falha); }, []);
  useEffect(() => {
    if (!grupo) return;
    setLoading(true); setMsg(null); setFiltrados(null);
    listarEquipamentos({ grupo: grupo.codigo }).then(setEquips).catch(falha).finally(() => setLoading(false));
  }, [grupo]);

  async function pedirLocal(e: Equipamento) {
    try { if (!locais) setLocais(await listarLocaisPrediais()); setPredial(e); } catch { falha(); }
  }

  async function choose(e: Equipamento, local?: string) {
    if (e.predial && !local) { void pedirLocal(e); return; } // card predial: pede o local antes
    try {
      // US-02 Cenário 2 / RN-04: só consulta OMs quando a listagem indica OM ativa (predial: só no mesmo local)
      const om = e.omsAtivas > 0 ? await omAbertaDoEquipamento(e.id, { local: e.predial ? local : undefined }) : null;
      if (om) setDup({ equip: e, om, local });
      else onSelect(e, false, local);
    } catch { falha(); }
  }

  const abrirGrupo = (g: GrupoAtivo) => setGrupo(g);

  if (predial) {
    return <StepLocal locais={(locais ?? []).map((l) => l.nome)} onBack={() => { setPredial(null); setMsg(null); }}
      onConfirmar={(l) => { const e = predial; setPredial(null); void choose(e, l); }} />;
  }

  const hora = dup && new Date(dup.om.dataAbertura).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <Screen title={`Olá, ${user.nome}`} subtitle={grupo ? `${grupo.nome}: toque no equipamento com defeito` : "Selecione o tipo de equipamento com defeito"}
      onBack={grupo ? () => { setGrupo(null); setMsg(null); } : onBack} passo={3}>
      {msg && <p role="alert" className="text-xl font-semibold text-danger-fg">{msg}</p>}
      {!grupo ? (
        !grupos && !msg ? <p className="text-2xl" aria-live="polite">Carregando…</p> : (
          <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 md:gap-5">
            {(grupos ?? []).map((g) => (
              <button key={g.codigo} onClick={() => abrirGrupo(g)}
                className="cursor-pointer disabled:cursor-not-allowed flex min-h-36 flex-col items-center justify-center gap-2 rounded-3xl bg-brand-700 p-4 text-center text-white ring-1 ring-brand-600 md:min-h-44">
                <span aria-hidden className="text-5xl md:text-6xl">{ICONES_GRUPO[g.codigo] ?? "📦"}</span>
                <span className="text-2xl font-extrabold md:text-3xl">{g.nome}</span>
                <span className="text-lg font-semibold opacity-80 md:text-xl">
                  {g.codigo === "PREDIAL_OUTROS" ? "Predial e item avulso" : g.total > 0 ? `${g.total} ${g.total === 1 ? "equipamento" : "equipamentos"}` : "Nenhum equipamento"}
                </span>
              </button>
            ))}
          </div>
        )
      ) : loading ? (
        <p className="text-2xl" aria-live="polite">Carregando…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {(filtrados ?? equips).map((e) => e.itemLivre ? (
              <Card como="button" key={e.id} variante="interativo" tom="destaque" espaco="lg" onClick={() => onItemLivre(e.id, grupo)}
                className="flex min-h-[120px] flex-col items-start justify-center gap-1 text-primary-fg">
                <span className="text-2xl font-extrabold">📦 Item não cadastrado / Avulso</span>
                <span className="text-lg font-semibold text-muted">Toque para descrever o item</span>
              </Card>
            ) : e.predial ? (
              <Card como="button" key={e.id} variante="interativo" tom="destaque" espaco="lg" onClick={() => choose(e)}
                className="flex min-h-[120px] flex-col items-start justify-center gap-1 text-primary-fg">
                <span className="text-2xl font-extrabold">🏢 Manutenção Predial / Infraestrutura</span>
                <span className="text-lg font-semibold text-muted">Toque para informar o local</span>
              </Card>
            ) : (
              <Card como="button" key={e.id} variante="interativo" espaco="lg" onClick={() => choose(e)}
                className="flex min-h-[120px] flex-col items-start gap-2">
                <span className="text-lg font-bold text-primary-fg">{e.codigo}</span>
                <span className="text-2xl font-extrabold">{e.nome}</span>
                <span className="mt-auto flex items-center gap-2 text-lg text-muted">
                  <span className={`h-5 w-5 rounded-full ${e.omsAtivas > 0 ? "bg-red-500" : "bg-green-500"}`} aria-hidden />
                  {e.omsAtivas > 0 ? `${e.omsAtivas} OM em aberto` : "Sem OM em aberto"}
                </span>
              </Card>
            ))}
          </div>
          {equips.length === 0 && <p className="text-2xl">Nenhum equipamento cadastrado neste grupo. Fale com a manutenção.</p>}
          {equips.length > 0 && grupo.codigo !== "PREDIAL_OUTROS" && <BuscaTag grupo={grupo.codigo} desativada={!!dup} onSelecionar={(e) => void choose(e)} onFiltrar={setFiltrados} />}
        </>
      )}

      {dup && (
        <Modal label="Atenção: OM já aberta">
          <p className="text-2xl font-extrabold text-amber-800 md:text-3xl">⚠️ Atenção</p>
          <p className="mt-4 text-xl leading-relaxed md:text-2xl">
            {dup.equip.predial ? `O local ${dup.local}` : `A máquina ${dup.equip.nome} (${dup.equip.codigo})`} já possui a OM {dup.om.numero} em aberto pelo operador {dup.om.solicitante.nome} às {hora}.
            Deseja ver a OM existente ou abrir uma nova solicitação?
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Botao tamanho="toque" variante="primario" onClick={() => onComplement(dup.equip, dup.om)}>Ver OM Existente</Botao>
            <Botao tamanho="toque" variante="alerta" onClick={() => onSelect(dup.equip, true, dup.local)}>Abrir Nova OM Mesmo Assim</Botao>
            <Botao tamanho="toque" onClick={() => setDup(null)}>Voltar</Botao>
          </div>
        </Modal>
      )}
    </Screen>
  );
}
