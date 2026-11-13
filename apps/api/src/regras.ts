import { prisma } from './db.js';

// Regras de negócio do modelo híbrido (US-11) e da aprovação. Funções puras no fim do arquivo (testáveis sem banco).
// Parâmetros editáveis pelo ADMIN em configuracoes_globais (grupo SLA); valem os padrões enquanto não houver valor válido.

export interface Politicas {
  /** RN-22: minutos sem responsável para a OM urgente (máquina parada) ficar liberada a qualquer técnico. */
  fallbackUrgenteMin: number;
  /** US-12 §4: minutos para o técnico aceitar uma OM reservada; passado o prazo a reserva expira. */
  reservaAceiteMin: number;
  /** US-12 §4: minutos após a delegação em que técnico e gerente são avisados (deve ser < reservaAceiteMin). */
  reservaAvisoMin: number;
  /** RN-21: minutos aguardando aprovação para o líder decidir no lugar do operador. */
  liderAprovaAposMin: number;
}

/** Urgente = máquina parada = prioridade CRITICA (RN-03). `ALTA` é pull normal do técnico. */
export const PRIORIDADE_URGENTE = 'CRITICA';

export interface MetaConfig {
  unidade?: string;
  min?: number;
  max?: number;
  padrao: number | string | null;
  opcional?: boolean; // vazio/NULL é válido (ex.: metas ainda não aprovadas)
  opcoes?: string[]; // valores aceitos (enum)
  formato?: string; // 'HH:mm'
}
export const METADADOS_CONFIG: Record<string, MetaConfig> = {
  OM_FALLBACK_URGENTE_MIN: { unidade: 'min', min: 1, max: 1440, padrao: 10 },
  OM_RESERVA_ACEITE_MIN: { unidade: 'min', min: 1, max: 1440, padrao: 15 },
  OM_RESERVA_AVISO_MIN: { unidade: 'min', min: 1, max: 1440, padrao: 10 },
  OM_LIDER_APROVA_APOS_MIN: { unidade: 'min', min: 1, max: 1440, padrao: 30 },
  SMTP_PORT: { unidade: '', min: 1, max: 65535, padrao: 587 },
  // Metas de atendimento (Fase 18): SEM padrão e vazias até o Analista aprovar. Em minutos.
  META_MTTA_MIN_CRITICA: { unidade: 'min', min: 1, max: 10080, padrao: null, opcional: true },
  META_MTTA_MIN_ALTA: { unidade: 'min', min: 1, max: 10080, padrao: null, opcional: true },
  META_MTTA_MIN_MEDIA: { unidade: 'min', min: 1, max: 10080, padrao: null, opcional: true },
  META_MTTA_MIN_BAIXA: { unidade: 'min', min: 1, max: 10080, padrao: null, opcional: true },
  META_MTTR_MIN: { unidade: 'min', min: 1, max: 10080, padrao: null, opcional: true },
  // Limiares das zonas do dashboard executivo (PROPOSTAS, vazias até aprovação)
  ZONA_META_OK_PCT: { unidade: '%', min: 1, max: 100, padrao: null, opcional: true },
  ZONA_META_ATENCAO_PCT: { unidade: '%', min: 1, max: 100, padrao: null, opcional: true },
  ZONA_MTTR_ATENCAO_PCT: { unidade: '%', min: 100, max: 1000, padrao: null, opcional: true },
  TEMA_TOTEM_MODO: { opcoes: ['AUTO', 'CLARO', 'ESCURO', 'HORARIO'], padrao: 'AUTO' },
  TEMA_TOTEM_ESCURO_INICIO: { formato: 'HH:mm', padrao: '18:00' },
  TEMA_TOTEM_ESCURO_FIM: { formato: 'HH:mm', padrao: '06:00' },
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Valida o valor de uma chave com regra conhecida (retorna a mensagem de erro, ou null se ok / sem regra). */
export function validarValorConfig(chave: string, valor: string | null): string | null {
  const m = METADADOS_CONFIG[chave];
  if (!m) return null;
  if (m.opcional && (valor === null || valor.trim() === '')) return null;
  if (m.opcoes) {
    return valor !== null && m.opcoes.includes(valor) ? null : `Valor inválido. Use: ${m.opcoes.join(', ')}.`;
  }
  if (m.formato === 'HH:mm') {
    return valor !== null && HHMM.test(valor) ? null : 'Informe o horário no formato HH:mm (00:00 a 23:59).';
  }
  const n = Number(valor);
  if (valor === null || valor.trim() === '' || !Number.isInteger(n) || n < m.min! || n > m.max!) {
    return `Informe um número inteiro entre ${m.min} e ${m.max}${m.unidade ? ` (${m.unidade})` : ''}.`;
  }
  return null;
}

const TTL_MS = 15_000;
let cache: { em: number; valor: Politicas } | null = null;
export const invalidarPoliticas = () => { cache = null; cacheMetas = null; };

export async function lerPoliticas(): Promise<Politicas> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.valor;
  const rows = await prisma.configuracaoGlobal.findMany({
    where: { chave: { in: ['OM_FALLBACK_URGENTE_MIN', 'OM_LIDER_APROVA_APOS_MIN', 'OM_RESERVA_ACEITE_MIN', 'OM_RESERVA_AVISO_MIN'] } },
    select: { chave: true, valor: true },
  });
  const m = new Map(rows.map((r) => [r.chave, r.valor]));
  const num = (k: string, padrao: number) => (validarValorConfig(k, m.get(k) ?? null) === null ? Number(m.get(k)) : padrao);
  const valor: Politicas = {
    fallbackUrgenteMin: num('OM_FALLBACK_URGENTE_MIN', Number(METADADOS_CONFIG.OM_FALLBACK_URGENTE_MIN!.padrao)),
    liderAprovaAposMin: num('OM_LIDER_APROVA_APOS_MIN', Number(METADADOS_CONFIG.OM_LIDER_APROVA_APOS_MIN!.padrao)),
    reservaAceiteMin: num('OM_RESERVA_ACEITE_MIN', Number(METADADOS_CONFIG.OM_RESERVA_ACEITE_MIN!.padrao)),
    reservaAvisoMin: num('OM_RESERVA_AVISO_MIN', Number(METADADOS_CONFIG.OM_RESERVA_AVISO_MIN!.padrao)),
  };
  if (valor.reservaAvisoMin >= valor.reservaAceiteMin) valor.reservaAvisoMin = Math.max(1, valor.reservaAceiteMin - 1); // incoerência no banco: avisa 1 min antes
  cache = { em: Date.now(), valor };
  return valor;
}

/** Perfil atual no banco (o JWT pode ter até JWT_EXPIRES_IN de defasagem). null = inativo/inexistente. */
export async function perfilAtual(userId: bigint): Promise<string | null> {
  const u = await prisma.usuario.findUnique({ where: { id: userId }, select: { perfil: true, ativo: true } });
  return u?.ativo ? u.perfil : null;
}

// ======================= regras puras =======================

export interface Resultado {
  permitido: boolean;
  codigo?: string;
  status?: number; // HTTP sugerido quando negado
  motivo?: string;
  liberaEmSegundos?: number;
}
const OK: Resultado = { permitido: true };
const nega = (status: number, codigo: string, motivo: string, liberaEmSegundos?: number): Resultado =>
  ({ permitido: false, status, codigo, motivo, ...(liberaEmSegundos !== undefined && { liberaEmSegundos }) });

export type SituacaoAtribuicao = 'RESERVADA' | 'PARA_PUXAR' | 'URGENTE_AGUARDA_GERENTE' | 'LIBERADA' | 'DEVOLVIDA';

export interface OmAtribuicao {
  status: string; // ABERTA | RESERVADA (demais não entram na lógica de pull)
  prioridade: string;
  responsavelId: bigint | null;
  /** ABERTA devolvida pela recusa do técnico (motivo_recusa preenchido): fica com o gerente, fora do pull. */
  devolvida: boolean;
  /** Segundos até o fallback da RN-22 (<= 0: já liberada). Só vale para urgentes. */
  segundosAteFallback: number;
}

export function situacaoAtribuicao(o: OmAtribuicao): SituacaoAtribuicao {
  if (o.status === 'RESERVADA') return 'RESERVADA';
  const urgente = o.prioridade === PRIORIDADE_URGENTE;
  if (urgente && o.segundosAteFallback <= 0) return 'LIBERADA';
  if (o.devolvida) return 'DEVOLVIDA';
  return urgente ? 'URGENTE_AGUARDA_GERENTE' : 'PARA_PUXAR';
}

/**
 * Quem pode ASSUMIR (puxar/aceitar) uma OM.
 *  - RESERVADA: só o técnico reservado (RN-23), com PIN.
 *  - GERENTE/ADMIN: qualquer OM ABERTA (RN-27) — gerente também atende.
 *  - TECNICO: não urgentes (D2), urgentes só após o fallback (RN-22); devolvida pela recusa não vai ao pull.
 */
export function podeAssumir(o: OmAtribuicao, userId: bigint, perfil: string): Resultado {
  if (!['TECNICO', 'GERENTE', 'ADMIN'].includes(perfil)) return nega(403, 'ACESSO_NEGADO', 'Seu perfil não atende OMs.');
  const sit = situacaoAtribuicao(o);
  if (sit === 'RESERVADA') {
    return o.responsavelId === userId ? OK : nega(409, 'OM_RESERVADA', 'Esta OM está reservada para outro técnico (aguardando o aceite dele).');
  }
  if (perfil !== 'TECNICO') return OK;
  if (sit === 'URGENTE_AGUARDA_GERENTE') {
    const falta = Math.ceil(o.segundosAteFallback);
    return nega(403, 'URGENTE_REQUER_GERENTE', 'Esta OM urgente será designada pelo gerente.', falta);
  }
  if (sit === 'DEVOLVIDA') return nega(403, 'OM_DEVOLVIDA', 'Esta OM foi recusada e voltou para o gerente redelegar.');
  return OK; // PARA_PUXAR ou LIBERADA
}

export interface OmAprovacao {
  solicitanteId: bigint;
  responsavelId: bigint | null;
  /** O usuário tem apontamento válido na OM (executou) — RN-24. */
  executouPeloUsuario: boolean;
  /** Segundos até o líder poder decidir (RN-21b). <= 0: liberado. */
  segundosAteLider: number;
}

/**
 * Quem pode aprovar/reprovar uma OM aguardando aprovação.
 *  - RN-24: quem executou nunca decide;  OPERADOR: só as próprias;
 *  - LIDER_PRODUCAO: as próprias; as de operadores só após o prazo (RN-21b), "em nome de" o operador
 *    (escopo de equipe = D4, em aberto: por enquanto vale para todos os operadores);
 *  - ADMIN (coringa): qualquer OM, sem espera.  GERENTE e TECNICO: nunca (Fase 21: o gerente só conclui).
 */
export function podeAprovar(o: OmAprovacao, userId: bigint, perfil: string): Resultado & { emNomeDe: boolean } {
  const deny = (r: Resultado) => ({ ...r, emNomeDe: false });
  if (o.executouPeloUsuario || o.responsavelId === userId) {
    return deny(nega(403, 'AUTOAPROVACAO_PROIBIDA', 'Você executou esta OM e não pode decidir sobre ela.'));
  }
  const propria = o.solicitanteId === userId;
  switch (perfil) {
    case 'OPERADOR':
      return propria ? { ...OK, emNomeDe: false } : deny(nega(403, 'ACESSO_NEGADO', 'Um operador só decide sobre os chamados que abriu.'));
    case 'LIDER_PRODUCAO':
      if (propria) return { ...OK, emNomeDe: false };
      if (o.segundosAteLider > 0) {
        return deny(nega(403, 'AGUARDE_OPERADOR', 'Aguardando o operador que abriu a OM.', Math.ceil(o.segundosAteLider)));
      }
      return { ...OK, emNomeDe: true };
    case 'ADMIN':
      return { ...OK, emNomeDe: !propria };
    case 'GERENTE':
      return deny(nega(403, 'ACESSO_NEGADO', 'O gerente não aprova OMs; ele conclui após a aprovação da produção.'));
    default:
      return deny(nega(403, 'ACESSO_NEGADO', 'Seu perfil não aprova OMs.'));
  }
}

// ---------- Metas de atendimento (segundos; null = sem meta) ----------
export interface Metas {
  mtta: Record<'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA', number | null>;
  mttr: number | null;
  /** Limiares das zonas (null = não aprovado/zonas desligadas). */
  zonas: { metaOkPct: number | null; metaAtencaoPct: number | null; mttrAtencaoPct: number | null };
}
let cacheMetas: { em: number; valor: Metas } | null = null;

export async function lerMetas(): Promise<Metas> {
  if (cacheMetas && Date.now() - cacheMetas.em < TTL_MS) return cacheMetas.valor;
  const rows = await prisma.configuracaoGlobal.findMany({
    where: { OR: [{ chave: { startsWith: 'META_' } }, { chave: { startsWith: 'ZONA_' } }] },
    select: { chave: true, valor: true },
  });
  const m = new Map(rows.map((r) => [r.chave, r.valor]));
  // Valor ausente, vazio ou inválido = sem meta (nunca inventa meta).
  const seg = (k: string): number | null => {
    const v = m.get(k);
    return v != null && v.trim() !== '' && validarValorConfig(k, v) === null ? Number(v) * 60 : null;
  };
  const inteiro = (k: string): number | null => {
    const v = m.get(k);
    return v != null && v.trim() !== '' && validarValorConfig(k, v) === null ? Number(v) : null;
  };
  const valor: Metas = {
    mtta: { CRITICA: seg('META_MTTA_MIN_CRITICA'), ALTA: seg('META_MTTA_MIN_ALTA'), MEDIA: seg('META_MTTA_MIN_MEDIA'), BAIXA: seg('META_MTTA_MIN_BAIXA') },
    mttr: seg('META_MTTR_MIN'),
    zonas: {
      metaOkPct: inteiro('ZONA_META_OK_PCT'), metaAtencaoPct: inteiro('ZONA_META_ATENCAO_PCT'), mttrAtencaoPct: inteiro('ZONA_MTTR_ATENCAO_PCT'),
    },
  };
  cacheMetas = { em: Date.now(), valor };
  return valor;
}


// ---------- Zonas do dashboard (US-12 §3), puras para teste ----------
export type Zona = 'OK' | 'ATENCAO' | 'CRITICA';

/** Cumprimento da meta de MTTA: >= OK% verde; >= ATENÇÃO% amarela; abaixo, crítica. null = sem dado ou limiar não definido. */
export const zonaMta = (p: number | null, z: { metaOkPct: number | null; metaAtencaoPct: number | null }): Zona | null =>
  p === null || z.metaOkPct === null || z.metaAtencaoPct === null ? null : p >= z.metaOkPct ? 'OK' : p >= z.metaAtencaoPct ? 'ATENCAO' : 'CRITICA';

/** MTTR em % da meta (menor = melhor): <= 100 verde; <= ZONA_MTTR_ATENCAO_PCT amarela; acima, crítica. */
export const zonaMttr = (pctMeta: number | null, z: { mttrAtencaoPct: number | null }): Zona | null =>
  pctMeta === null || z.mttrAtencaoPct === null ? null : pctMeta <= 100 ? 'OK' : pctMeta <= z.mttrAtencaoPct ? 'ATENCAO' : 'CRITICA';
