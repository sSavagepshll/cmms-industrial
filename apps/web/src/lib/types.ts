export type Impacto = "PARADA" | "OPERANDO";
export type Prioridade = "BAIXA" | "MEDIA" | "ALTA" | "CRITICA";
export type CategoriaKey = "MECANICO" | "ELETRICO" | "PNEUMATICO_HIDRAULICO" | "INSTRUMENTACAO" | "SEGURANCA" | "CIVIL_PREDIAL" | "OUTROS";

export interface Operador {
  id: string;
  nome: string;
  perfil: string;
}

/** Local padrão do setor predial (chips do Totem). */
export interface LocalPadrao { id: string; nome: string }
export interface Setor {
  /** Fase 22 (aditivo): id do setor; locais padrão ativos, só no setor predial. */
  id?: string;
  locais?: LocalPadrao[];
  setor: string;
  equipamentos: number;
  /** Setor reservado "Outros" (manutenção predial/geral): pede o local em vez de listar máquinas. */
  predial?: boolean;
}

export interface Equipamento {
  id: string;
  codigo: string; // TAG
  nome: string;
  setor: string;
  localizacao: string | null;
  omsAtivas: number;
  /** Pseudo-ativo PREDIAL (Fase 20): a OM exige `localDescricao`. */
  predial?: boolean;
  /** Fase 30: código do grupo do Totem (PRODUTIVOS, IMPRODUTIVOS, MOLDES, PREDIAL_OUTROS). */
  grupo?: string;
  /** Fase 31: pseudo-ativo do grupo OUTROS (item não cadastrado, descrito em texto livre). */
  itemLivre?: boolean;
}

/** Item de GET /equipamentos/grupos: sempre os 4 grupos; `total` 0 = grupo vazio. */
/** Fase 35: o `modo` é sempre LISTA; o item avulso é um pseudo-ativo (`itemLivre`) dentro de PREDIAL_OUTROS. Campos legados mantidos opcionais. */
export interface GrupoAtivo { codigo: string; nome: string; ordem: number; total: number; modo?: "LISTA" | "TEXTO_LIVRE"; equipamentoId?: string }

/** Local padrão da manutenção predial (GET /equipamentos/locais). */
export interface LocalPredial { id: string; nome: string }

export interface OmAberta {
  id: string;
  numero: string;
  status: string;
  dataAbertura: string; // ISO
  solicitante: { id: string; nome: string };
  localDescricao?: string | null;
  itemDescricao?: string | null;
}

export interface NovaOm {
  equipamentoId: string;
  maquinaParada: boolean;
  categoria: CategoriaKey;
  sintomas: string[];
  totemIdOrigem: string;
  observacao?: string;
  confirmarDuplicidade: boolean;
  /** Só para equipamento predial (obrigatório nele; 1–100). */
  localDescricao?: string;
  /** Fase 31: só para o pseudo-ativo do grupo OUTROS (3–100). */
  itemDescricao?: string;
  // Fase 30 (US-15): o Totem NÃO envia tipoAtivo/custoTipo/centroCusto; o servidor deriva o tipo e grava custo INTERNO.
}

export interface OmCriada {
  id: string;
  numero: string; // OM-AAAA-NNNNNN
  prioridade: Prioridade;
}

// ---------- Kanban do Técnico ----------
export type StatusKanban = "ABERTO" | "EM_ATENDIMENTO" | "PAUSADO" | "AGUARDANDO_APROVACAO" | "AGUARDANDO_BAIXA" | "CONCLUIDO";
export type MotivoPausa = "AGUARDANDO_PECA" | "AGUARDANDO_PRODUCAO" | "REFEICAO" | "TROCA_TURNO" | "AGUARDANDO_SUPORTE" | "OUTRO";

export interface OmKanban {
  id: string;
  numero: string;
  titulo: string;
  descricao: string | null;
  categoria: string | null;
  sintomas: string[];
  totemIdOrigem: string | null;
  prioridade: Prioridade;
  status: string;
  statusKanban: StatusKanban;
  dataAbertura: string;
  /** Fase 35: setor fiel ao ativo (API `setorExibicao`); em API antiga `setorDaOm` deriva do equipamento. */
  setorExibicao?: string;
  equipamento: { id: string; codigo: string; nome: string; setor: string; localizacao: string | null; predial?: boolean; itemLivre?: boolean };
  localDescricao?: string | null;
  itemDescricao?: string | null;
  solicitante: { id: string; nome: string };
  responsavel: { id: string; nome: string } | null;
  // Novos (Back-end Fase 8). Opcionais: sem eles o front usa o estado local.
  cronometroAtivo?: boolean;
  tempoLiquidoSegundos?: number;
  /** Reprovação do supervisor (a OM volta a EM_ATENDIMENTO). Opcional: depende de a API expor na fila / OM. */
  motivoReprovacao?: string | null;
  tipoAtivo?: TipoAtivo;
  /** Fase 21: aprovação da produção e conclusão pelo gestor (null/ausente em OMs legadas). */
  aprovadoPor?: { id: string; nome: string } | null;
  dataAprovacao?: string | null;
  concluidoPor?: { id: string; nome: string } | null;
  concluidoEm?: string | null;
  tipoAtivoOutro?: string | null;
  /** Rótulo calculado pelo servidor (Molde/Máquina/Robô/texto digitado). */
  tipoAtivoRotulo?: string | null;
  centroCusto?: string | null;
  custoTipo?: CustoTipo;
  // ---- Atribuição (só em OMs ABERTA/RESERVADA; calculado pelo servidor conforme o usuário logado) ----
  urgente?: boolean;
  situacaoAtribuicao?: SituacaoAtribuicao;
  reservadaPara?: { id: string; nome: string } | null;
  delegadoPor?: { id: string; nome: string } | null;
  delegadoEm?: string | null;
  /** Urgente sem responsável: segundos até a liberação automática para qualquer técnico (RN-22). */
  liberaEmSegundos?: number;
  /** Reserva (US-12): segundos até expirar (15 min da delegação) e se já está na janela de aviso (a partir dos 10 min). */
  reservaExpiraEmSegundos?: number | null;
  reservaAvisando?: boolean;
  podeAssumir?: boolean;
  podeRecusar?: boolean;
  /** Só para GERENTE/ADMIN, em OM devolvida pela recusa. */
  recusadoPor?: { id: string; nome: string } | null;
  recusadoEm?: string | null;
  motivoRecusa?: string | null;
  /** Client-side: Date.now() de quando a fila foi recebida (referência do tempo líquido; evita skew de relógio). */
  recebidoEm?: number;
}

/** Como a OM aberta está distribuída (calculado no servidor, regras.ts). */
export type SituacaoAtribuicao = "RESERVADA" | "PARA_PUXAR" | "URGENTE_AGUARDA_GERENTE" | "LIBERADA" | "DEVOLVIDA";

export interface FilaKanban {
  /** Relógio do banco (ISO). */
  agora?: string;
  colunas: Record<StatusKanban, OmKanban[]>;
  total: number;
}

export interface Nota {
  id: string;
  nota: string;
  criadoEm: string;
  autor: { id: string; nome: string };
}

export interface ConclusaoOm { causaRaiz: string; acaoExecutada: string; parecer?: string }
export interface ResultadoTempo { tempoLiquidoSegundos: number; statusKanban: StatusKanban }


// ---------- Fase 12: formulário físico da Apex Industrial Technologies ----------
/** ROBO é legado (OMs antigas): o totem oferece Molde, Máquina e OUTRO (texto livre). */
export type TipoAtivo = "MOLDE" | "MAQUINA" | "ROBO" | "OUTRO";
export type CustoTipo = "INTERNO" | "CLIENTE";


/** Linha da tabela "Horas trabalhadas" do verso do formulário. */
export interface Apontamento {
  id: string;
  inicio: string; // ISO
  fim: string | null; // null = cronômetro em andamento
  manual: boolean; // lançamento retroativo
  observacao: string | null;
  tecnico: { id: string; nome: string };
}
export interface NovoApontamentoManual { inicio: string; fim: string; observacao?: string }

/** Linha da tabela de materiais (QDE, UNIDADE, DESCRIÇÃO, INTER., CONF. N.F.). */
export interface Material {
  id: string;
  descricao: string;
  quantidade: number;
  unidade: string;
  flagInterno?: boolean;
  confNf?: boolean;
  registrou?: { id: string; nome: string };
  criadoEm: string;
}
export interface NovoMaterial { descricao: string; quantidade: number; unidade: string; flagInterno: boolean; confNf: boolean }


// ---------- Aprovação de Supervisão (API V006) ----------
/** GERENTE e ADMIN: Painel Administrativo e Atribuir/Despacho (back-end: painelAdmin / soGerente). */
export const ehGestor = (perfil: string) => perfil === "GERENTE" || perfil === "ADMIN";
/** Perfis que decidem aprovações (back-end: perfilAprovador). Fase 21: o GERENTE NÃO aprova; o ADMIN é o coringa. O escopo vem da API. */
export const decideAprovacao = (perfil: string) => perfil === "OPERADOR" || perfil === "LIDER_PRODUCAO" || perfil === "ADMIN";
// ---------- Acesso por portal (Fase 32 / US-17; fonte única da política no front) ----------
export const PERFIS_TOTEM = ["OPERADOR", "LIDER_PRODUCAO", "ADMIN"] as const;
export const PERFIS_PORTAL_TECNICO = ["TECNICO", "ADMIN"] as const;
export const MSG_TOTEM_TECNICO = "Acesso restrito. Técnicos de manutenção devem utilizar o portal exclusivo (/tecnico).";
export const MSG_TOTEM_OUTRO = "Acesso restrito. Utilize o painel de gestão (/admin).";
export const MSG_PORTAL_TECNICO = "Acesso exclusivo para técnicos de manutenção e administradores.";
export const podeNoTotem = (p: string) => (PERFIS_TOTEM as readonly string[]).includes(p);
export const podeNoPortalTecnico = (p: string) => (PERFIS_PORTAL_TECNICO as readonly string[]).includes(p);
export const msgBloqueioTotem = (p: string) => (p === "TECNICO" ? MSG_TOTEM_TECNICO : MSG_TOTEM_OUTRO);

/** Fase 21: concluem a OM aprovada (status AGUARDANDO_BAIXA; back-end: perfilConcluidor). Na interface: "Aguardando conclusão". */
export const concluiOm = (perfil: string) => perfil === "GERENTE" || perfil === "ADMIN";
/** Atendem OM no Kanban (back-end: soTecnico). O GERENTE também atende. */
export const atendeOm = (perfil: string) => perfil === "TECNICO" || ehGestor(perfil);
/** RN-28: TECNICO não abre OM (a API responde 403). */
export const abreOm = (perfil: string) => perfil !== "TECNICO";

/** Técnico que executou a OM (apontamentos não excluídos); o responsável vem primeiro. */
export interface Executor { id: string; nome: string; tempoSegundos: number; responsavel: boolean }

/** Item de GET /ordens/conclusoes-pendentes (Fase 21): OM aprovada pela produção, aguardando "Concluir OM" pelo gestor. */
export interface ConclusaoPendente {
  id: string;
  numero: string;
  titulo: string;
  status: string;
  prioridade: Prioridade;
  dataAbertura: string;
  solucao: string | null;
  dataConclusao: string | null;
  /** Fase 35: setor fiel ao ativo (API `setorExibicao`); em API antiga `setorDaOm` deriva do equipamento. */
  setorExibicao?: string;
  equipamento: { id: string; codigo: string; nome: string; setor: string; localizacao?: string | null; predial?: boolean };
  localDescricao?: string | null;
  itemDescricao?: string | null;
  executores: Executor[];
  aprovadoPor: { id: string; nome: string; perfil: string } | null;
  dataAprovacao: string | null;
  /** Solicitante, quando o aprovador decidiu no lugar dele (líder/admin); null = aprovou o próprio solicitante. */
  aprovadoEmNomeDe: { id: string; nome: string } | null;
  podeConcluir: boolean;
  /** AUTOCONCLUSAO_PROIBIDA quando o usuário atual executou a OM. */
  motivoBloqueio?: string | null;
}

/** Item de GET /ordens/aprovacoes: OM finalizada pelo técnico, aguardando o aceite de um superior. */
export interface Aprovacao {
  id: string;
  numero: string;
  titulo: string;
  descricao: string | null;
  categoria: string | null;
  sintomas: string[];
  totemIdOrigem: string | null;
  prioridade: Prioridade;
  status: string;
  dataAbertura: string;
  dataConclusao: string | null;
  /** "Causa raiz: …\nAção executada: …\nParecer: …" (montado pela API em /concluir). */
  solucao: string | null;
  // ---- Escopo por perfil (calculado pelo servidor para o usuário logado) ----
  podeAprovar?: boolean;
  /** Líder: segundos até poder decidir no lugar do operador (RN-21). */
  aprovaEmSegundos?: number;
  /** Nome do operador quando o decisor age "em nome de" (líder/gerente). */
  decideEmNomeDe?: string | null;
  /** AGUARDE_OPERADOR | AUTOAPROVACAO_PROIBIDA | ACESSO_NEGADO */
  motivoBloqueio?: string | null;
  /** Fase 35: setor fiel ao ativo (API `setorExibicao`); em API antiga `setorDaOm` deriva do equipamento. */
  setorExibicao?: string;
  equipamento: { id: string; codigo: string; nome: string; setor: string; localizacao: string | null; predial?: boolean; itemLivre?: boolean };
  localDescricao?: string | null;
  itemDescricao?: string | null;
  solicitante: { id: string; nome: string };
  responsavel: { id: string; nome: string } | null;
}

// ---------- Painel Admin: métricas (GET /metricas/*) ----------
export interface ResumoMttr { ordensConcluidas: number; mttrLiquidoSegundos: number | null; mttrTotalSegundos: number | null; mttaSegundos: number | null }
export interface MttrResp {
  periodo: { de: string; ate: string };
  geral: ResumoMttr;
  serie: ({ periodo: string } & ResumoMttr)[];
  porSetor: ({ setor: string } & ResumoMttr)[];
}
export interface Ofensor { posicao: number; chave: string; rotulo: string; ocorrencias: number; maquinaParada: number; tempoParadaSegundos: number; tempoReparoLiquidoSegundos: number }
export interface PausaItem { posicao: number; motivo: string; pausas: number; emCurso: number; tempoTotalSegundos: number; tempoMedioSegundos: number; percentualDoTempo: number }
export interface PausasResp { totalPausas: number; tempoTotalPausadoSegundos: number; itens: PausaItem[] }
export interface OmLista {
  id: string; numero: string; titulo: string; prioridade: Prioridade; status: string; dataAbertura: string;
  categoria: string | null; sintomas: string[];
  /** Fase 35: setor fiel ao ativo (API `setorExibicao`); em API antiga `setorDaOm` deriva do equipamento. */
  setorExibicao?: string;
  equipamento: { id: string; codigo: string; nome: string; setor: string };
  solicitante: { id: string; nome: string };
}

// ---------- Gerenciador de Usuários (Painel Admin, só ADMIN) ----------
export type PerfilUsuario = "ADMIN" | "GERENTE" | "TECNICO" | "OPERADOR" | "LIDER_PRODUCAO";

/** Perfis do enum `perfil_usuario` (V008), com texto para a tela. */
export const PERFIS: { key: PerfilUsuario; label: string; desc: string; resumo: string; aviso?: string }[] = [
  { key: "OPERADOR", label: "Operador", desc: "Abre chamados no totem",
    resumo: "Abre OM. Aprova somente as OMs que ele abriu. Não puxa nem delega OMs. Sem acesso às configurações." },
  { key: "LIDER_PRODUCAO", label: "Líder de Produção", desc: "Abre e aprova OMs",
    resumo: "Abre OM. Aprova OMs da sua equipe depois do prazo sem decisão do operador (padrão 30 min). Não puxa nem delega OMs. Sem acesso às configurações." },
  { key: "TECNICO", label: "Técnico", desc: "Atende OMs (Kanban)",
    resumo: "Atende OMs no Kanban (puxa só as não urgentes) e recebe delegações. Nunca aprova OMs.", aviso: "Não abre OM." },
  { key: "GERENTE", label: "Gerente", desc: "Painel, métricas e aprovações",
    resumo: "Abre OM. Aprova qualquer OM (exceto as que executou). Puxa OMs da fila e delega as urgentes. Sem acesso às configurações." },
  { key: "ADMIN", label: "Administrador", desc: "Acesso total, inclui usuários",
    resumo: "Tudo do Gerente, mais as configurações globais (usuários, e-mail e parâmetros)." },
];
export const rotuloPerfil = (p: string) => PERFIS.find((x) => x.key === p)?.label ?? p;

export interface Usuario {
  id: string;
  nome: string;
  matricula: string | null;
  perfil: PerfilUsuario;
  ativo: boolean;
  /** A API só informa se há PIN cadastrado (o hash nunca sai do servidor). Sem PIN o usuário não consegue entrar. */
  temPin?: boolean;
  /** Bloqueio por tentativas erradas de PIN (ISO); null = não bloqueado. */
  bloqueadoAte?: string | null;
  /** Opcional: usado só para enviar alertas (faz sentido para TECNICO e GERENTE). */
  email?: string | null;
  criadoEm?: string;
}
/** O PIN (4 a 6 dígitos) é enviado só na criação/redefinição e nunca devolvido pela API. */
/** `email` só é enviado quando o Admin preenche. */
export interface NovoUsuario { nome: string; matricula: string; perfil: PerfilUsuario; pin: string; email?: string }
/** `email: null` remove o e-mail cadastrado. */
export interface EdicaoUsuario { nome?: string; perfil?: PerfilUsuario; ativo?: boolean; email?: string | null }

// ---------- Parâmetros do Sistema (GET/PUT /configuracoes, só ADMIN) ----------
export type TipoConfig = "TEXTO" | "NUMERO" | "BOOLEANO" | "JSON" | "SECRETO";
export interface ConfiguracaoItem {
  chave: string;
  /** SECRETO vem SEMPRE mascarado ("********"), mesmo quando não há valor. */
  valor: string | null;
  tipo: TipoConfig;
  grupo: string;
  descricao: string | null;
  atualizadoEm: string;
  atualizadoPor?: string | null;
  /** Metas (V013): unidade ("min"), faixa válida e padrão (null = sem valor padrão aprovado). Ausentes nos demais parâmetros. */
  unidade?: string | null; min?: number | null; max?: number | null; padrao?: string | null;
}
export const MASCARA_SECRETO = "********";

// ---------- Despacho / Atribuir técnico (GET /usuarios/tecnicos, só GERENTE/ADMIN) ----------
export interface TecnicoCarga {
  id: string;
  nome: string;
  matricula: string | null;
  perfil: string;
  emAtendimento: number;
  reservadas: number;
  cronometroAtivo: boolean;
  /** A API só distingue estes dois (não há "sem turno"). */
  situacao: "DISPONIVEL" | "EM_ATENDIMENTO";
}

// ---------- Auditoria (GET /auditoria, só ADMIN, somente leitura) ----------
export interface AuditoriaItem {
  id: string;
  criadoEm: string;
  acao: string;
  alvoTipo: "USUARIO" | "OM" | "PARAMETRO" | "SETOR" | "EQUIPAMENTO" | "GRUPO_ATIVO";
  alvoId: string;
  alvoRotulo: string | null;
  ator: { id: string | null; nome: string; perfil: string } | null;
  emNomeDe: { id: string; nome: string } | null;
  /** Só metadados: a API nunca grava PIN, senha nem valor de segredo. */
  detalhe: Record<string, unknown> | null;
}

// ---------- Dashboard: quebras do MTTR (contrato ASSUMIDO: o Back-end ainda só envia `porSetor`) ----------
/** Uma linha de `porCategoria` / `porPrioridade` / `porTecnico`. O rótulo vem de `rotulo`, da chave específica ou de `chave` (leitura defensiva). */
export interface QuebraMttr {
  chave?: string;
  rotulo?: string;
  categoria?: string;
  prioridade?: string;
  tecnico?: string | { id?: string; nome?: string };
  ordensConcluidas: number;
  mttrLiquidoSegundos: number | null;
  mttrTotalSegundos: number | null;
}
/** Mescla com a MttrResp acima (declaration merging): campos opcionais até o Back-end publicar. */
export interface MttrResp {
  porCategoria?: QuebraMttr[];
  porPrioridade?: QuebraMttr[];
  porTecnico?: QuebraMttr[];
}

// ---------- Setores (Fase 22, Painel Admin, só ADMIN) ----------
/** Item de GET /setores. `motivoNaoExclui`: SETOR_COM_VINCULOS | SETOR_PROTEGIDO. */
export interface SetorAdmin {
  id: string; nome: string; ativo: boolean; predial: boolean; ordem: number;
  equipamentos: number; equipamentosAtivos: number; omsAbertas: number; omsTotal: number;
  podeExcluir: boolean; motivoNaoExclui?: string | null; locais?: number;
  avisos?: string[];
}
/** Item de GET /setores/:id/locais. */
export interface SetorLocal { id: string; nome: string; ativo: boolean; ordem: number }
/** Item de GET /setores/opcoes (inclui inativos, para filtros históricos). */
export interface SetorOpcao { id: string; nome: string; ativo: boolean; predial: boolean }

// ---------- Máquinas por setor (Fase 23, só ADMIN) ----------
export type StatusEquipamento = "ATIVO" | "INATIVO" | "EM_MANUTENCAO" | "DESCARTADO";
/** Item de GET /setores/:id/equipamentos. `tag` = código do equipamento. EM_MANUTENCAO/DESCARTADO são legados (só exibição). */
export interface EquipamentoAdmin {
  id: string; tag: string; nome: string; modelo: string | null; status: StatusEquipamento;
  setorId: string; setorNome: string; grupoId?: string; grupoCodigo?: string; grupoNome?: string; omsAbertas: number; omsTotal: number; criadoEm: string; atualizadoEm: string;
  avisos?: string[];
}

/** Item de GET /grupos-ativos (ADMIN, Fase 30): os 4 grupos do Totem, com contagens (inclui inativos). */
export interface GrupoAtivoAdmin {
  id: string; codigo: string; nome: string; ordem: number; equipamentos: number; equipamentosAtivos: number;
  /** Fase 35: PREDIAL_OUTROS é `reservado` (só predial e item avulso; sem equipamentos cadastráveis). */
  modo?: "LISTA" | "TEXTO_LIVRE"; reservado?: boolean; equipamentosInativos?: number;
}

/** Item de GET /grupos-ativos/:id/equipamentos (Fase 31). `predial` = pseudo-ativo, somente leitura. */
export interface EquipamentoGrupo { id: string; tag: string; nome: string; modelo: string | null; status: StatusEquipamento; predial?: boolean; grupoId: string; omsAtivas: number; setorId: string; setorNome: string }
export type CustoEncerramento = "INTERNO" | "CLIENTE";
