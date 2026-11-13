import type { Equipamento, GrupoAtivo, LocalPredial, GrupoAtivoAdmin, NovaOm, OmAberta, OmCriada, Operador, Setor } from "./types";
import { clearToken, getToken, getTotemId, notifyUnauthorized, setExpiraEmServidor, setToken, setTotemId } from "./session";
import { TOTEM_ID } from "./constants";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** true se `url` aponta para um host remoto explícito (diferente de localhost/loopback). */
function hostRemoto(url?: string): boolean {
  if (!url) return false;
  try { return !LOOPBACK.has(new URL(url).hostname); } catch { return false; }
}

/**
 * Base da API. No navegador, se NEXT_PUBLIC_API_URL não for um host remoto explícito (vazia ou localhost), usa o MESMO host
 * da página na porta 4000: assim o totem/painel abertos por outro computador da rede local (http://192.168.x.x:3000) falam
 * com a API daquela máquina, e não com o "localhost" do cliente. No SSR usa API_INTERNAL_URL ?? NEXT_PUBLIC_API_URL ?? localhost.
 */
export function getApiBaseUrl(): string {
  const publica = process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") {
    // Página em HTTPS não chama API em HTTP (conteúdo misto é bloqueado): sobe o protocolo da URL remota explícita.
    if (hostRemoto(publica)) return window.location.protocol === "https:" ? (publica as string).replace(/^http:/, "https:") : (publica as string);
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return process.env.API_INTERNAL_URL ?? publica ?? "http://localhost:4000";
}

/** `code` = campo `error` da API (ex.: CREDENCIAIS_INVALIDAS, OM_DUPLICADA); status 0 = sem rede. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body?: unknown) {
    super(message);
  }
}

async function http<T>(path: string, init: RequestInit = {}, auth = true, aoReceber?: (h: Headers) => void): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const tid = getTotemId();
  if (auth && token && tid) headers["X-Totem-Id"] = tid; // sessão de totem: sem o header (ou com outro) a API responde 401 SESSAO_TOTEM_INVALIDA

  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers, cache: "no-store" });
  } catch {
    throw new ApiError(0, "SEM_REDE", "Sem conexão com o servidor.");
  }
  if (res.ok && res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Token ausente/expirado em rota protegida: encerra a sessão do totem.
    if (res.status === 401 && auth) notifyUnauthorized();
    throw new ApiError(res.status, body.error ?? "ERRO", body.message ?? res.statusText, body);
  }
  aoReceber?.(res.headers);
  return (await res.json()) as T;
}

interface SessaoResp { token: string; usuario: Operador; sessao?: "TOTEM" | "PADRAO"; totemId?: string; expiraEmSegundos?: number }

async function iniciarSessao(path: string, body: object, totem = false): Promise<Operador> {
  // Totem: envia o Device ID no corpo; a resposta traz sessao:"TOTEM" e o prazo absoluto (120 s). Painel/Kanban: sessão PADRAO.
  const r = await http<SessaoResp>(path, { method: "POST", body: JSON.stringify(totem ? { ...body, totemId: TOTEM_ID } : body) }, false);
  setToken(r.token);
  if (r.sessao === "TOTEM") { setTotemId(r.totemId ?? TOTEM_ID); setExpiraEmServidor(r.expiraEmSegundos ?? null); }
  return r.usuario;
}

/** `portal: "TECNICO"` declara o login do Kanban (o servidor recusa quem não é técnico/admin); é exclusivo do totem (contrato Fase 32 §3.2). */
export const autenticarPin = (matricula: string, pin: string, totem = false, portal?: "TECNICO") => {
  if (portal && totem) throw new Error("portal e totem são mutuamente exclusivos");
  return iniciarSessao("/auth/pin", { matricula, pin, ...(portal && { portal }) }, totem);
};
export const encerrarSessao = clearToken;

/** Fase 31: locais padrão da manutenção predial (substitui os locais de /equipamentos/setores). */
export const listarLocaisPrediais = () => http<LocalPredial[]>("/equipamentos/locais");

/** Fase 30: os 4 grupos do Totem (sempre 4; `total` 0 = vazio). */
export const listarGrupos = () => http<GrupoAtivo[]>("/equipamentos/grupos");

/** Equipamentos ativos de um grupo (PREDIAL_OUTROS traz os pseudo-ativos PREDIAL e OUTROS/itemLivre) ou de um setor (legado). */
export const listarEquipamentos = (f: { grupo?: string; setor?: string; busca?: string }) => {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => !!v) as [string, string][]).toString();
  return http<Equipamento[]>(`/equipamentos${q ? `?${q}` : ""}`);
};

/** `item` (grupo OUTROS) e `localDescricao` (predial) restringem a duplicidade (RN-04); a API filtra, aqui é rede de segurança. */
export async function omAbertaDoEquipamento(equipamentoId: string, o: { local?: string; item?: string } = {}): Promise<OmAberta | null> {
  const q = (o.local ? `&localDescricao=${encodeURIComponent(o.local)}` : "") + (o.item ? `&itemDescricao=${encodeURIComponent(o.item)}` : "");
  const oms = await http<OmAberta[]>(`/ordens?equipamentoId=${equipamentoId}${q}&limit=20`);
  const norm = (v?: string | null) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return oms.find((m) => (m.status === "ABERTA" || m.status === "EM_ANDAMENTO")
    && (!o.local || m.localDescricao == null || norm(m.localDescricao) === norm(o.local))
    && (!o.item || m.itemDescricao == null || norm(m.itemDescricao) === norm(o.item))) ?? null;
}

export const criarOm = (om: NovaOm) => http<OmCriada>("/ordens", { method: "POST", body: JSON.stringify(om) });

// ---------- Kanban do Técnico (RBAC: assumir/play/pause/concluir só TECNICO/ADMIN) ----------
import type { ConclusaoOm, CustoEncerramento, FilaKanban, MotivoPausa, Nota, ResultadoTempo } from "./types";

const post = <T>(path: string, body?: object) =>
  http<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });

export async function buscarFila(): Promise<FilaKanban> {
  const fila = await http<FilaKanban>("/ordens/fila");
  const recebidoEm = Date.now();
  for (const col of Object.values(fila.colunas)) {
    for (const o of col) o.recebidoEm = recebidoEm;
    col.sort((a, b) => maisRecente(a.dataAbertura, b.dataAbertura, a.id, b.id));
  }
  return fila;
}
/**
 * Fase 35 (RN-74/75): mais recentes primeiro, desempate por id decrescente. O servidor já entrega assim; aqui é idempotente
 * (garante a ordem mesmo com API antiga) e é o único reordenamento permitido nas listas.
 */
function maisRecente(da: string | null, db: string | null, ia: string, ib: string): number {
  const d = new Date(db ?? 0).getTime() - new Date(da ?? 0).getTime();
  if (d !== 0) return d;
  return BigInt(ib) > BigInt(ia) ? 1 : BigInt(ib) < BigInt(ia) ? -1 : 0;
}
/** Assumir (puxar ou aceitar a reserva) exige o PIN do próprio usuário. */
export const assumirOm = (id: string, pin: string) => post<{ statusKanban: string }>(`/ordens/${id}/assumir`, { pin });
export const playOm = (id: string) => post<ResultadoTempo>(`/ordens/${id}/play`);
export const pausarOm = (id: string, motivo: MotivoPausa, detalhe?: string) =>
  post<ResultadoTempo>(`/ordens/${id}/pause`, { motivo, detalhe: detalhe || undefined });
export const concluirOm = (id: string, c: ConclusaoOm) =>
  post<ResultadoTempo>(`/ordens/${id}/concluir`, { ...c, parecer: c.parecer?.trim() || undefined });
export const listarNotas = (id: string) => http<Nota[]>(`/ordens/${id}/notas`);
export const adicionarNota = (id: string, nota: string) => post<Nota>(`/ordens/${id}/notas`, { nota });


// ---------- Fase 12 (contratos ASSUMIDOS; endpoints de apontamento manual ainda não existem no Back-end) ----------
import type { Apontamento, Material, NovoApontamentoManual, NovoMaterial } from "./types";

export const listarApontamentos = (id: string) => http<Apontamento[]>(`/ordens/${id}/apontamentos`);
export const lancarTempoManual = (id: string, b: NovoApontamentoManual) =>
  post<Apontamento>(`/ordens/${id}/apontamentos`, { ...b, observacao: b.observacao || undefined });

// Existente: /ordens/:id/materiais. flagInterno/confNf: campos novos (a API atual os descarta).
export const listarMateriais = (id: string) => http<{ itens: Material[]; custoTotal: number }>(`/ordens/${id}/materiais`);
export const adicionarMaterial = (id: string, m: NovoMaterial) => post<Material>(`/ordens/${id}/materiais`, m);
export const removerMaterial = (id: string, materialId: string) =>
  http<void>(`/ordens/${id}/materiais/${materialId}`, { method: "DELETE" });

// ---------- Aprovação de Supervisão (GESTOR/ADMIN) ----------
import type { Aprovacao, ConclusaoPendente, EquipamentoAdmin, EquipamentoGrupo, MttrResp, Ofensor, OmKanban, OmLista, PausasResp, SetorAdmin, SetorLocal, SetorOpcao } from "./types";

export const listarAprovacoes = () => http<Aprovacao[]>("/ordens/aprovacoes");
/** Aprovar/reprovar exigem o PIN do próprio decisor (RN-24: ninguém decide o que executou). */
export const aprovarOm = (id: string, pin: string) => post<{ statusKanban: string; emNomeDe?: string | null }>(`/ordens/${id}/aprovar`, { pin });
export const reprovarOm = (id: string, motivo: string, pin: string) => post<{ statusKanban: string; emNomeDe?: string | null }>(`/ordens/${id}/reprovar`, { motivo, pin });

/** Fase 21: GERENTE/ADMIN. Fase 35: mais recentes (aprovação) primeiro; concluir exige o PIN do próprio usuário (quem executou não conclui). */
export const listarConclusoesPendentes = () =>
  http<ConclusaoPendente[]>("/ordens/conclusoes-pendentes").then((l) => [...l].sort((a, b) => maisRecente(a.dataAprovacao, b.dataAprovacao, a.id, b.id)));
// Contrato v1.1 §4.4: `/concluir` é só a finalização técnica (soTecnico); a conclusão do gestor usa `/encerrar` (o botão na tela segue "Concluir OM").
const ROTA_CONCLUIR_GESTOR = (id: string) => `/ordens/${id}/encerrar`;
/** Fase 31 (breaking): o encerramento exige `custoTipo`; `centroCusto` é opcional (vazio = não informado). */
export const concluirOmGestor = (id: string, pin: string, custoTipo: CustoEncerramento, centroCusto?: string) =>
  post<{ status: string; statusKanban: string; concluidoPor: string; concluidoEm: string; custoTipo?: string; centroCusto?: string | null }>(ROTA_CONCLUIR_GESTOR(id), { pin, custoTipo, ...(centroCusto?.trim() && { centroCusto: centroCusto.trim() }) });

// ---------- Painel Admin ----------
const qs = (p: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : "";
};
export const buscarMttr = (de: string, ate: string, setor?: string, granularidade: "day" | "week" | "month" = "day") =>
  http<MttrResp>(`/metricas/mttr${qs({ de, ate, setor, granularidade })}`);
export const buscarOfensores = (de: string, ate: string, setor?: string) =>
  http<{ itens: Ofensor[] }>(`/metricas/ofensores${qs({ de, ate, setor, limit: "10" })}`);
export const buscarPausas = (de: string, ate: string, setor?: string) =>
  http<PausasResp>(`/metricas/pausas${qs({ de, ate, setor })}`);
/**
 * Detalhe de uma OM fora da fila ativa (GET /ordens/:id, ex.: concluída há dias) adaptado ao formato do Kanban para o `OmDetail`.
 * O DTO não traz `responsavel`/tempo (só a fila traz): ficam nulos e as abas Tempo/Materiais/Testes/Notas buscam os próprios dados.
 * CANCELADA não existe no Kanban: é exibida como encerrada.
 */
const KANBAN_DE_STATUS: Record<string, OmKanban["statusKanban"]> = {
  ABERTA: "ABERTO", RESERVADA: "ABERTO", EM_ANDAMENTO: "EM_ATENDIMENTO", PAUSADA: "PAUSADO", AGUARDANDO_PECA: "PAUSADO",
  AGUARDANDO_APROVACAO: "AGUARDANDO_APROVACAO", AGUARDANDO_BAIXA: "AGUARDANDO_BAIXA", CONCLUIDA: "CONCLUIDO", CANCELADA: "CONCLUIDO",
};
export async function buscarOm(id: string): Promise<OmKanban> {
  const o = await http<Omit<OmKanban, "statusKanban" | "responsavel"> & { responsavel?: OmKanban["responsavel"] }>(`/ordens/${id}`);
  return { ...o, statusKanban: KANBAN_DE_STATUS[o.status] ?? "EM_ATENDIMENTO", responsavel: o.responsavel ?? null, recebidoEm: Date.now() };
}
export const listarOrdens = (status?: string) => http<OmLista[]>(`/ordens${qs({ status, limit: "100" })}`);

// ---------- Gerenciador de Usuários (contrato ASSUMIDO: o Back-end ainda não tem /usuarios; só ADMIN) ----------
import type { EdicaoUsuario, NovoUsuario, Usuario } from "./types";

export const listarUsuarios = () => http<Usuario[]>("/usuarios");
export const criarUsuario = (u: NovoUsuario) => post<Usuario>("/usuarios", u);
export const editarUsuario = (id: string, u: EdicaoUsuario) =>
  http<Usuario>(`/usuarios/${id}`, { method: "PUT", body: JSON.stringify(u) });
/** "Redefinir senha": o sistema autentica por PIN, então redefine o PIN (4 a 6 dígitos). */
/** Exclusão física (ADMIN). 409 USUARIO_COM_HISTORICO traz `referencias` e `sugestao:"DESATIVAR"` no corpo. */
export const removerUsuario = (id: string) => http<void>(`/usuarios/${id}`, { method: "DELETE" });
export const redefinirPin = (id: string, pin: string) => http<void>(`/usuarios/${id}/credenciais`, { method: "PUT", body: JSON.stringify({ pin }) });

// ---------- Parâmetros do Sistema (/configuracoes, só ADMIN) ----------
import type { ConfiguracaoItem } from "./types";

export const listarConfiguracoes = () => http<ConfiguracaoItem[]>("/configuracoes");
/** `valor: null` limpa o parâmetro. NUNCA enviar a máscara de um SECRETO: ela seria gravada como valor. */
export const salvarConfiguracao = (chave: string, valor: string | null) =>
  http<ConfiguracaoItem>(`/configuracoes/${encodeURIComponent(chave)}`, { method: "PUT", body: JSON.stringify({ valor }) });

// ---------- E-mail (SMTP): POST /configuracoes/email/teste (só ADMIN, 5/min). Usa o SMTP JÁ GRAVADO. ----------
/** 200: "aceito pelo servidor SMTP" (a entrega na caixa de entrada depende do provedor). Falha: 502 FALHA_ENVIO; limite: 429. */
export interface TesteEmailOk { enviado: true; aceitos: string[]; rejeitados: string[]; resposta: string; messageId?: string }
export const enviarEmailTeste = (para: string) => post<TesteEmailOk>("/configuracoes/email/teste", { para });

// ---------- Modelo híbrido (US-11 / V010-V011): delegar, recusar, desfazer ----------
import type { AuditoriaItem, TecnicoCarga } from "./types";

/** GERENTE/ADMIN. OM ABERTA -> RESERVADA (continua aberta até o técnico assumir com PIN). Reatribuir exige `motivo` (>= 5). */
export const atribuirOm = (id: string, tecnicoId: string, motivo?: string) =>
  post<{ status: string; reservada: boolean }>(`/ordens/${id}/atribuir`, { tecnicoId, motivo: motivo || undefined });
/** Técnico reservado recusa (motivo >= 10 caracteres): a OM volta ao gerente e NÃO vai ao pull. */
export const recusarOm = (id: string, motivo: string) => post<{ status: string; devolvida: boolean }>(`/ordens/${id}/recusar`, { motivo });
/** "Desfazer" do gerente: cancela a reserva enquanto o técnico não aceitou. */
export const cancelarDelegacao = (id: string, motivo?: string) => post<{ status: string }>(`/ordens/${id}/cancelar-delegacao`, { motivo: motivo || undefined });
export const listarTecnicos = () => http<TecnicoCarga[]>("/usuarios/tecnicos");
/** ADMIN: libera quem foi bloqueado por tentativas erradas de PIN. */
export const desbloquearUsuario = (id: string) => post<void>(`/usuarios/${id}/desbloquear`);

export interface FiltroAuditoria { de?: string; ate?: string; ator?: string; acao?: string; alvoTipo?: string; limit?: number; offset?: number }
/** Trilha de auditoria (ADMIN). O total vem no cabeçalho X-Total-Count (exposto no CORS). */
export async function listarAuditoria(f: FiltroAuditoria): Promise<{ itens: AuditoriaItem[]; total: number | null }> {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== "") as [string, string][]).toString();
  let total: number | null = null;
  const itens = await http<AuditoriaItem[]>(`/auditoria${q ? `?${q}` : ""}`, {}, true, (h) => { const n = Number(h.get("X-Total-Count")); total = Number.isFinite(n) && h.has("X-Total-Count") ? n : null; });
  return { itens, total };
}

/** Config pública do totem (sem login). Contrato assumido; 404/erro => quem chama mantém o comportamento atual. */
export const buscarConfigPublica = () => http<unknown>("/config/publica", {}, false);

// ---------- Dashboard de desempenho (contrato: docs/api/contrato-fase18-dashboard-equipe.md; só GERENTE/ADMIN) ----------
import type { BacklogResp, EquipeResp, FluxoResp, KpisResp, MetaResp } from "./desempenho";
type ParamsMetricas = Record<string, string | undefined>;
/** Lê uma métrica do painel e garante `geradoEm`: do corpo ou do header X-Gerado-Em (a meta sem nada configurada só o traz no header). */
async function metrica<T extends object>(path: string): Promise<T> {
  let gerado: string | null = null;
  const r = await http<T>(path, {}, true, (h) => { gerado = h.get("X-Gerado-Em"); });
  return gerado && !(r as { geradoEm?: string }).geradoEm ? { ...r, geradoEm: gerado } : r;
}
export const buscarKpis = (p: ParamsMetricas) => metrica<KpisResp>(`/metricas/kpis${qs(p)}`);
export const buscarMeta = (p: ParamsMetricas) => metrica<MetaResp>(`/metricas/meta${qs(p)}`);
export const buscarEquipe = (p: ParamsMetricas) => metrica<EquipeResp>(`/metricas/equipe${qs(p)}`);
/** Backlog é foto de agora: o servidor ignora de/ate/tecnicoIds; manda só prioridade e tipo. */
export const buscarBacklog = (p: ParamsMetricas) => metrica<BacklogResp>(`/metricas/backlog${qs({ prioridade: p.prioridade, tipo: p.tipo })}`);
export const buscarFluxo = (p: ParamsMetricas, granularidade: "day" | "week" | "month") =>
  metrica<FluxoResp & Pick<MttrResp, "geral" | "porCategoria" | "porPrioridade" | "porTecnico">>(`/metricas/mttr${qs({ ...p, granularidade })}`);
export const buscarOfensoresDe = (p: ParamsMetricas) => metrica<{ itens: Ofensor[] }>(`/metricas/ofensores${qs({ ...p, limit: "10" })}`);
export const buscarPausasDe = (p: ParamsMetricas) => metrica<PausasResp>(`/metricas/pausas${qs(p)}`);

/** Painel "Atenção agora" do Modo TV (GET /metricas/atencao, até 5 itens; `total` = antes do corte). */
export interface ItemAtencaoApi { tipo: "CRITICA_SEM_RESPONSAVEL" | "RESERVA_SEM_ACEITE" | "MAIS_DE_8H" | string; id: string; numero: string; equipamento?: string; equipamentoNome?: string; prioridade?: string; idadeSegundos?: number; expiraEmSegundos?: number | null }
export interface AtencaoResp { total: number; itens: ItemAtencaoApi[]; geradoEm?: string }
export const buscarAtencao = (p: ParamsMetricas) => metrica<AtencaoResp>(`/metricas/atencao${qs({ limit: "5" })}`);

// ---------- Setores e locais padrão (Fase 22, contrato §3; só ADMIN, exceto /opcoes) ----------
const corpo = (b: object) => JSON.stringify(b);
export const listarSetoresAdmin = () => http<SetorAdmin[]>("/setores");
export const listarSetoresOpcoes = () => http<SetorOpcao[]>("/setores/opcoes?uso=equipamento");
export const criarSetor = (nome: string, ordem?: number) => post<SetorAdmin>("/setores", { nome, ...(ordem !== undefined && { ordem }) });
export const atualizarSetor = (id: string, c: { nome?: string; ativo?: boolean; ordem?: number }) =>
  http<SetorAdmin>(`/setores/${id}`, { method: "PUT", body: corpo(c) });
/** 409 SETOR_COM_VINCULOS traz `{ equipamentos, omsTotal, sugestao: "DESATIVAR" }` no corpo; 409 SETOR_PROTEGIDO no predial. */
export const excluirSetor = (id: string) => http<void>(`/setores/${id}`, { method: "DELETE" });
export const listarLocais = (setorId: string) => http<SetorLocal[]>(`/setores/${setorId}/locais`);
export const criarLocal = (setorId: string, nome: string) => post<SetorLocal>(`/setores/${setorId}/locais`, { nome });
export const atualizarLocal = (setorId: string, localId: string, c: { nome?: string; ativo?: boolean }) =>
  http<SetorLocal>(`/setores/${setorId}/locais/${localId}`, { method: "PUT", body: corpo(c) });
export const excluirLocal = (setorId: string, localId: string) => http<void>(`/setores/${setorId}/locais/${localId}`, { method: "DELETE" });
/** Reordena: `ids` = TODOS os locais do setor, na nova ordem (senão 400). */
export const reordenarLocais = (setorId: string, ids: string[]) =>
  http<void>(`/setores/${setorId}/locais/ordem`, { method: "PUT", body: corpo({ ids }) });

// ---------- Máquinas por setor (Fase 23, contrato §3; só ADMIN) ----------
export interface FiltroEquipamentos { busca?: string; status?: string; limit?: number; offset?: number }
/** O total vem em X-Total-Count. Setor predial: `itens` vazio. */
export async function listarEquipamentosDoSetor(setorId: string, f: FiltroEquipamentos = {}): Promise<{ itens: EquipamentoAdmin[]; setor: SetorOpcao; total: number | null }> {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== "") as [string, string][]).toString();
  let total: number | null = null;
  const r = await http<{ itens: EquipamentoAdmin[]; setor: SetorOpcao }>(`/setores/${setorId}/equipamentos${q ? `?${q}` : ""}`, {}, true, (h) => { const n = Number(h.get("X-Total-Count")); total = h.has("X-Total-Count") && Number.isFinite(n) ? n : null; });
  return { ...r, total };
}
export const criarEquipamento = (setorId: string, b: { tag: string; nome: string; modelo?: string; grupoId?: string }) => post<EquipamentoAdmin>(`/setores/${setorId}/equipamentos`, b);
/** `modelo: null` limpa. Mover de setor devolve `avisos: ["HISTORICO_PASSA_A_CONTAR_NO_NOVO_SETOR"]`. */
export const atualizarEquipamento = (id: string, b: { tag?: string; nome?: string; modelo?: string | null; status?: "ATIVO" | "INATIVO"; setorId?: string; grupoId?: string }) =>
  http<EquipamentoAdmin>(`/equipamentos/${id}`, { method: "PUT", body: corpo(b) });
/** 409 EQUIPAMENTO_COM_HISTORICO traz `{ omsTotal, omsAbertas, sugestao: "INATIVAR" }` no corpo. */
export const removerEquipamento = (id: string) => http<void>(`/equipamentos/${id}`, { method: "DELETE" });

// ---------- Grupos do Totem (Fase 30, contrato §4.4; só ADMIN). Conjunto fixo de 4: só nome e ordem são editáveis. ----------
export const listarGruposAdmin = () => http<GrupoAtivoAdmin[]>("/grupos-ativos");
/** 409 GRUPO_NOME_DUPLICADO · 404 GRUPO_NAO_ENCONTRADO. */
export const atualizarGrupo = (id: string, c: { nome?: string; ordem?: number }) => http<GrupoAtivoAdmin>(`/grupos-ativos/${id}`, { method: "PUT", body: corpo(c) });

// ---------- Equipamentos por grupo (Fase 31, contrato §4; só ADMIN) ----------
/** `X-Total-Count` traz o total. OUTROS devolve `itens: []` e `grupo.reservado`. */
export async function listarEquipamentosDoGrupo(grupoId: string, f: FiltroEquipamentos = {}): Promise<{ itens: EquipamentoGrupo[]; grupo: { id: string; codigo: string; nome: string; modo?: string; reservado?: boolean }; total: number | null }> {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== "") as [string, string][]).toString();
  let total: number | null = null;
  const r = await http<{ itens: EquipamentoGrupo[]; grupo: { id: string; codigo: string; nome: string; modo?: string; reservado?: boolean } }>(`/grupos-ativos/${grupoId}/equipamentos${q ? `?${q}` : ""}`, {}, true, (h) => { const n = Number(h.get("X-Total-Count")); total = h.has("X-Total-Count") && Number.isFinite(n) ? n : null; });
  return { ...r, total };
}
/** 404 GRUPO_NAO_ENCONTRADO · 422 GRUPO_RESERVADO · 409 EQUIPAMENTO_TAG_DUPLICADA. */
export const criarEquipamentoNoGrupo = (grupoId: string, b: { tag: string; nome: string; modelo?: string; setorId: string }) => post<EquipamentoGrupo>(`/grupos-ativos/${grupoId}/equipamentos`, b);
