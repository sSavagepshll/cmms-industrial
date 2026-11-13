"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, listarMateriais, removerMaterial } from "@/lib/api";
import type { Material } from "@/lib/types";
import { btnBase } from "../kiosk/ui";
import { MaterialForm } from "./MaterialForm";

const Sim = ({ v, rotulo }: { v?: boolean; rotulo: string }) =>
  v ? <span aria-label={`${rotulo}: sim`}>✓</span> : <span aria-label={`${rotulo}: não`} className="text-muted">—</span>;

/** Aba Materiais: tabela QDE / UNIDADE / DESCRIÇÃO / INTER. / CONF. N.F. do verso do formulário. */
export function MateriaisTab({ omId, podeEditar, refreshKey, onChanged }: {
  omId: string; podeEditar: boolean; refreshKey: number; onChanged: () => void;
}) {
  const [itens, setItens] = useState<Material[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abrir, setAbrir] = useState(false);
  const [removendo, setRemovendo] = useState<string | null>(null); // 2 toques para remover

  const carregar = useCallback(() => {
    listarMateriais(omId).then((r) => { setItens(r.itens); setErro(null); })
      .catch((e) => { setItens([]); setErro(e instanceof ApiError && e.status === 403 ? "Seu perfil não pode ver os materiais." : "Não foi possível carregar os materiais."); });
  }, [omId]);
  useEffect(carregar, [carregar, refreshKey]);

  async function remover(id: string) {
    try { await removerMaterial(omId, id); setRemovendo(null); carregar(); onChanged(); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Erro ao remover."); }
  }

  return (
    <section aria-label="Materiais" className="flex flex-col gap-3">
      <h3 className="text-2xl font-extrabold">Materiais {itens && `(${itens.length})`}</h3>
      {erro && <p role="alert" className="rounded-xl bg-red-700 text-white p-3 text-xl font-semibold">{erro}</p>}
      {!itens ? <p className="text-xl text-muted">Carregando…</p> : itens.length === 0 ? (
        <p className="text-xl text-muted">Nenhum material lançado.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
          <table className="w-full min-w-[36rem] text-left text-lg tabular-nums md:text-xl">
            <thead className="bg-panel text-muted">
              <tr><th className="p-3">Qtde</th><th className="p-3">Un.</th><th className="p-3">Descrição</th><th className="p-3 text-center">Inter.</th><th className="p-3 text-center">Conf. N.F.</th>{podeEditar && <th className="p-3"><span className="sr-only">Ações</span></th>}</tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-line-soft">
              {itens.map((m) => (
                <tr key={m.id}>
                  <td className="p-3 font-bold">{String(m.quantidade).replace(".", ",")}</td>
                  <td className="p-3">{m.unidade}</td>
                  <td className="p-3">{m.descricao}</td>
                  <td className="p-3 text-center text-2xl font-black"><Sim v={m.flagInterno} rotulo="Interno" /></td>
                  <td className="p-3 text-center text-2xl font-black"><Sim v={m.confNf} rotulo="NF conferida" /></td>
                  {podeEditar && (
                    <td className="p-2 text-right">
                      {removendo === m.id ? (
                        <span className="inline-flex gap-2">
                          <button onClick={() => remover(m.id)} className="min-h-14 rounded-xl bg-red-700 text-white px-4 font-bold">Remover?</button>
                          <button onClick={() => setRemovendo(null)} className="min-h-14 rounded-xl bg-ink px-4 ring-1 ring-line">Não</button>
                        </span>
                      ) : (
                        <button onClick={() => setRemovendo(m.id)} aria-label={`Remover ${m.descricao}`} className="min-h-14 min-w-14 rounded-xl bg-ink text-2xl ring-1 ring-line">🗑</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {podeEditar && <button onClick={() => setAbrir(true)} className={`${btnBase} bg-brand-700 text-white`}>＋ Adicionar material</button>}
      {abrir && <MaterialForm omId={omId} onCancel={() => setAbrir(false)} onSaved={() => { setAbrir(false); carregar(); onChanged(); }} />}
    </section>
  );
}
