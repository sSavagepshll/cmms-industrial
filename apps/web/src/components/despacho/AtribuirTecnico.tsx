"use client";
import { useEffect, useMemo, useState } from "react";
import { ApiError, atribuirOm, listarTecnicos } from "@/lib/api";
import { PRIORIDADE } from "@/lib/kanban";
import type { Prioridade, TecnicoCarga } from "@/lib/types";
import { Dialogo } from "../ui/Dialogo";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { btnPrim, btnSec, campo } from "../ui/estilos";

/** O mínimo que o diálogo precisa saber da OM (Despacho, Ordens e Kanban têm formatos diferentes). */
export interface OmParaAtribuir {
  id: string;
  numero: string;
  prioridade: Prioridade;
  /** Fase 35: setor fiel ao ativo (`setorDaOm`). */
  setorExibicao?: string;
  equipamento: { codigo: string; nome: string; setor?: string };
  /** Preenchido = OM já reservada: o diálogo vira "Reatribuir" e exige motivo. */
  reservadaPara?: { id: string; nome: string } | null;
  /** Técnico que recusou esta OM: aparece desabilitado ("recusou esta OM"). */
  recusouId?: string | null;
}

export interface Atribuicao { tecnico: TecnicoCarga; reatribuicao: boolean }

function mensagemErro(e: unknown): { texto: string; atualizar: boolean } {
  if (e instanceof ApiError) {
    if (e.status === 0) return { texto: "Sem conexão com o servidor.", atualizar: false };
    if (e.status === 403) return { texto: "Seu perfil não pode atribuir OMs.", atualizar: false };
    if (e.code === "OM_NAO_DISPONIVEL") return { texto: "Esta OM acabou de ser atribuída ou assumida por outra pessoa, ou mudou de situação.", atualizar: true };
    if (e.code === "TECNICO_INVALIDO") return { texto: "Este usuário não é um técnico ativo.", atualizar: false };
    return { texto: e.message, atualizar: false };
  }
  return { texto: "Erro inesperado.", atualizar: false };
}

/**
 * Diálogo único "Atribuir técnico" / "Reatribuir" (docs/ux/fase17 §2.3). Atribuir RESERVA a OM: ela continua ABERTA
 * até o técnico assumir com o PIN. Lista só técnicos ativos, com carga. O botão primário repete o nome escolhido.
 * `grande`: alvos de luva (Kanban do técnico/totem).
 */
export function AtribuirTecnico({ om, onFechar, onAtribuido, onAtualizar, grande = false }: {
  om: OmParaAtribuir; onFechar: () => void; onAtribuido: (a: Atribuicao) => void; onAtualizar?: () => void; grande?: boolean;
}) {
  const [tecnicos, setTecnicos] = useState<TecnicoCarga[] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<{ texto: string; atualizar: boolean } | null>(null);
  const reatribuir = !!om.reservadaPara;
  const p = PRIORIDADE[om.prioridade];

  function carregar() {
    setErroLista(null);
    listarTecnicos().then((l) => {
      setTecnicos(l);
      // Pré-seleciona o técnico mais livre (sem ser o atual); o botão repete o nome, então o erro é visível.
      const livres = l.filter((t) => t.id !== om.reservadaPara?.id && t.id !== om.recusouId).sort((a, b) => (a.emAtendimento + a.reservadas) - (b.emAtendimento + b.reservadas));
      setSelId((atual) => atual && l.some((t) => t.id === atual) ? atual : livres[0]?.id ?? null);
    }).catch((e) => { setTecnicos([]); setErroLista(mensagemErro(e).texto); });
  }
  useEffect(carregar, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = useMemo(() => tecnicos?.find((t) => t.id === selId) ?? null, [tecnicos, selId]);
  const motivoOk = !reatribuir || motivo.trim().length >= 5;
  const pode = !!sel && motivoOk && !busy;

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!pode || !sel) return;
    setBusy(true); setErro(null);
    try {
      await atribuirOm(om.id, sel.id, reatribuir ? motivo.trim() : undefined);
      onAtribuido({ tecnico: sel, reatribuicao: reatribuir });
    } catch (err) {
      const m = mensagemErro(err);
      setErro(m); setBusy(false);
      if (err instanceof ApiError && err.code === "TECNICO_INVALIDO") carregar();
    }
  }

  const alvo = grande ? "min-h-16 md:min-h-tap-md" : "min-h-14";
  return (
    <Dialogo titulo={reatribuir ? "Reatribuir técnico" : "Atribuir técnico"} onFechar={onFechar} travado={busy} largura="max-w-xl">
      <form onSubmit={confirmar} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="tabular-nums">{om.numero}</strong>
          <span className={`rounded-full px-3 py-0.5 text-sm font-extrabold ${p.cls}`}>{p.label}</span>
          <span className="text-muted">{om.equipamento.codigo} · {om.equipamento.nome}{(om.setorExibicao ?? om.equipamento.setor) ? ` · ${om.setorExibicao ?? om.equipamento.setor}` : ""}</span>
        </div>
        {reatribuir && <Faixa tipo="atencao">Reservada para {om.reservadaPara?.nome}. Informe o motivo da troca.</Faixa>}

        <fieldset className="flex flex-col gap-2" disabled={busy}>
          <legend className="mb-1 font-semibold">Escolha o técnico</legend>
          {!tecnicos && <p className="text-muted">Carregando técnicos…</p>}
          {erroLista && <Faixa tipo="erro">{erroLista} <button type="button" onClick={carregar} className="ml-1 underline">Tentar novamente</button></Faixa>}
          {tecnicos && tecnicos.length === 0 && !erroLista && (
            <Faixa tipo="atencao">Nenhum técnico ativo. Cadastre em Configurações, aba Usuários (perfil Técnico).</Faixa>
          )}
          {tecnicos?.map((t) => {
            const recusou = t.id === om.recusouId;
            const atual = t.id === om.reservadaPara?.id || recusou;
            return (
              <label key={t.id} className={`flex ${alvo} cursor-pointer items-center gap-3 rounded-xl px-3 ring-2 ${selId === t.id ? "bg-brand-50 ring-primary-fg" : "bg-panel ring-line"} ${atual ? "cursor-not-allowed opacity-60" : ""}`}>
                <input type="radio" name="tecnico" value={t.id} checked={selId === t.id} disabled={atual} onChange={() => setSelId(t.id)} className="h-5 w-5 accent-brand-600" />
                <span className="min-w-0 flex-1">
                  <span className="font-bold">{t.nome}</span>{atual && <span className="ml-2 text-sm text-muted">{recusou ? "(recusou esta OM)" : "(reservada para ele)"}</span>}
                  <span className="block text-sm text-muted">
                    {t.situacao === "DISPONIVEL" ? "● Disponível" : "● Em atendimento"} · {t.emAtendimento} em atend. · {t.reservadas} reserv.{t.cronometroAtivo ? " · cronômetro ativo" : ""}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {reatribuir && (
          <label className="flex flex-col gap-1"><span className="font-semibold">Motivo da reatribuição *</span>
            <input value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} placeholder="Mínimo 5 caracteres" className={campo} />
            {motivo.length > 0 && motivo.trim().length < 5 && <span className="text-sm font-semibold text-red-800">Informe ao menos 5 caracteres.</span>}
          </label>
        )}

        <p className="flex items-start gap-2 rounded-xl bg-brand-50 p-3 text-sm text-primary-fg"><Icone nome="info" className="mt-0.5 h-5 w-5" /><span className="min-w-0 flex-1">O técnico é avisado na hora. A OM continua <strong>ABERTA</strong> até ele assumir com o PIN.</span></p>

        {erro && (
          <Faixa tipo="erro">{erro.texto}{erro.atualizar && <> <button type="button" onClick={() => { onAtualizar?.(); onFechar(); }} className="ml-1 underline">Atualizar</button></>}</Faixa>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onFechar} disabled={busy} className={btnSec}>Cancelar</button>
          <button type="submit" disabled={!pode} className={btnPrim}>{busy ? "Atribuindo…" : sel ? `${reatribuir ? "Reatribuir" : "Atribuir"} a ${sel.nome}` : "Escolha um técnico"}</button>
        </div>
      </form>
    </Dialogo>
  );
}
