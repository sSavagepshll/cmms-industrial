import type { FastifyBaseLogger } from 'fastify';
import { prisma, type Tx } from '../db.js';
import { publicar } from '../events.js';
import { auditar } from '../auditoria.js';
import { lerPoliticas } from '../regras.js';

/**
 * Fase 34: cada ciclo roda numa transação que PRIMEIRO toma um advisory lock transacional (liberado no COMMIT/ROLLBACK, inclusive
 * em crash). Com mais de uma réplica os ciclos se serializam: o segundo espera e, ao entrar, o UPDATE condicional já não acha linhas
 * (nenhum trabalho em dobro). Fase 35: os jobs NÃO enviam e-mail (catálogo vital de 4 tipos); mantêm lógica de negócio, auditoria e SSE.
 */
const LOCK_EXPIRAR = 'om:job:expirar_reservas';
const LOCK_AVISAR = 'om:job:avisar_reservas';
const LOCK_FALLBACK = 'om:job:verificar_fallback';
const OPCOES_TX = { timeout: 30_000, maxWait: 10_000 };

async function comLock<T>(chave: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))`;
    return fn(tx);
  }, OPCOES_TX);
}

/**
 * RN-22: OM urgente (CRITICA) ABERTA, sem responsável, cujo prazo venceu => liberada ao pull de qualquer técnico.
 * Aqui só ALERTA o gerente (SSE `om.liberada` + auditoria), uma única vez por OM: o "claim" é um UPDATE atômico
 * (seguro mesmo com mais de uma instância). A liberação em si é calculada na hora por regras.ts (prazo vencido).
 */
export async function verificarFallback(log: FastifyBaseLogger): Promise<number> {
  const { fallbackUrgenteMin } = await lerPoliticas();
  const liberadas = await comLock(LOCK_FALLBACK, async (tx) => {
    const rows = await tx.$queryRaw<{ id: bigint; numero: string }[]>`
      UPDATE ordens_manutencao
         SET fallback_alertado_em = now()
       WHERE status = 'ABERTA' AND prioridade = 'CRITICA' AND fallback_alertado_em IS NULL
         AND COALESCE(prazo_atendimento, data_abertura + make_interval(mins => ${fallbackUrgenteMin}::int)) <= now()
      RETURNING id, numero_formatado AS numero`;
    for (const o of rows) {
      await auditar(tx, { atorId: null, atorPerfil: 'SISTEMA', acao: 'OM_LIBERADA_FALLBACK', alvoTipo: 'OM', alvoId: o.id, detalhe: { minutos: fallbackUrgenteMin } });
    }
    return rows;
  });
  // Efeitos fora do banco (log/SSE) só depois do COMMIT.
  for (const o of liberadas) {
    log.warn({ evento: 'om_liberada_fallback', ordemId: o.id.toString() });
    publicar({ tipo: 'om.liberada', ordemId: o.id, numero: o.numero, statusKanban: 'ABERTO' });
  }
  return liberadas.length;
}

/**
 * US-12 §4: OM RESERVADA que não foi aceita em OM_RESERVA_ACEITE_MIN (15 min, contados da transição para RESERVADA)
 * tem a reserva DESFEITA: volta a ABERTA, sem responsável e SEM marca de recusa (não foi recusa: não fica "devolvida").
 * Urgente (CRITICA) recebe prazo = agora: já passou do fallback da RN-22, então fica LIBERADA ao pull de qualquer técnico
 * e o alerta do fallback dispara. Atômico (UPDATE ... FROM subconsulta FOR UPDATE): seguro com mais de uma instância.
 */
export async function expirarReservas(log: FastifyBaseLogger): Promise<number> {
  const { reservaAceiteMin } = await lerPoliticas();
  const expiradas = await comLock(LOCK_EXPIRAR, async (tx) => {
    const rows = await tx.$queryRaw<{ id: bigint; numero: string; tecnico_id: bigint | null }[]>`
      UPDATE ordens_manutencao o
         SET status = 'ABERTA', responsavel_id = NULL, delegado_por = NULL, delegado_em = NULL,
             motivo_recusa = NULL, fallback_alertado_em = NULL,
             prazo_atendimento = CASE WHEN o.prioridade = 'CRITICA' THEN now() END
        FROM (SELECT id, responsavel_id FROM ordens_manutencao
               WHERE status = 'RESERVADA' AND delegado_em <= now() - make_interval(mins => ${reservaAceiteMin}::int)
                 FOR UPDATE) x
       WHERE o.id = x.id
      RETURNING o.id, o.numero_formatado AS numero, x.responsavel_id AS tecnico_id`;
    for (const o of rows) {
      await auditar(tx, {
        atorId: null, atorPerfil: 'SISTEMA', acao: 'OM_RESERVA_EXPIRADA', alvoTipo: 'OM', alvoId: o.id,
        detalhe: { tecnicoId: o.tecnico_id, minutos: reservaAceiteMin },
      });
    }
    return rows;
  });
  for (const o of expiradas) {
    log.warn({ evento: 'om_reserva_expirada', ordemId: o.id.toString(), tecnicoId: o.tecnico_id?.toString(), minutos: reservaAceiteMin });
    publicar({ tipo: 'om.reserva_expirada', ordemId: o.id, numero: o.numero, statusKanban: 'ABERTO', ...(o.tecnico_id !== null && { tecnicoId: o.tecnico_id.toString() }) });
  }
  return expiradas.length;
}

/**
 * US-12 §4 (decisão do Analista): AVISO PRÉVIO aos OM_RESERVA_AVISO_MIN (10 min) de uma reserva ainda não aceita, faltando
 * (aceite − aviso) = 5 min para expirar. Um aviso por reserva: o "claim" atômico só vale se `reserva_aviso_em` for nulo ou
 * anterior à delegação atual (uma reatribuição abre nova reserva e novo aviso). Avisa técnico e gerentes por SSE (sem e-mail).
 */
export async function avisarReservas(log: FastifyBaseLogger): Promise<number> {
  const { reservaAvisoMin, reservaAceiteMin } = await lerPoliticas();
  const avisadas = await comLock(LOCK_AVISAR, async (tx) => {
    const rows = await tx.$queryRaw<{ id: bigint; numero: string; tecnico_id: bigint }[]>`
      UPDATE ordens_manutencao
         SET reserva_aviso_em = now()
       WHERE status = 'RESERVADA' AND responsavel_id IS NOT NULL
         AND delegado_em <= now() - make_interval(mins => ${reservaAvisoMin}::int)
         AND delegado_em >  now() - make_interval(mins => ${reservaAceiteMin}::int)
         AND (reserva_aviso_em IS NULL OR reserva_aviso_em < delegado_em)
      RETURNING id, numero_formatado AS numero, responsavel_id AS tecnico_id`;
    return rows;
  });
  for (const o of avisadas) {
    log.warn({ evento: 'om_reserva_aviso', ordemId: o.id.toString(), tecnicoId: o.tecnico_id.toString(), faltamMin: reservaAceiteMin - reservaAvisoMin });
    publicar({ tipo: 'om.reserva_aviso', ordemId: o.id, numero: o.numero, statusKanban: 'ABERTO', tecnicoId: o.tecnico_id.toString() });
  }
  return avisadas.length;
}

/** Verificação periódica (a cada 30 s): expira reservas, avisa as que estão perto de expirar e alerta o fallback (urgentes recém-liberadas entram no mesmo ciclo). */
export function iniciarFallback(log: FastifyBaseLogger): NodeJS.Timeout {
  const t = setInterval(() => {
    expirarReservas(log)
      .then(() => avisarReservas(log))
      .then(() => verificarFallback(log))
      .catch((err) => log.error({ evento: 'fallback_falhou', erro: err instanceof Error ? err.message.slice(0, 160) : 'erro' }));
  }, 30_000);
  t.unref();
  return t;
}
