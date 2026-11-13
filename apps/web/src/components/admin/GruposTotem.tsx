"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, atualizarGrupo, listarGruposAdmin } from "@/lib/api";
import { ICONES_GRUPO } from "@/lib/constants";
import type { GrupoAtivoAdmin } from "@/lib/types";
import { Dialogo } from "../ui/Dialogo";
import { EquipamentosGrupo } from "./EquipamentosGrupo";
import { LocaisGrupo } from "./LocaisGrupo";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { btnPrim, btnSec, campo } from "../ui/estilos";

const NOME_MAX = 60;
/** PREDIAL_OUTROS (predial + item avulso) é reservado: sem equipamentos cadastráveis. */
const reservado = (g: GrupoAtivoAdmin) => !!g.reservado || g.codigo === "PREDIAL_OUTROS";
const limpar = (v: string) => v.trim().replace(/\s+/g, " ");

function mensagemErro(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "Sem conexão com o servidor.";
    if (e.status === 403) return "Apenas administradores podem gerenciar os grupos.";
    if (e.status >= 500) return "Erro no servidor. Tente novamente em instantes.";
    if (e.code === "GRUPO_NOME_DUPLICADO") return "Já existe um grupo com este nome.";
    return e.message;
  }
  return "Erro inesperado.";
}

/** Grupos do Totem (ADMIN, Fase 30/31): hub dos 4 grupos da primeira tela do Totem (nome e ordem editáveis) e da gestão de equipamentos e locais por grupo. */
export function GruposTotem() {
  const [lista, setLista] = useState<GrupoAtivoAdmin[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [edit, setEdit] = useState<GrupoAtivoAdmin | null>(null);
  const [equips, setEquips] = useState<GrupoAtivoAdmin | null>(null);
  const [locais, setLocais] = useState<GrupoAtivoAdmin | null>(null);

  const carregar = useCallback(() => {
    listarGruposAdmin().then((l) => { setLista([...l].sort((a, b) => a.ordem - b.ordem)); setErro(null); })
      .catch((e) => { if (e instanceof ApiError && e.status === 401) return; setLista((p) => p ?? []); setErro(mensagemErro(e)); });
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <section aria-label="Grupos do Totem" className="flex flex-col gap-3">
      <header>
        <h3 className="text-xl font-extrabold">Grupos do Totem</h3>
        <p className="text-muted">Os 4 grupos da primeira tela do Totem (&quot;Selecione o tipo de equipamento com defeito&quot;). São fixos: só o nome e a ordem podem mudar. Os equipamentos são cadastrados dentro de cada grupo (botão Equipamentos).</p>
      </header>
      {aviso && <Faixa tipo="ok">{aviso}</Faixa>}
      {erro && <Faixa tipo="erro">{erro}</Faixa>}
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        {!lista ? <p className="p-6 text-muted">Carregando…</p> : (
          <table className="w-full min-w-[36rem] text-left">
            <caption className="sr-only">Grupos do Totem</caption>
            <thead className="bg-brand-50 text-sm uppercase tracking-wide text-muted">
              <tr><th scope="col" className="p-3">Ordem</th><th scope="col" className="p-3">Nome</th><th scope="col" className="p-3 text-right">Equipamentos</th><th scope="col" className="p-3">Ações</th></tr>
            </thead>
            <tbody className="divide-y divide-line/40 dark:divide-line-soft">
              {lista.map((g) => (
                <tr key={g.id} className="align-middle hover:bg-brand-50">
                  <td className="p-3 tabular-nums">{g.ordem}</td>
                  <td className="p-3 font-semibold"><span aria-hidden className="mr-2">{ICONES_GRUPO[g.codigo] ?? "📦"}</span>{g.nome}</td>
                  <td className="p-3 text-right tabular-nums">{reservado(g) ? "—" : <>{g.equipamentos}<span className="text-sm text-muted"> ({g.equipamentosAtivos} ativos)</span></>}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => { setAviso(null); setEdit(g); }} aria-label={`Editar grupo ${g.nome}`} className={`${btnSec} min-h-11 px-3 text-sm`}><Icone nome="editar" className="h-4 w-4" />Editar</button>
                      {!reservado(g) && <button onClick={() => { setAviso(null); setEquips(g); }} aria-label={`Equipamentos do grupo ${g.nome}`} className={`${btnSec} min-h-11 px-3 text-sm`}>Equipamentos ({g.equipamentos})</button>}
                      {g.codigo === "PREDIAL_OUTROS" && <button onClick={() => { setAviso(null); setLocais(g); }} aria-label="Locais padrão da manutenção predial" className={`${btnSec} min-h-11 px-3 text-sm`}><Icone nome="pino" className="h-4 w-4" />Locais padrão</button>}
                    </div>
                    {reservado(g) && <p className="mt-1 max-w-xs text-xs text-muted">Reservado a itens não cadastrados (texto livre).</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {equips && <EquipamentosGrupo grupo={lista?.find((x) => x.id === equips.id) ?? equips} grupos={lista ?? []} onFechar={() => setEquips(null)} onMudou={carregar} />}
      {locais && <LocaisGrupo nomeGrupo={locais.nome} onFechar={() => setLocais(null)} />}
      {edit && <GrupoForm grupo={edit} onFechar={() => setEdit(null)} onSalvo={(m) => { setEdit(null); setErro(null); setAviso(m); carregar(); }} />}
    </section>
  );
}

function GrupoForm({ grupo, onFechar, onSalvo }: { grupo: GrupoAtivoAdmin; onFechar: () => void; onSalvo: (msg: string) => void }) {
  const [nome, setNome] = useState(grupo.nome);
  const [ordem, setOrdem] = useState(String(grupo.ordem));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const n = limpar(nome);
  const ord = Number(ordem);
  const ordemOk = ordem.trim() !== "" && Number.isInteger(ord) && ord >= 0 && ord <= 999;
  const invalido = n.length < 2 || n.length > NOME_MAX || !ordemOk;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (invalido || busy) return;
    const c: { nome?: string; ordem?: number } = {};
    if (n !== grupo.nome) c.nome = n;
    if (ord !== grupo.ordem) c.ordem = ord;
    if (Object.keys(c).length === 0) { onSalvo(`Grupo ${grupo.nome}: nada a alterar.`); return; }
    setBusy(true); setErro(null);
    try { await atualizarGrupo(grupo.id, c); onSalvo(`Grupo ${n} atualizado.`); }
    catch (x) { setErro(mensagemErro(x)); setBusy(false); }
  }

  return (
    <Dialogo titulo={`Editar grupo · ${grupo.nome}`} onFechar={onFechar} travado={busy} largura="max-w-md">
      <form onSubmit={salvar} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Nome</span>
          <input autoFocus value={nome} onChange={(e) => { setErro(null); setNome(e.target.value); }} maxLength={NOME_MAX} disabled={busy}
            aria-invalid={nome !== "" && (n.length < 2)} aria-describedby="ajuda-grupo" className={campo} />
          <span id="ajuda-grupo" className="text-sm text-muted">2 a {NOME_MAX} caracteres, sem repetir outro grupo. Aparece no Totem.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Ordem</span>
          <input type="number" inputMode="numeric" min={0} max={999} value={ordem} onChange={(e) => { setErro(null); setOrdem(e.target.value); }} disabled={busy}
            aria-invalid={!ordemOk} className={campo} />
        </label>
        {erro && <Faixa tipo="erro">{erro}</Faixa>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onFechar} disabled={busy} className={btnSec}>Cancelar</button>
          <button type="submit" disabled={invalido || busy} className={btnPrim}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </Dialogo>
  );
}
