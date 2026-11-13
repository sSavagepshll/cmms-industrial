"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, atualizarEquipamento, criarEquipamentoNoGrupo, listarEquipamentosDoGrupo, listarSetoresOpcoes, removerEquipamento } from "@/lib/api";
import type { EquipamentoGrupo, GrupoAtivoAdmin, SetorOpcao } from "@/lib/types";
import { CampoSetor } from "./CampoSetor";
import { ConfirmarAcao } from "../ui/ConfirmarAcao";
import { Dialogo } from "../ui/Dialogo";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { btnPerigo, btnPrim, btnSec, campo } from "../ui/estilos";

const TAG_MAX = 50, NOME_MAX = 150, MODELO_MAX = 100;
const TAG_OK = /^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/;
const limpar = (v: string) => v.trim().replace(/\s+/g, " ");
const LEGADO: Record<string, string> = { EM_MANUTENCAO: "Em manutenção (legado)", DESCARTADO: "Descartada (legado)" };

function mensagemErro(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "Sem conexão com o servidor.";
    if (e.status === 403) return "Apenas administradores podem gerenciar equipamentos.";
    if (e.status >= 500) return "Erro no servidor. Tente novamente em instantes.";
    if (e.code === "EQUIPAMENTO_COM_OMS_ATIVAS") {
      const n = (e.body as { omsAbertas?: number } | undefined)?.omsAbertas;
      return `Não é possível inativar: há ${n ?? "OMs"} OM(s) em andamento neste equipamento. Conclua ou cancele antes.`;
    }
    if (e.code === "GRUPO_RESERVADO") return "O grupo Predial e Outros é reservado ao ativo predial e ao item avulso.";
    if (e.code === "ATIVO_RESERVADO") return "Este item é reservado pelo sistema e não pode ser alterado.";
    if (e.code === "GRUPO_INVALIDO_PREDIAL") return "Equipamento predial só pode ficar no grupo Predial e Outros.";
    return e.message;
  }
  return "Erro inesperado.";
}
/** Erro de campo vindo de VALIDACAO (detalhes[{campo,mensagem}]) ou EQUIPAMENTO_TAG_DUPLICADA (campo "tag"). */
function errosDeCampo(e: unknown): Record<string, string> {
  const r: Record<string, string> = {};
  if (!(e instanceof ApiError)) return r;
  const SETOR: Record<string, string> = {
    SETOR_NAO_ENCONTRADO: "Setor não encontrado. Recarregue a lista.", SETOR_INATIVO: "Este setor está inativo. Escolha outro.",
    SETOR_PREDIAL_SEM_EQUIPAMENTOS: "Setor predial não aceita máquinas. Escolha outro.", SETOR_TECNICO_RESERVADO: "O setor técnico \"Geral\" não pode ser usado. Escolha o setor real.",
  };
  if (e.code && SETOR[e.code]) r.setorId = SETOR[e.code];
  if (e.code === "EQUIPAMENTO_TAG_DUPLICADA") r.tag = "Já existe um equipamento com esta tag (maiúsculas e minúsculas contam como iguais).";
  const det = (e.body as { detalhes?: { campo?: string; mensagem?: string }[] } | undefined)?.detalhes;
  if (Array.isArray(det)) for (const d of det) if (d.campo && d.mensagem && !r[d.campo]) r[d.campo] = d.mensagem;
  return r;
}

function Selo({ s }: { s: EquipamentoGrupo["status"] }) {
  const cor = s === "ATIVO" ? "bg-green-100 text-green-900" : "bg-slate-200 text-slate-800";
  return <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${cor}`}>{s === "ATIVO" ? "Ativo" : s === "INATIVO" ? "Inativo" : LEGADO[s] ?? s}</span>;
}

/**
 * Equipamentos de um grupo do Totem (ADMIN, US-16): busca, filtro de situação, tabela e CRUD (tag/nome/modelo), inativar/reativar,
 * transferir de grupo (exceto Outros) e excluir (com histórico, oferece inativar). Pseudo-ativos aparecem somente leitura.
 */
export function EquipamentosGrupo({ grupo, grupos, onFechar, onMudou }: {
  grupo: GrupoAtivoAdmin; grupos: GrupoAtivoAdmin[]; onFechar: () => void; onMudou: () => void;
}) {
  const [itens, setItens] = useState<EquipamentoGrupo[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [status, setStatus] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState<{ maq: EquipamentoGrupo | null } | null>(null);
  const [excluindo, setExcluindo] = useState<EquipamentoGrupo | null>(null);
  const [setores, setSetores] = useState<SetorOpcao[] | null>(null);
  const [setoresFalhou, setSetoresFalhou] = useState(false);

  const carregarSetores = useCallback(() => {
    setSetoresFalhou(false);
    listarSetoresOpcoes().then(setSetores).catch((e) => { if (!(e instanceof ApiError && e.status === 401)) setSetoresFalhou(true); });
  }, []);
  useEffect(() => { carregarSetores(); }, [carregarSetores]);

  useEffect(() => { const t = setTimeout(() => setBuscaAplicada(limpar(busca)), 300); return () => clearTimeout(t); }, [busca]);

  const carregar = useCallback(() => {
    listarEquipamentosDoGrupo(grupo.id, { busca: buscaAplicada || undefined, status: status || undefined, limit: 200 })
      .then((r) => { setItens(r.itens); setTotal(r.total); setErro(null); })
      .catch((e) => { if (e instanceof ApiError && e.status === 401) return; setItens((p) => p ?? []); setErro(mensagemErro(e)); });
  }, [grupo.id, buscaAplicada, status]);
  useEffect(() => { carregar(); }, [carregar]);

  const aposMudar = (msg: string) => { setAviso(msg); setErro(null); carregar(); onMudou(); };

  return (
    <Dialogo titulo={`Equipamentos · ${grupo.nome}`} onFechar={onFechar} largura="max-w-5xl">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Equipamentos ativos aparecem no Totem dentro deste grupo. Inativar tira do Totem e preserva o histórico.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-48 flex-1 flex-col gap-1"><span className="text-sm font-semibold">Buscar</span>
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} maxLength={100} placeholder="Tag, nome ou modelo" className={campo} /></label>
          <label className="flex flex-col gap-1"><span className="text-sm font-semibold">Situação</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${campo} !w-auto`}>
              <option value="">Todas</option><option value="ATIVO">Ativos</option><option value="INATIVO">Inativos</option>
            </select></label>
          <button onClick={() => { setAviso(null); setForm({ maq: null }); }} className={btnPrim}><Icone nome="mais" />Novo equipamento</button>
        </div>
        {aviso && <Faixa tipo="ok">{aviso}</Faixa>}
        {erro && <Faixa tipo="erro">{erro}</Faixa>}

        <div className="max-h-[55dvh] overflow-auto rounded-2xl ring-1 ring-line">
          {!itens ? <p className="p-6 text-muted">Carregando…</p> : itens.length === 0 ? (
            <p className="p-10 text-center text-muted">{buscaAplicada || status ? "Nenhum equipamento para os filtros escolhidos." : "Nenhum equipamento neste grupo. Use \"Novo equipamento\"."}</p>
          ) : (
            <table className="w-full min-w-[44rem] text-left">
              <caption className="sr-only">Equipamentos do grupo {grupo.nome}</caption>
              <thead className="sticky top-0 bg-brand-50 text-sm uppercase tracking-wide text-muted">
                <tr><th scope="col" className="p-3">Tag</th><th scope="col" className="p-3">Nome</th><th scope="col" className="p-3">Modelo</th><th scope="col" className="p-3">Setor</th>
                  <th scope="col" className="p-3">Status</th><th scope="col" className="p-3 text-right">OMs abertas</th><th scope="col" className="p-3">Ações</th></tr>
              </thead>
              <tbody className="divide-y divide-line/40 dark:divide-line-soft">
                {itens.map((m) => (
                  <tr key={m.id} className="align-middle hover:bg-brand-50">
                    <td className="p-3 font-bold">{m.tag}</td>
                    <td className="p-3">{m.nome}</td>
                    <td className="p-3 text-muted">{m.modelo ?? "—"}</td>
                    <td className="p-3">{m.predial ? "—" : m.setorNome}{m.setorNome === "Geral" && !m.predial && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">Reclassificar</span>}</td>
                    <td className="p-3"><Selo s={m.status} /></td>
                    <td className="p-3 text-right tabular-nums">{m.omsAtivas}</td>
                    <td className="p-3">
                      {m.predial ? <span className="text-sm text-muted">Somente leitura (reservado pelo sistema)</span> : (
                        <div className="flex gap-2">
                          <button onClick={() => { setAviso(null); setForm({ maq: m }); }} aria-label={`Editar equipamento ${m.tag}`} className={`${btnSec} min-h-11 px-3 text-sm`}><Icone nome="editar" className="h-4 w-4" />Editar</button>
                          <button onClick={() => { setAviso(null); setExcluindo(m); }} aria-label={`Excluir equipamento ${m.tag}`} className={`${btnPerigo} min-h-11 px-3 text-sm`}><Icone nome="lixeira" className="h-4 w-4" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {itens && itens.length > 0 && <p className="text-sm text-muted" role="status">{total !== null && total > itens.length ? `Mostrando ${itens.length} de ${total} equipamentos. Refine a busca.` : `${itens.length} equipamento(s).`}</p>}
        <div className="flex justify-end"><button onClick={onFechar} className={btnSec}>Fechar</button></div>
      </div>

      {form && <EquipamentoForm maq={form.maq} grupo={grupo} grupos={grupos} setores={setores} setoresFalhou={setoresFalhou} onRecarregarSetores={carregarSetores} onFechar={() => setForm(null)} onSalvo={(m) => { setForm(null); aposMudar(m); }} />}
      {excluindo && <ExcluirEquipamento maq={excluindo} onFechar={() => setExcluindo(null)} onFeito={(m) => { setExcluindo(null); aposMudar(m); }} />}
    </Dialogo>
  );
}

/** Criar (maq = null, no grupo aberto) ou editar. Na edição: situação (Ativo/Inativo, exceto legado) e transferência de grupo. Só envia o que mudou. */
function EquipamentoForm({ maq, grupo, grupos, setores, setoresFalhou, onRecarregarSetores, onFechar, onSalvo }: {
  maq: EquipamentoGrupo | null; grupo: GrupoAtivoAdmin; grupos: GrupoAtivoAdmin[]; setores: SetorOpcao[] | null; setoresFalhou: boolean; onRecarregarSetores: () => void;
  onFechar: () => void; onSalvo: (msg: string) => void;
}) {
  const [tag, setTag] = useState(maq?.tag ?? "");
  const [nome, setNome] = useState(maq?.nome ?? "");
  const [modelo, setModelo] = useState(maq?.modelo ?? "");
  const [status, setStatus] = useState<"ATIVO" | "INATIVO">(maq?.status === "INATIVO" ? "INATIVO" : "ATIVO");
  const [grupoId, setGrupoId] = useState(maq?.grupoId ?? grupo.id);
  const [setorId, setSetorId] = useState(maq?.setorId ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const legado = !!maq && maq.status !== "ATIVO" && maq.status !== "INATIVO";

  const t = limpar(tag), n = limpar(nome), m = limpar(modelo);
  const tagInvalida = t.length < 2 || t.length > TAG_MAX || !TAG_OK.test(t);
  const invalido = !setorId || tagInvalida || n.length < 2 || n.length > NOME_MAX || m.length > MODELO_MAX;
  const transferir = !!maq && grupoId !== maq.grupoId;
  // Destino: todos os grupos exceto PREDIAL_OUTROS (reservado ao predial e ao item avulso).
  const destinos = grupos.filter((g) => !g.reservado && g.codigo !== "PREDIAL_OUTROS");

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (invalido || busy) return;
    setBusy(true); setErro(null); setCampos({});
    try {
      if (!maq) { await criarEquipamentoNoGrupo(grupo.id, { tag: t, nome: n, setorId, ...(m && { modelo: m }) }); onSalvo(`Equipamento ${t} criado.`); return; }
      const c: Parameters<typeof atualizarEquipamento>[1] = {};
      if (t !== maq.tag) c.tag = t;
      if (n !== maq.nome) c.nome = n;
      if (m !== (maq.modelo ?? "")) c.modelo = m || null;
      if (!legado && status !== maq.status) c.status = status;
      if (transferir) c.grupoId = grupoId;
      if (setorId !== maq.setorId) c.setorId = setorId; // só se mudou: evita SETOR_INATIVO ao editar outro campo de legado
      if (Object.keys(c).length === 0) { onSalvo(`Equipamento ${maq.tag}: nada a alterar.`); return; }
      await atualizarEquipamento(maq.id, c);
      onSalvo(`Equipamento ${t} atualizado.${transferir ? " As OMs e o histórico não mudam com a transferência." : ""}`);
    } catch (x) {
      const f = errosDeCampo(x);
      setCampos(f);
      if (Object.keys(f).length === 0) setErro(mensagemErro(x));
      setBusy(false);
    }
  }

  const limpa = (set: (v: string) => void, k: string) => (v: string) => { set(v); setCampos((p) => ({ ...p, [k]: "" })); setErro(null); };
  return (
    <Dialogo titulo={maq ? `Editar equipamento ${maq.tag}` : `Novo equipamento · ${grupo.nome}`} onFechar={onFechar} travado={busy} largura="max-w-lg">
      <form onSubmit={salvar} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Tag</span>
          <input autoFocus value={tag} onChange={(e) => limpa(setTag, "tag")(e.target.value)} maxLength={TAG_MAX} autoCapitalize="characters" disabled={busy}
            aria-invalid={!!campos.tag || (tag !== "" && tagInvalida)} aria-describedby="ajuda-tag" className={campo} />
          <span id="ajuda-tag" className={`text-sm ${campos.tag ? "font-semibold text-danger-fg" : "text-muted"}`}>
            {campos.tag || "2 a 50 caracteres: letras sem acento, números, espaço e . _ - /. É o código digitado no Totem."}</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Nome</span>
          <input value={nome} onChange={(e) => limpa(setNome, "nome")(e.target.value)} maxLength={NOME_MAX} disabled={busy} aria-invalid={!!campos.nome} aria-describedby="ajuda-nome" className={campo} />
          <span id="ajuda-nome" className={`text-sm ${campos.nome ? "font-semibold text-danger-fg" : "text-muted"}`}>{campos.nome || "2 a 150 caracteres."}</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Modelo <span className="font-normal text-muted">(opcional)</span></span>
          <input value={modelo} onChange={(e) => limpa(setModelo, "modelo")(e.target.value)} maxLength={MODELO_MAX} disabled={busy} aria-invalid={!!campos.modelo} aria-describedby="ajuda-modelo" className={campo} />
          {campos.modelo && <span id="ajuda-modelo" className="text-sm font-semibold text-danger-fg">{campos.modelo}</span>}
        </label>
        <CampoSetor valor={setorId} onChange={limpa(setSetorId, "setorId")} opcoes={setores} setorAtual={maq ? { id: maq.setorId, nome: maq.setorNome } : undefined}
          erro={campos.setorId} desabilitado={busy} falhou={setoresFalhou} onRecarregar={onRecarregarSetores} />
        {maq ? (
          <>
            {legado ? (
              <p className="text-sm text-muted">Situação: <Selo s={maq.status} />. Equipamentos com situação legada só permitem editar texto e grupo.</p>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Situação</span>
                <select value={status} onChange={(e) => { setStatus(e.target.value as "ATIVO" | "INATIVO"); setErro(null); }} disabled={busy} className={campo}>
                  <option value="ATIVO">Ativo (aparece no Totem)</option><option value="INATIVO">Inativo (some do Totem)</option>
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Grupo no Totem</span>
              <select value={grupoId} onChange={(e) => { setGrupoId(e.target.value); setErro(null); }} disabled={busy} className={campo}>
                {destinos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
              </select>
            </label>
            {transferir && <Faixa tipo="atencao">O equipamento passa a aparecer em outro grupo do Totem. As OMs e o histórico não mudam.</Faixa>}
          </>
        ) : <p className="text-sm text-muted">Será criado no grupo <strong>{grupo.nome}</strong>.</p>}
        {erro && <Faixa tipo="erro">{erro}</Faixa>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onFechar} disabled={busy} className={btnSec}>Cancelar</button>
          <button type="submit" disabled={invalido || busy} className={btnPrim}>{busy ? "Salvando…" : maq ? "Salvar" : "Criar equipamento"}</button>
        </div>
      </form>
    </Dialogo>
  );
}

/** Exclusão física. Com histórico (409) o modal passa a oferecer inativar; com OM em andamento mostra o motivo. */
function ExcluirEquipamento({ maq, onFechar, onFeito }: { maq: EquipamentoGrupo; onFechar: () => void; onFeito: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [hist, setHist] = useState<{ omsTotal?: number; omsAbertas?: number } | null>(null);

  async function excluir() {
    setBusy(true); setErro(null);
    try { await removerEquipamento(maq.id); onFeito(`Equipamento ${maq.tag} excluído.`); }
    catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "EQUIPAMENTO_COM_HISTORICO") setHist((e.body ?? {}) as { omsTotal?: number; omsAbertas?: number });
      else setErro(mensagemErro(e));
      setBusy(false);
    }
  }
  async function inativar() {
    setBusy(true); setErro(null);
    try { await atualizarEquipamento(maq.id, { status: "INATIVO" }); onFeito(`Equipamento ${maq.tag} inativado.`); }
    catch (e) { setErro(mensagemErro(e)); setBusy(false); }
  }

  if (hist) {
    const jaInativo = maq.status === "INATIVO";
    const emAndamento = (hist.omsAbertas ?? 0) > 0;
    return (
      <ConfirmarAcao titulo={`${maq.tag} não pode ser excluído`} rotuloConfirmar={jaInativo || emAndamento ? "Entendi" : "Inativar equipamento"} perigoso={false} busy={busy} erro={erro}
        onCancelar={onFechar} onConfirmar={() => { if (jaInativo || emAndamento) onFechar(); else void inativar(); }}>
        <p>Este equipamento tem {hist.omsTotal ?? 0} OM(s) no histórico e não pode ser excluído.</p>
        {emAndamento ? <p className="mt-2 font-semibold">Há {hist.omsAbertas} OM(s) em andamento: não é possível inativá-lo agora.</p>
          : jaInativo ? <p className="mt-2">Ele já está inativo e não aparece no Totem.</p>
          : <p className="mt-2">Deseja <strong>inativá-lo</strong>? Ele some do Totem e o histórico é preservado.</p>}
      </ConfirmarAcao>
    );
  }
  return (
    <ConfirmarAcao titulo="Excluir equipamento?" rotuloConfirmar="Excluir" busy={busy} erro={erro} onCancelar={onFechar} onConfirmar={() => void excluir()}>
      <p><strong>{maq.tag}</strong> · {maq.nome}</p>
      <p className="mt-2 font-semibold">Esta ação não pode ser desfeita.</p>
    </ConfirmarAcao>
  );
}
