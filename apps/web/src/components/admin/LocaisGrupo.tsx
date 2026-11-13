"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, atualizarLocal, criarLocal, excluirLocal, listarLocais, listarSetoresAdmin, reordenarLocais } from "@/lib/api";
import type { SetorAdmin, SetorLocal } from "@/lib/types";
import { ConfirmarAcao } from "../ui/ConfirmarAcao";
import { Dialogo } from "../ui/Dialogo";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { btnPerigo, btnPrim, btnSec, campo } from "../ui/estilos";

const LOCAL_MAX = 60;
const limpar = (v: string) => v.trim().replace(/\s+/g, " ");

function mensagemErro(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "Sem conexão com o servidor.";
    if (e.status === 403) return "Apenas administradores podem gerenciar os locais.";
    if (e.status >= 500) return "Erro no servidor. Tente novamente em instantes.";
    return e.message; // LOCAL_DUPLICADO… já vêm legíveis
  }
  return "Erro inesperado.";
}

/**
 * Locais padrão do grupo Moldes e Predial (US-16). Os aliases `/grupos-ativos/:id/locais*` ainda não existem no Back-end (pendência do handoff):
 * usa `/setores/:id/locais*` do setor predial, resolvido aqui. Trocar para os aliases é só mudar as 5 chamadas de api.ts.
 */
export function LocaisGrupo({ nomeGrupo, onFechar }: { nomeGrupo: string; onFechar: () => void }) {
  const [setor, setSetor] = useState<SetorAdmin | null>(null);
  const [erroSetor, setErroSetor] = useState<string | null>(null);
  useEffect(() => {
    listarSetoresAdmin().then((l) => {
      const p = l.find((x) => x.predial);
      if (p) setSetor(p); else setErroSetor("Setor predial não encontrado.");
    }).catch((e) => setErroSetor(mensagemErro(e)));
  }, []);
  if (setor) return <LocaisPadrao setor={setor} titulo={nomeGrupo} onFechar={onFechar} />;
  return (
    <Dialogo titulo={`Locais padrão · ${nomeGrupo}`} onFechar={onFechar} largura="max-w-2xl">
      {erroSetor ? <Faixa tipo="erro">{erroSetor}</Faixa> : <p className="text-muted">Carregando…</p>}
      <div className="mt-4 flex justify-end"><button onClick={onFechar} className={btnSec}>Fechar</button></div>
    </Dialogo>
  );
}

/** Locais padrão do setor predial: lista, adicionar, renomear, ativar/desativar, excluir e reordenar por ▲▼. */
function LocaisPadrao({ setor, titulo, onFechar }: { setor: SetorAdmin; titulo: string; onFechar: () => void }) {
  const [itens, setItens] = useState<SetorLocal[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [novo, setNovo] = useState("");
  const [edit, setEdit] = useState<{ id: string; nome: string } | null>(null);
  const [excluir, setExcluir] = useState<SetorLocal | null>(null);

  const carregar = useCallback(() => {
    listarLocais(setor.id).then((l) => { setItens(l); setErro(null); }).catch((e) => { setItens((p) => p ?? []); setErro(mensagemErro(e)); });
  }, [setor.id]);
  useEffect(() => { carregar(); }, [carregar]);

  async function agir(fn: () => Promise<unknown>) {
    setBusy(true); setErro(null);
    try { await fn(); carregar(); return true; } catch (e) { setErro(mensagemErro(e)); return false; } finally { setBusy(false); }
  }
  async function adicionar(e: FormEvent) {
    e.preventDefault();
    const n = limpar(novo);
    if (!n || n.length > LOCAL_MAX) return;
    if (await agir(() => criarLocal(setor.id, n))) setNovo("");
  }
  async function mover(i: number, d: -1 | 1) {
    if (!itens) return;
    const j = i + d;
    if (j < 0 || j >= itens.length) return;
    const ids = itens.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setItens(ids.map((id) => itens.find((x) => x.id === id) as SetorLocal)); // otimista; recarrega ao final
    await agir(() => reordenarLocais(setor.id, ids));
  }
  async function renomear(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const n = limpar(edit.nome);
    if (!n || n.length > LOCAL_MAX) return;
    if (await agir(() => atualizarLocal(setor.id, edit.id, { nome: n }))) setEdit(null);
  }

  return (
    <Dialogo titulo={`Locais padrão · ${titulo}`} onFechar={onFechar} travado={busy} largura="max-w-2xl">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">São os botões rápidos &quot;Onde é o problema?&quot; do Totem. Renomear ou excluir um local não altera as OMs já abertas (elas guardam o texto).</p>
        {erro && <Faixa tipo="erro">{erro}</Faixa>}
        {!itens ? <p className="text-muted">Carregando…</p> : itens.length === 0 ? <p className="rounded-xl bg-brand-50 p-4 text-muted">Nenhum local. O Totem mostrará só o campo de texto livre.</p> : (
          <ul className="flex flex-col divide-y divide-line/40 rounded-xl ring-1 ring-line dark:divide-line-soft">
            {itens.map((l, i) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 p-2">
                <div className="flex flex-col">
                  <button disabled={busy || i === 0} onClick={() => void mover(i, -1)} aria-label={`Subir ${l.nome}`} className="min-h-6 rounded px-2 text-sm leading-none hover:bg-brand-50 disabled:opacity-30">▲</button>
                  <button disabled={busy || i === itens.length - 1} onClick={() => void mover(i, 1)} aria-label={`Descer ${l.nome}`} className="min-h-6 rounded px-2 text-sm leading-none hover:bg-brand-50 disabled:opacity-30">▼</button>
                </div>
                {edit?.id === l.id ? (
                  <form onSubmit={renomear} className="flex min-w-0 flex-1 gap-2">
                    <input autoFocus value={edit.nome} onChange={(e) => setEdit({ id: l.id, nome: e.target.value })} maxLength={LOCAL_MAX} aria-label={`Novo nome do local ${l.nome}`} className={`${campo} min-w-0 flex-1`} />
                    <button type="submit" disabled={busy || !limpar(edit.nome)} className={`${btnPrim} min-h-11 px-3`}>Salvar</button>
                    <button type="button" onClick={() => setEdit(null)} className={`${btnSec} min-h-11 px-3`}>Cancelar</button>
                  </form>
                ) : (
                  <>
                    <span className={`min-w-0 flex-1 truncate font-semibold ${l.ativo ? "" : "text-muted line-through"}`}>{l.nome}</span>
                    {!l.ativo && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-800">Inativo</span>}
                    <button disabled={busy} onClick={() => setEdit({ id: l.id, nome: l.nome })} aria-label={`Renomear ${l.nome}`} className={`${btnSec} min-h-11 px-3 text-sm`}><Icone nome="editar" className="h-4 w-4" /></button>
                    <button disabled={busy} onClick={() => void agir(() => atualizarLocal(setor.id, l.id, { ativo: !l.ativo }))} aria-label={`${l.ativo ? "Desativar" : "Ativar"} local ${l.nome}`} className={`${btnSec} min-h-11 px-3 text-sm`}>{l.ativo ? "Desativar" : "Ativar"}</button>
                    <button disabled={busy} onClick={() => setExcluir(l)} aria-label={`Excluir local ${l.nome}`} className={`${btnPerigo} min-h-11 px-3 text-sm`}><Icone nome="lixeira" className="h-4 w-4" /></button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={adicionar} className="flex gap-2">
          <input value={novo} onChange={(e) => setNovo(e.target.value)} maxLength={LOCAL_MAX} placeholder="Novo local (ex.: Almoxarifado)" aria-label="Novo local" disabled={busy} className={`${campo} min-w-0 flex-1`} />
          <button type="submit" disabled={busy || !limpar(novo)} className={btnPrim}><Icone nome="mais" />Adicionar</button>
        </form>
        <div className="flex justify-end"><button onClick={onFechar} disabled={busy} className={btnSec}>Fechar</button></div>
      </div>
      {excluir && (
        <ConfirmarAcao titulo="Excluir local?" rotuloConfirmar="Excluir" busy={busy} onCancelar={() => setExcluir(null)}
          onConfirmar={async () => { const ok = await agir(() => excluirLocal(setor.id, excluir.id)); if (ok) setExcluir(null); }}>
          <p><strong>{excluir.nome}</strong> deixa de aparecer no Totem. As OMs já abertas mantêm o texto do local.</p>
        </ConfirmarAcao>
      )}
    </Dialogo>
  );
}
