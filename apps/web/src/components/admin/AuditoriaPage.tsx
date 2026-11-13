"use client";
import { baixarCsv } from "@/lib/csv";
import { humanizar } from "@/lib/rotulos";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, listarAuditoria, listarUsuarios } from "@/lib/api";
import { rotuloPerfil, type AuditoriaItem, type Usuario } from "@/lib/types";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { btnSec, campo } from "../ui/estilos";

const POR_PAGINA = 50;
const PERIODOS = [["24h", "Últimas 24 h", 1], ["7d", "Últimos 7 dias", 7], ["30d", "Últimos 30 dias", 30]] as const;

/** Ações gravadas pelo back-end (V011 + usuários/parâmetros) com rótulo em português. */
const ACOES: Record<string, string> = {
  OM_DELEGADA: "OM delegada",
  OM_REATRIBUIDA: "OM reatribuída",
  OM_ACEITA: "OM aceita (PIN)",
  OM_ASSUMIDA: "OM assumida (PIN)",
  OM_RECUSADA: "OM recusada",
  OM_DELEGACAO_CANCELADA: "Reserva cancelada",
  OM_LIBERADA_FALLBACK: "OM liberada (fallback)",
  OM_APROVADA: "OM aprovada",
  OM_REPROVADA: "OM reprovada",
  OM_CONCLUIDA: "OM concluída pelo gestor",
  SETOR_CRIADO: "Setor criado",
  SETOR_ATUALIZADO: "Setor atualizado",
  SETOR_ATIVADO: "Setor ativado",
  SETOR_DESATIVADO: "Setor desativado",
  SETOR_EXCLUIDO: "Setor excluído",
  SETOR_LOCAL_CRIADO: "Local padrão criado",
  SETOR_LOCAL_ATUALIZADO: "Local padrão atualizado",
  SETOR_LOCAL_EXCLUIDO: "Local padrão excluído",
  SETOR_LOCAIS_REORDENADOS: "Locais padrão reordenados",
  USUARIO_CRIADO: "Usuário criado",
  USUARIO_ATUALIZADO: "Usuário atualizado",
  USUARIO_PERFIL_ALTERADO: "Perfil alterado",
  USUARIO_ATIVADO: "Usuário reativado",
  USUARIO_DESATIVADO: "Usuário desativado",
  USUARIO_DESBLOQUEADO: "Usuário desbloqueado",
  USUARIO_EXCLUIDO: "Usuário excluído",
  PIN_REDEFINIDO: "PIN redefinido",
  PARAMETRO_ALTERADO: "Parâmetro alterado",
  EQUIPAMENTO_CRIADO: "Máquina criada",
  EQUIPAMENTO_ATUALIZADO: "Máquina atualizada",
  EQUIPAMENTO_EXCLUIDO: "Máquina excluída",
  GRUPO_ATUALIZADO: "Grupo do Totem atualizado",
};
const ALVOS: Record<string, string> = { USUARIO: "Usuário", OM: "OM", PARAMETRO: "Parâmetro", SETOR: "Setor", EQUIPAMENTO: "Máquina", GRUPO_ATIVO: "Grupo do Totem" };
const CAMPOS_EQ: Record<string, string> = { tag: "tag", nome: "nome", modelo: "modelo", status: "status", setorId: "setor", setorNome: "setor", grupo: "grupo", grupoId: "grupo", grupoNome: "grupo" };
const rotuloAcao = (a: string) => ACOES[a] ?? humanizar(a); // sempre "OM" em maiúsculas

/** Chaves que nunca podem aparecer (a API já não as grava; esta é a segunda barreira). */
const SENSIVEL = /valor|pin|senha|segredo|password|token|secret/i;

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });

/** Detalhe legível a partir dos metadados da auditoria, sem nunca exibir valores sensíveis. */
function detalheLegivel(i: AuditoriaItem, nome: (id: unknown) => string | null): string {
  const d = i.detalhe ?? {};
  const partes: string[] = [];
  const s = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : null);

  if (i.acao === "USUARIO_PERFIL_ALTERADO" && s(d.de) && s(d.para)) partes.push(`${rotuloPerfil(String(d.de))} → ${rotuloPerfil(String(d.para))}`);
  if ((i.acao === "OM_DELEGADA" || i.acao === "OM_REATRIBUIDA") && d.tecnicoId !== undefined) {
    const para = nome(d.tecnicoId) ?? `técnico #${s(d.tecnicoId)}`;
    const de = d.de !== undefined && d.de !== null ? (nome(d.de) ?? `técnico #${s(d.de)}`) : null;
    partes.push(de ? `${de} → ${para}` : `→ ${para}`);
  }
  if (i.acao === "OM_LIBERADA_FALLBACK" && s(d.minutos)) partes.push(`sem responsável há mais de ${s(d.minutos)} min`);
  if (i.acao === "OM_ASSUMIDA" || i.acao === "OM_ACEITA") if (s(d.situacao)) partes.push(`situação: ${String(d.situacao).toLowerCase().replace(/_/g, " ")}`);
  if (i.acao === "USUARIO_DESBLOQUEADO" && d.estavaBloqueado === false) partes.push("não estava bloqueado");
  if (i.acao === "EQUIPAMENTO_ATUALIZADO" && d.antes && d.depois && typeof d.antes === "object" && typeof d.depois === "object") {
    const a = d.antes as Record<string, unknown>, p = d.depois as Record<string, unknown>;
    const v = (x: unknown) => (x === null || x === undefined || x === "" ? "—" : String(x));
    for (const k of Object.keys(p)) if (!SENSIVEL.test(k) && k !== "setorNome") partes.push(`${CAMPOS_EQ[k] ?? k}: ${v(k === "setorId" && a.setorNome ? a.setorNome : a[k])} → ${v(k === "setorId" && p.setorNome ? p.setorNome : p[k])}`);
  }
  if (i.acao === "GRUPO_ATUALIZADO") {
    // `detalhe` de/para: objetos { nome, ordem } ou valores simples.
    const v = (x: unknown) => (x === null || x === undefined || x === "" ? "—" : String(x));
    if (d.de && d.para && typeof d.de === "object" && typeof d.para === "object") {
      const a = d.de as Record<string, unknown>, p = d.para as Record<string, unknown>;
      for (const k of Object.keys(p)) if (!SENSIVEL.test(k) && v(a[k]) !== v(p[k])) partes.push(`${k === "nome" ? "nome" : k === "ordem" ? "ordem" : k}: ${v(a[k])} → ${v(p[k])}`);
    } else if (s(d.de) !== null && s(d.para) !== null) partes.push(`${v(d.de)} → ${v(d.para)}`);
  }
  if (Array.isArray(d.campos)) partes.push(`campos: ${d.campos.filter((c) => typeof c === "string" && !SENSIVEL.test(c)).join(", ")}`);
  if (s(d.motivo)) partes.push(`motivo: ${s(d.motivo)}`);

  // demais chaves simples (exceto as já tratadas e as sensíveis)
  const tratadas = new Set(["de", "para", "tecnicoId", "minutos", "situacao", "estavaBloqueado", "campos", "motivo", "antes", "depois"]);
  let sensivel = false;
  for (const [k, v] of Object.entries(d)) {
    if (SENSIVEL.test(k)) { sensivel = true; continue; }
    if (tratadas.has(k)) continue;
    const t = s(v); if (t !== null) partes.push(`${k}: ${t}`);
  }
  if (sensivel || i.alvoTipo === "PARAMETRO") partes.push("valor não exibido");
  if (i.emNomeDe) partes.push(`em nome de ${i.emNomeDe.nome}`);
  return partes.join(" · ") || "—";
}

/** Auditoria (ADMIN, só leitura, RN-25): quem fez o quê e quando. Segredos e PINs nunca aparecem. */
export function AuditoriaPage() {
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number][0]>("7d");
  const [ator, setAtor] = useState("");
  const [acao, setAcao] = useState("");
  const [alvo, setAlvo] = useState("");
  const [pagina, setPagina] = useState(0);
  const [itens, setItens] = useState<AuditoriaItem[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);

  useEffect(() => { listarUsuarios().then(setUsuarios).catch(() => setUsuarios([])); }, []);
  const nomes = useMemo(() => new Map(usuarios.map((u) => [u.id, u.nome])), [usuarios]);
  const nome = useCallback((id: unknown) => (id === null || id === undefined ? null : nomes.get(String(id)) ?? null), [nomes]);

  const carregar = useCallback(() => {
    const dias = PERIODOS.find((p) => p[0] === periodo)![2];
    const ate = new Date(Date.now() + 60_000); // folga: eventos do último segundo
    const de = new Date(ate.getTime() - dias * 86_400_000);
    setItens(null); setErro(null);
    listarAuditoria({ de: de.toISOString(), ate: ate.toISOString(), ator: ator || undefined, acao: acao || undefined, alvoTipo: alvo || undefined, limit: POR_PAGINA, offset: pagina * POR_PAGINA })
      .then((r) => { setItens(r.itens); setTotal(r.total); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return;
        setItens([]); setTotal(null);
        setErro(e instanceof ApiError ? (e.status === 0 ? "Sem conexão com o servidor." : e.status === 403 ? "Apenas administradores veem a auditoria." : e.message) : "Erro inesperado.");
      });
  }, [periodo, ator, acao, alvo, pagina]);
  useEffect(carregar, [carregar]);

  const filtrar = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(0); };
  const temProxima = total !== null ? (pagina + 1) * POR_PAGINA < total : (itens?.length ?? 0) === POR_PAGINA;
  const de = pagina * POR_PAGINA + 1, ate = pagina * POR_PAGINA + (itens?.length ?? 0);

  function exportar() {
    if (!itens?.length) return;
    const linhas = [["Quando", "Ator", "Perfil do ator", "Ação", "Alvo", "Detalhe"],
      ...itens.map((i) => [dataHora(i.criadoEm), i.ator?.nome ?? "Sistema", i.ator?.perfil ?? "", rotuloAcao(i.acao), i.alvoRotulo ?? i.alvoId, detalheLegivel(i, nome)])];
    baixarCsv("auditoria", linhas);
  }

  return (
    <section aria-label="Auditoria" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-extrabold">Auditoria</h3>
          <p className="text-muted">Registro de ações sensíveis (usuários, parâmetros, delegação, aprovação). Somente leitura; PINs e segredos nunca são exibidos.</p>
        </div>
        <button onClick={exportar} disabled={!itens?.length} className={btnSec}><Icone nome="baixar" />Exportar CSV</button>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1"><span className="text-sm font-semibold">Período</span>
          <select value={periodo} onChange={(e) => filtrar(setPeriodo)(e.target.value as typeof periodo)} className={`${campo} !w-auto`}>
            {PERIODOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className="text-sm font-semibold">Ator</span>
          <select value={ator} onChange={(e) => filtrar(setAtor)(e.target.value)} className={`${campo} !w-auto`}>
            <option value="">Todos</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className="text-sm font-semibold">Ação</span>
          <select value={acao} onChange={(e) => filtrar(setAcao)(e.target.value)} className={`${campo} !w-auto`}>
            <option value="">Todas</option>{Object.entries(ACOES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className="text-sm font-semibold">Alvo</span>
          <select value={alvo} onChange={(e) => filtrar(setAlvo)(e.target.value)} className={`${campo} !w-auto`}>
            <option value="">Todos</option>{Object.entries(ALVOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <button onClick={carregar} className={btnSec}><Icone nome="atualizar" />Atualizar</button>
      </div>

      {erro && <Faixa tipo="erro">{erro}</Faixa>}

      <div className="overflow-x-auto rounded-2xl bg-panel ring-1 ring-line">
        <table className="w-full min-w-[52rem] text-left">
          <caption className="sr-only">Registros de auditoria</caption>
          <thead className="bg-brand-50 text-sm uppercase tracking-wide text-muted">
            <tr><th scope="col" className="p-3">Quando</th><th scope="col" className="p-3">Ator</th><th scope="col" className="p-3">Ação</th><th scope="col" className="p-3">Alvo</th><th scope="col" className="p-3">Detalhe</th></tr>
          </thead>
          <tbody className="divide-y divide-line/40 dark:divide-line-soft">
            {!itens && <tr><td colSpan={5} className="p-6 text-muted">Carregando…</td></tr>}
            {itens && itens.length === 0 && !erro && <tr><td colSpan={5} className="p-10 text-center text-muted">Nenhum registro para os filtros escolhidos.</td></tr>}
            {itens?.map((i) => (
              <tr key={i.id} className="align-top">
                <td className="whitespace-nowrap p-3 tabular-nums">{dataHora(i.criadoEm)}</td>
                <td className="p-3"><span className="font-semibold">{i.ator?.nome ?? "Sistema"}</span>{i.ator?.perfil && <span className="block text-sm text-muted">{i.ator.perfil === "SISTEMA" ? "automático" : rotuloPerfil(i.ator.perfil)}</span>}</td>
                <td className="p-3"><span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-sm font-bold text-primary-fg">{rotuloAcao(i.acao)}</span></td>
                <td className="p-3"><span className="font-semibold">{i.alvoRotulo ?? i.alvoId}</span><span className="block text-sm text-muted">{ALVOS[i.alvoTipo] ?? i.alvoTipo}</span></td>
                <td className="p-3 text-sm">{detalheLegivel(i, nome)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">{itens && itens.length > 0 ? `Mostrando ${de}–${ate}${total !== null ? ` de ${total}` : ""}` : ""}</p>
        <div className="flex gap-2">
          <button onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0 || !itens} className={btnSec}>Anterior</button>
          <button onClick={() => setPagina((p) => p + 1)} disabled={!temProxima || !itens} className={btnSec}>Próxima</button>
        </div>
      </div>
    </section>
  );
}
