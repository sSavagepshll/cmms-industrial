import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '../generated/prisma/client.js';
import { z } from 'zod';
import { comUsuario, prisma, STATUS_ATIVOS, type Tx } from '../db.js';
import { toJSON } from '../serialize.js';
import { painelManutencao, perfilAprovador, perfilConcluidor, soGerente, soTecnico } from '../plugins/rbac.js';
import { notificarAprovadaSolicitante, notificarConcluidaGestor, notificarFinalizadaTecnico } from '../mail/notificacoes.js';
import { setorExibicao } from '../setorExibicao.js';
import { confirmarPin } from '../auth/pin.js';
import { auditar } from '../auditoria.js';
import {
  lerPoliticas, perfilAtual, podeAprovar, podeAssumir, situacaoAtribuicao, type OmAtribuicao,
} from '../regras.js';
import { ordemSelect, toDto } from './ordens.js';
import { publicar } from '../events.js';

const id = z.string().regex(/^\d{1,18}$/, 'id inválido').transform((v) => BigInt(v));
const params = z.object({ id }).strict();

// RN-10: motivos pré-definidos (US-07 cenário 3). Sem coluna motivo_pausa na V003: o motivo é auditado
// em ordens_notas com o prefixo [PAUSA:CODIGO].
const MOTIVOS_PAUSA = ['AGUARDANDO_PECA', 'AGUARDANDO_PRODUCAO', 'REFEICAO', 'TROCA_TURNO', 'AGUARDANDO_SUPORTE', 'OUTRO'] as const;
const pauseBody = z
  .object({ motivo: z.enum(MOTIVOS_PAUSA), detalhe: z.string().trim().max(250).optional() }).strict()
  .refine((b) => b.motivo !== 'OUTRO' || !!b.detalhe, { path: ['detalhe'], message: 'Descreva o motivo' });

const concluirBody = z.object({
  causaRaiz: z.string().trim().min(1).max(100),
  acaoExecutada: z.string().trim().min(1).max(100),
  parecer: z.string().trim().max(1000).optional(),
}).strict();
const reprovarBody = z.object({ motivo: z.string().trim().min(1).max(500) }).strict();
const notaBody = z.object({ nota: z.string().trim().min(1).max(1000) }).strict();

const filaQuery = z.object({
  setor: z.string().trim().min(1).max(100).optional(),
  prioridade: z.enum(['BAIXA', 'MEDIA', 'ALTA', 'CRITICA']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Estado exibido no Kanban (V004 trouxe PAUSADA; AGUARDANDO_PECA é legado e conta como pausado). */
type StatusKanban = 'ABERTO' | 'EM_ATENDIMENTO' | 'PAUSADO' | 'AGUARDANDO_APROVACAO' | 'AGUARDANDO_BAIXA' | 'CONCLUIDO' | 'CANCELADO';
const KANBAN: Record<string, StatusKanban> = {
  ABERTA: 'ABERTO', RESERVADA: 'ABERTO', EM_ANDAMENTO: 'EM_ATENDIMENTO', PAUSADA: 'PAUSADO', AGUARDANDO_PECA: 'PAUSADO',
  AGUARDANDO_APROVACAO: 'AGUARDANDO_APROVACAO', AGUARDANDO_BAIXA: 'AGUARDANDO_BAIXA', CONCLUIDA: 'CONCLUIDO', CANCELADA: 'CANCELADO',
};
const statusKanban = (status: string): StatusKanban => KANBAN[status] ?? 'EM_ATENDIMENTO';

/** RN-08: tempo líquido calculado no servidor = soma dos intervalos (o aberto conta até agora). */
/** Dentro de transação, passe o `tx` para enxergar as alterações ainda não commitadas (e não ocupar outra conexão). */
async function tempoLiquidoSegundos(ordemId: bigint, db: Pick<Tx, '$queryRaw'> = prisma): Promise<number> {
  const r = await db.$queryRaw<{ s: number | null }[]>`
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(fim, now()) - inicio))), 0)::float8 AS s
      FROM om_apontamentos_tempo WHERE ordem_id = ${ordemId} AND deletado_em IS NULL`;
  return Math.floor(r[0]?.s ?? 0);
}

const erro = (error: string, message: string, extra: object = {}) => ({ error, message, ...extra });

/** Estado de atribuição de uma OM, lido com o relógio do banco (idade/prazos). */
async function infoAtribuicao(ordemId: bigint, minFallback: number) {
  const r = await prisma.$queryRaw<{
    status: string; prioridade: string; responsavel_id: bigint | null; responsavel_nome: string | null;
    motivo_recusa: string | null; ate_fallback: number;
  }[]>`
    SELECT o.status::text AS status, o.prioridade::text AS prioridade, o.responsavel_id, u.nome AS responsavel_nome,
           o.motivo_recusa,
           EXTRACT(EPOCH FROM (COALESCE(o.prazo_atendimento, o.data_abertura + make_interval(mins => ${minFallback}::int)) - now()))::float8 AS ate_fallback
      FROM ordens_manutencao o LEFT JOIN usuarios u ON u.id = o.responsavel_id
     WHERE o.id = ${ordemId}`;
  const x = r[0];
  if (!x) return null;
  const om: OmAtribuicao = {
    status: x.status, prioridade: x.prioridade, responsavelId: x.responsavel_id,
    devolvida: x.status === 'ABERTA' && x.motivo_recusa !== null, segundosAteFallback: x.ate_fallback,
  };
  return { ...x, om };
}

/** Contexto para decidir aprovação: relógio do banco, quem abriu, quem executou. */
async function contextoAprovacao(ordemId: bigint, userId: bigint, minLider: number) {
  const r = await prisma.$queryRaw<{
    status: string; responsavel_id: bigint | null; solicitante_id: bigint; solicitante_nome: string; executou: boolean; ate_lider: number;
  }[]>`
    SELECT o.status::text AS status, o.responsavel_id, o.solicitante_id, s.nome AS solicitante_nome,
           EXISTS (SELECT 1 FROM om_apontamentos_tempo a WHERE a.ordem_id = o.id AND a.tecnico_id = ${userId} AND a.deletado_em IS NULL) AS executou,
           EXTRACT(EPOCH FROM (COALESCE(o.prazo_aprovacao, o.data_conclusao + make_interval(mins => ${minLider}::int)) - now()))::float8 AS ate_lider
      FROM ordens_manutencao o JOIN usuarios s ON s.id = o.solicitante_id
     WHERE o.id = ${ordemId}`;
  return r[0] ?? null;
}

const pinSchema = z.string().regex(/^\d{4,6}$/, 'PIN deve ter 4 a 6 dígitos');

export const atendimentoRoutes: FastifyPluginAsync = async (app) => {
  // ---------- Kanban ----------
  app.get('/ordens/fila', { preHandler: painelManutencao }, async (req) => {
    const q = filaQuery.parse(req.query);
    const me = BigInt(req.user.sub);
    const meuPerfil = (await perfilAtual(me)) ?? req.user.perfil;
    const supervisor = meuPerfil === 'GERENTE' || meuPerfil === 'ADMIN';
    const pol = await lerPoliticas();
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const ordens = await prisma.ordem.findMany({
      where: {
        OR: [
          { status: { in: [...STATUS_ATIVOS, 'AGUARDANDO_BAIXA'] } }, // AGUARDANDO_BAIXA: coluna própria (só leitura para o técnico)
          { status: 'CONCLUIDA', dataConclusao: { gte: hoje } }, // "Concluídas hoje"
        ],
        ...(q.prioridade && { prioridade: q.prioridade }),
        ...(q.setor && { equipamento: { setor: q.setor } }),
      },
      select: {
        ...ordemSelect,
        responsavel: { select: { id: true, nome: true } },
        delegador: { select: { id: true, nome: true } },
        delegadoEm: true,
        motivoRecusa: true,
        prazoAtendimento: true,
        apontamentos: { where: { deletadoEm: null }, select: { inicio: true, fim: true, tecnicoId: true } },
      },
      // Fase 35 (RN-74): mais recentes primeiro em todas as colunas. A urgência segue visível pelo selo (CRITICA); o id desempata.
      orderBy: [{ dataAbertura: 'desc' }, { id: 'desc' }],
      take: q.limit,
    });

    // "agora" do banco: mesma referência de relógio usada pelos apontamentos (inicio DEFAULT now()).
    const agora = (await prisma.$queryRaw<{ agora: Date }[]>`SELECT now() AS agora`)[0]!.agora;

    // Quem recusou e quando (só GERENTE/ADMIN veem): última transição RESERVADA -> ABERTA no histórico.
    const devolvidas = ordens.filter((o) => o.status === 'ABERTA' && o.motivoRecusa !== null).map((o) => o.id);
    const recusas = new Map<string, { por: { id: bigint; nome: string } | null; em: Date }>();
    if (supervisor && devolvidas.length > 0) {
      const hist = await prisma.historicoStatusOrdem.findMany({
        where: { ordemId: { in: devolvidas }, statusAnterior: 'RESERVADA', statusNovo: 'ABERTA' },
        orderBy: { criadoEm: 'desc' },
        select: { ordemId: true, criadoEm: true, usuario: { select: { id: true, nome: true } } },
      });
      for (const h of hist) if (!recusas.has(h.ordemId.toString())) recusas.set(h.ordemId.toString(), { por: h.usuario, em: h.criadoEm });
    }

    const colunas: Record<'ABERTO' | 'EM_ATENDIMENTO' | 'PAUSADO' | 'AGUARDANDO_APROVACAO' | 'AGUARDANDO_BAIXA' | 'CONCLUIDO', unknown[]> = {
      ABERTO: [], EM_ATENDIMENTO: [], PAUSADO: [], AGUARDANDO_APROVACAO: [], AGUARDANDO_BAIXA: [], CONCLUIDO: [],
    };
    for (const { apontamentos, delegador, delegadoEm, motivoRecusa, prazoAtendimento, ...o } of ordens) {
      const k = statusKanban(o.status);
      const aberto = apontamentos.find((a) => a.fim === null);
      const tempoLiquidoSegundos = Math.floor(
        apontamentos.reduce((t, a) => t + ((a.fim ?? agora).getTime() - a.inicio.getTime()), 0) / 1000,
      );
      // Atribuição (OMs ABERTA/RESERVADA): o que o usuário logado pode fazer com a OM (regras em regras.ts).
      let atrib: object = {};
      if (k === 'ABERTO') {
        const prazo = prazoAtendimento ?? new Date(o.dataAbertura.getTime() + pol.fallbackUrgenteMin * 60_000);
        const om: OmAtribuicao = {
          status: o.status, prioridade: o.prioridade, responsavelId: o.responsavel?.id ?? null,
          devolvida: o.status === 'ABERTA' && motivoRecusa !== null, segundosAteFallback: (prazo.getTime() - agora.getTime()) / 1000,
        };
        const sit = situacaoAtribuicao(om);
        const rec = recusas.get(o.id.toString());
        atrib = {
          urgente: o.prioridade === 'CRITICA',
          situacaoAtribuicao: sit,
          // US-12 §4: reserva expira em OM_RESERVA_ACEITE_MIN; aviso aos OM_RESERVA_AVISO_MIN (`reservaAvisando`)
          reservaExpiraEmSegundos: o.status === 'RESERVADA' && delegadoEm
            ? Math.max(0, Math.ceil((delegadoEm.getTime() + pol.reservaAceiteMin * 60_000 - agora.getTime()) / 1000)) : null,
          reservaAvisando: o.status === 'RESERVADA' && !!delegadoEm && agora.getTime() >= delegadoEm.getTime() + pol.reservaAvisoMin * 60_000,
          reservadaPara: o.status === 'RESERVADA' ? o.responsavel : null,
          delegadoPor: o.status === 'RESERVADA' ? delegador : null,
          delegadoEm: o.status === 'RESERVADA' ? delegadoEm : null,
          liberaEmSegundos: sit === 'URGENTE_AGUARDA_GERENTE' ? Math.max(0, Math.ceil(om.segundosAteFallback)) : 0,
          podeAssumir: podeAssumir(om, me, meuPerfil).permitido,
          podeRecusar: o.status === 'RESERVADA' && o.responsavel?.id === me,
          // motivo da recusa e quem recusou: só para quem redelega
          ...(supervisor && sit === 'DEVOLVIDA' && { recusadoPor: rec?.por ?? null, recusadoEm: rec?.em ?? null, motivoRecusa }),
        };
      }
      if (k in colunas) {
        colunas[k as keyof typeof colunas].push({
          ...toDto(o),
          ...atrib,
          statusKanban: k,
          cronometroAtivo: !!aberto,
          cronometroInicio: aberto?.inicio ?? null, // permite ao cliente "rodar" o relógio localmente
          tempoLiquidoSegundos, // inclui o intervalo aberto até `agora`
        });
      }
    }
    return toJSON({ agora, colunas, total: ordens.length });
  });

  const motivoSchema = (min: number) => z.string().trim().min(min, `Informe o motivo (mínimo ${min} caracteres)`).max(500);
  const falhaPin = (reply: import('fastify').FastifyReply, f: NonNullable<Awaited<ReturnType<typeof confirmarPin>>>) =>
    (f.retryAfter ? reply.header('Retry-After', f.retryAfter) : reply).code(f.status).send(f.body);

  // ---------- US-06 / US-11: assumir (puxar ou aceitar a reserva), SEMPRE com PIN ----------
  //  RESERVADA: só o técnico reservado (RN-23). ABERTA: TECNICO só não urgentes (urgente só após o fallback, RN-22);
  //  OM devolvida pela recusa fica com o gerente. GERENTE/ADMIN assumem qualquer ABERTA (o gerente também atende OM).
  app.post('/ordens/:id/assumir', { preHandler: soTecnico, config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id: ordemId } = params.parse(req.params);
    const { pin } = z.object({ pin: pinSchema }).strict().parse(req.body);
    const userId = BigInt(req.user.sub);

    const perfil = await perfilAtual(userId);
    if (!perfil) return reply.code(403).send(erro('ACESSO_NEGADO', 'Usuário inativo.'));
    const pol = await lerPoliticas();
    const info = await infoAtribuicao(ordemId, pol.fallbackUrgenteMin);
    if (!info) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    if (info.status !== 'ABERTA' && info.status !== 'RESERVADA') {
      return reply.code(409).send(erro('OM_NAO_DISPONIVEL', info.responsavel_nome
        ? `Esta OM já foi assumida pelo técnico ${info.responsavel_nome}.`
        : `OM no status ${info.status} não pode ser assumida.`, { status: info.status }));
    }
    const dec = podeAssumir(info.om, userId, perfil);
    if (!dec.permitido) {
      return reply.code(dec.status!).send(erro(dec.codigo!, dec.motivo!, dec.liberaEmSegundos !== undefined ? { liberaEmSegundos: dec.liberaEmSegundos } : {}));
    }
    // PIN só depois da autorização: quem não pode assumir não consome tentativas de PIN.
    const pinFalhou = await confirmarPin(userId, pin, req.log);
    if (pinFalhou) return falhaPin(reply, pinFalhou);

    const reservada = info.status === 'RESERVADA';
    const ok = await comUsuario(userId, async (tx) => {
      // Atômico: o filtro do UPDATE repete a regra, então só um vence a corrida.
      const n = reservada
        ? await tx.$executeRaw`
            UPDATE ordens_manutencao
               SET status = 'EM_ANDAMENTO', motivo_recusa = NULL, prazo_atendimento = NULL, fallback_alertado_em = NULL
             WHERE id = ${ordemId} AND status = 'RESERVADA' AND responsavel_id = ${userId}`
        : await tx.$executeRaw`
            UPDATE ordens_manutencao
               SET status = 'EM_ANDAMENTO', responsavel_id = ${userId}, motivo_recusa = NULL, prazo_atendimento = NULL, fallback_alertado_em = NULL
             WHERE id = ${ordemId} AND status = 'ABERTA' AND responsavel_id IS NULL`;
      if (n === 0) return false;
      await auditar(tx, {
        atorId: userId, atorPerfil: perfil, acao: reservada ? 'OM_ACEITA' : 'OM_ASSUMIDA', alvoTipo: 'OM', alvoId: ordemId,
        detalhe: { situacao: situacaoAtribuicao(info.om) },
      });
      return true;
    });
    if (!ok) {
      const o = await infoAtribuicao(ordemId, pol.fallbackUrgenteMin);
      return reply.code(409).send(erro('OM_NAO_DISPONIVEL', o?.responsavel_nome
        ? `Esta OM acabou de ser assumida pelo técnico ${o.responsavel_nome}.`
        : 'A OM mudou de situação. Recarregue.', { status: o?.status }));
    }
    req.log.info({ evento: reservada ? 'om_aceita' : 'om_assumida', ordemId: ordemId.toString(), usuarioId: userId.toString(), perfil });
    publicar({ tipo: 'om.assumida', ordemId, statusKanban: 'EM_ATENDIMENTO', tecnicoId: userId.toString() });
    return toJSON({ id: ordemId, status: 'EM_ANDAMENTO', statusKanban: 'EM_ATENDIMENTO', responsavelId: userId });
  });

  // ---------- US-11.4: GERENTE delega (empurra) => OM RESERVADA, aguardando o aceite do técnico ----------
  const atribuirBody = z.object({
    tecnicoId: z.string().regex(/^\d{1,18}$/, 'id inválido').transform((v) => BigInt(v)),
    motivo: motivoSchema(5).optional(),
  }).strict();
  app.post('/ordens/:id/atribuir', { preHandler: soGerente }, async (req, reply) => {
    const { id: ordemId } = params.parse(req.params);
    const b = atribuirBody.parse(req.body);
    const gestorId = BigInt(req.user.sub);
    const perfilGestor = (await perfilAtual(gestorId)) ?? req.user.perfil;

    if (b.tecnicoId === gestorId) {
      return reply.code(422).send(erro('USE_ASSUMIR', 'Para atender a OM você mesmo, use "assumir" (com PIN).'));
    }
    const alvo = await prisma.usuario.findUnique({ where: { id: b.tecnicoId }, select: { ativo: true, perfil: true, nome: true } });
    if (!alvo?.ativo || !['TECNICO', 'GERENTE', 'ADMIN'].includes(alvo.perfil)) {
      return reply.code(422).send(erro('TECNICO_INVALIDO', 'O responsável deve ser um técnico ativo.'));
    }
    const pol = await lerPoliticas();
    const info = await infoAtribuicao(ordemId, pol.fallbackUrgenteMin);
    if (!info) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    if (info.status !== 'ABERTA' && info.status !== 'RESERVADA') {
      return reply.code(409).send(erro('OM_NAO_DISPONIVEL', `OM no status ${info.status} não pode ser atribuída (reatribuição de OM em atendimento ainda não é suportada).`, { status: info.status }));
    }
    const reatribuicao = info.status === 'RESERVADA';
    if (reatribuicao && !b.motivo) {
      return reply.code(400).send(erro('MOTIVO_OBRIGATORIO', 'Informe o motivo da reatribuição (mínimo 5 caracteres).'));
    }

    const ok = await comUsuario(gestorId, async (tx) => {
      const n = reatribuicao
        ? await tx.$executeRaw`
            UPDATE ordens_manutencao
               SET responsavel_id = ${b.tecnicoId}, delegado_por = ${gestorId}, delegado_em = now(),
                   motivo_recusa = NULL, prazo_atendimento = NULL, fallback_alertado_em = NULL
             WHERE id = ${ordemId} AND status = 'RESERVADA' AND responsavel_id = ${info.responsavel_id}::bigint`
        : await tx.$executeRaw`
            UPDATE ordens_manutencao
               SET status = 'RESERVADA', responsavel_id = ${b.tecnicoId}, delegado_por = ${gestorId}, delegado_em = now(),
                   motivo_recusa = NULL, prazo_atendimento = NULL, fallback_alertado_em = NULL
             WHERE id = ${ordemId} AND status = 'ABERTA' AND responsavel_id IS NULL`;
      if (n === 0) return false;
      await tx.ordemNota.create({
        data: {
          ordemId, autorId: gestorId,
          nota: `OM reservada para ${alvo.nome}${reatribuicao ? ` (antes: ${info.responsavel_nome}). Motivo: ${b.motivo}` : ''}; aguardando aceite com PIN.`,
        },
      });
      await auditar(tx, {
        atorId: gestorId, atorPerfil: perfilGestor, acao: reatribuicao ? 'OM_REATRIBUIDA' : 'OM_DELEGADA', alvoTipo: 'OM', alvoId: ordemId,
        detalhe: { tecnicoId: b.tecnicoId, de: info.responsavel_id, motivo: b.motivo },
      });
      return true;
    });
    if (!ok) return reply.code(409).send(erro('OM_NAO_DISPONIVEL', 'A OM mudou de situação. Recarregue.'));
    req.log.info({ evento: reatribuicao ? 'om_reatribuida' : 'om_delegada', ordemId: ordemId.toString(), tecnicoId: b.tecnicoId.toString(), por: gestorId.toString() });
    publicar({ tipo: 'om.delegada', ordemId, statusKanban: 'ABERTO', tecnicoId: b.tecnicoId.toString() });
    return toJSON({ id: ordemId, status: 'RESERVADA', statusKanban: 'ABERTO', responsavelId: b.tecnicoId, reservada: true });
  });

  // ---------- US-11.4 cen. 3 / RN-26: técnico recusa a reserva (motivo obrigatório) ----------
  // A OM volta para ABERTA sem responsável, marcada como devolvida (motivo_recusa): fica com o gerente e NÃO vai ao pull.
  app.post('/ordens/:id/recusar', { preHandler: soTecnico }, async (req, reply) => {
    const { id: ordemId } = params.parse(req.params);
    const { motivo } = z.object({ motivo: motivoSchema(10) }).strict().parse(req.body);
    const userId = BigInt(req.user.sub);
    const perfil = (await perfilAtual(userId)) ?? req.user.perfil;
    const pol = await lerPoliticas();

    const ok = await comUsuario(userId, async (tx) => {
      // Reinicia a contagem do fallback (RN-22) a partir da recusa quando a OM é urgente.
      const n = await tx.$executeRaw`
        UPDATE ordens_manutencao
           SET status = 'ABERTA', responsavel_id = NULL, delegado_por = NULL, delegado_em = NULL,
               motivo_recusa = ${motivo}, fallback_alertado_em = NULL,
               prazo_atendimento = CASE WHEN prioridade = 'CRITICA' THEN now() + make_interval(mins => ${pol.fallbackUrgenteMin}::int) END
         WHERE id = ${ordemId} AND status = 'RESERVADA' AND responsavel_id = ${userId}`;
      if (n === 0) return false;
      await auditar(tx, { atorId: userId, atorPerfil: perfil, acao: 'OM_RECUSADA', alvoTipo: 'OM', alvoId: ordemId, detalhe: { motivo } });
      return true;
    });
    if (!ok) return reply.code(409).send(erro('SEM_RESERVA', 'Esta OM não está reservada para você (ou já foi aceita/alterada).'));
    req.log.info({ evento: 'om_recusada', ordemId: ordemId.toString(), usuarioId: userId.toString() });
    publicar({ tipo: 'om.recusada', ordemId, statusKanban: 'ABERTO', tecnicoId: userId.toString() });
    return toJSON({ id: ordemId, status: 'ABERTA', statusKanban: 'ABERTO', devolvida: true });
  });

  // ---------- "Desfazer" do gerente: cancela a reserva enquanto o técnico não aceitou ----------
  app.post('/ordens/:id/cancelar-delegacao', { preHandler: soGerente }, async (req, reply) => {
    const { id: ordemId } = params.parse(req.params);
    const { motivo } = z.object({ motivo: motivoSchema(3).optional() }).strict().parse(req.body ?? {});
    const gestorId = BigInt(req.user.sub);
    const perfil = (await perfilAtual(gestorId)) ?? req.user.perfil;
    const pol = await lerPoliticas();
    const info = await infoAtribuicao(ordemId, pol.fallbackUrgenteMin);
    if (!info) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));

    const ok = await comUsuario(gestorId, async (tx) => {
      const n = await tx.$executeRaw`
        UPDATE ordens_manutencao
           SET status = 'ABERTA', responsavel_id = NULL, delegado_por = NULL, delegado_em = NULL, motivo_recusa = NULL,
               fallback_alertado_em = NULL,
               prazo_atendimento = CASE WHEN prioridade = 'CRITICA' THEN now() + make_interval(mins => ${pol.fallbackUrgenteMin}::int) END
         WHERE id = ${ordemId} AND status = 'RESERVADA'`;
      if (n === 0) return false;
      await auditar(tx, { atorId: gestorId, atorPerfil: perfil, acao: 'OM_DELEGACAO_CANCELADA', alvoTipo: 'OM', alvoId: ordemId, detalhe: { tecnicoId: info.responsavel_id, motivo } });
      return true;
    });
    if (!ok) return reply.code(409).send(erro('OM_NAO_DISPONIVEL', 'A OM não está mais reservada (o técnico já aceitou ou ela mudou).', { status: info.status }));
    publicar({ tipo: 'om.delegacao_cancelada', ordemId, statusKanban: 'ABERTO', tecnicoId: info.responsavel_id?.toString() });
    return toJSON({ id: ordemId, status: 'ABERTA', statusKanban: 'ABERTO' });
  });

  // ---------- US-07: play (inicia/retoma) ----------
  app.post('/ordens/:id/play', { preHandler: soTecnico }, async (req, reply) => {
    const { id: ordemId } = params.parse(req.params);
    const tecnicoId = BigInt(req.user.sub);

    const ordem = await prisma.ordem.findUnique({
      where: { id: ordemId },
      select: { status: true, responsavelId: true, dataInicio: true },
    });
    if (!ordem) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    if (ordem.responsavelId !== tecnicoId) {
      return reply.code(403).send(erro('NAO_E_RESPONSAVEL', 'Apenas o técnico responsável pode iniciar o cronômetro. Assuma a OM primeiro.'));
    }
    if (ordem.status === 'RESERVADA') {
      return reply.code(409).send(erro('ACEITE_PENDENTE', 'Aceite a OM reservada com seu PIN antes de iniciar o cronômetro.'));
    }
    if (!['EM_ANDAMENTO', 'PAUSADA', 'AGUARDANDO_PECA'].includes(ordem.status)) {
      return reply.code(409).send(erro('STATUS_INVALIDO', `Não é possível dar play em OM com status ${ordem.status}.`));
    }

    try {
      const apontamento = await comUsuario(tecnicoId, async (tx) => {
        const a = await tx.omApontamentoTempo.create({
          data: { ordemId, tecnicoId },
          select: { id: true, inicio: true },
        });
        await tx.ordem.update({
          where: { id: ordemId },
          data: { status: 'EM_ANDAMENTO', motivoPausa: null },
        });
        // data_inicio = primeiro play (DB now() para respeitar ck_ordens_datas sem depender do relógio da API)
        await tx.$executeRaw`UPDATE ordens_manutencao SET data_inicio = now() WHERE id = ${ordemId} AND data_inicio IS NULL`;
        return a;
      });
      req.log.info({ evento: 'om_play', ordemId: ordemId.toString(), tecnicoId: tecnicoId.toString() });
      publicar({ tipo: 'om.play', ordemId, statusKanban: 'EM_ATENDIMENTO' });
      return reply.code(201).send(toJSON({
        apontamentoId: apontamento.id,
        inicio: apontamento.inicio,
        statusKanban: 'EM_ATENDIMENTO',
        tempoLiquidoSegundos: await tempoLiquidoSegundos(ordemId),
      }));
    } catch (e) {
      // RN-09: índice único parcial ux_apontamentos_aberto_tecnico (inclui play duplo/corrida).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const aberto = await prisma.omApontamentoTempo.findFirst({
          where: { tecnicoId, fim: null },
          select: { ordemId: true, ordem: { select: { numeroFormatado: true } } },
        });
        return reply.code(409).send(erro('CRONOMETRO_JA_ATIVO',
          `Você já possui o chamado ${aberto?.ordem.numeroFormatado ?? ''} em andamento. Pause-o antes de iniciar este.`,
          { ordemAtivaId: aberto?.ordemId.toString(), mesmaOrdem: aberto?.ordemId === ordemId }));
      }
      throw e;
    }
  });

  // ---------- US-07: pause justificado ----------
  app.post('/ordens/:id/pause', { preHandler: soTecnico }, async (req, reply) => {
    const { id: ordemId } = params.parse(req.params);
    const { motivo, detalhe } = pauseBody.parse(req.body);
    const tecnicoId = BigInt(req.user.sub);

    const motivoPausa = detalhe ? `${motivo}: ${detalhe}` : motivo; // ranking agrupa pelo código antes do ':'
    const resultado = await comUsuario(tecnicoId, async (tx) => {
      // fim = now() do banco (ck_apontamentos_periodo: fim >= inicio) e atômico contra pause duplo.
      // V007: ck_apontamento_duracao limita cada apontamento a 24 h. Cronômetro esquecido aberto por mais que isso
      // é fechado em inicio + 24 h (em vez de a pausa falhar com erro 500).
      const fechados = await tx.$executeRaw`
        UPDATE om_apontamentos_tempo SET fim = LEAST(now(), inicio + interval '24 hours')
         WHERE ordem_id = ${ordemId} AND tecnico_id = ${tecnicoId} AND fim IS NULL AND deletado_em IS NULL`;
      if (fechados === 0) return false;
      // V004: ck_ordens_motivo_pausa exige motivo_pausa quando status = PAUSADA; o trigger grava o histórico.
      await tx.ordem.update({ where: { id: ordemId }, data: { status: 'PAUSADA', motivoPausa } });
      return true;
    });
    if (!resultado) {
      return reply.code(409).send(erro('SEM_CRONOMETRO_ATIVO', 'Você não tem cronômetro em andamento nesta OM.'));
    }
    req.log.info({ evento: 'om_pause', ordemId: ordemId.toString(), tecnicoId: tecnicoId.toString(), motivo });
    publicar({ tipo: 'om.pause', ordemId, statusKanban: 'PAUSADO' });
    return { statusKanban: 'PAUSADO', motivo, tempoLiquidoSegundos: await tempoLiquidoSegundos(ordemId) };
  });

  // ---------- US-09: concluir ----------
  // Finalização técnica (EM_ANDAMENTO/PAUSADA -> AGUARDANDO_APROVACAO). A conclusão do gestor é POST /ordens/:id/encerrar.
  app.post('/ordens/:id/concluir', { preHandler: soTecnico }, async (req, reply) => {
    const { id: ordemId } = params.parse(req.params);
    const b = concluirBody.parse(req.body);
    const tecnicoId = BigInt(req.user.sub);

    const ordem = await prisma.ordem.findUnique({ where: { id: ordemId }, select: { status: true, responsavelId: true } });
    if (!ordem) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    if (ordem.responsavelId !== tecnicoId && req.user.perfil !== 'ADMIN') {
      return reply.code(403).send(erro('NAO_E_RESPONSAVEL', 'Apenas o técnico responsável pode concluir a OM.'));
    }
    if (!['EM_ANDAMENTO', 'PAUSADA', 'AGUARDANDO_PECA'].includes(ordem.status)) {
      return reply.code(409).send(erro('STATUS_INVALIDO', `Não é possível concluir OM com status ${ordem.status}.`));
    }

    const solucao = [`Causa raiz: ${b.causaRaiz}`, `Ação executada: ${b.acaoExecutada}`, b.parecer ? `Parecer: ${b.parecer}` : null]
      .filter(Boolean).join('\n');

    const polConcluir = await lerPoliticas();
    const tempo = await comUsuario(tecnicoId, async (tx) => {
      // mesmo teto de 24 h por apontamento (V007) para cronômetro esquecido aberto
      await tx.$executeRaw`UPDATE om_apontamentos_tempo SET fim = LEAST(now(), inicio + interval '24 hours') WHERE ordem_id = ${ordemId} AND fim IS NULL AND deletado_em IS NULL`;
      const r = await tx.$queryRaw<{ data_conclusao: Date }[]>`
        UPDATE ordens_manutencao
           SET status = 'AGUARDANDO_APROVACAO', solucao = ${solucao}, data_conclusao = now(),
               prazo_aprovacao = now() + make_interval(mins => ${polConcluir.liderAprovaAposMin}::int),
               data_inicio = COALESCE(data_inicio, data_abertura),
               motivo_reprovacao = NULL
         WHERE id = ${ordemId} AND status IN ('EM_ANDAMENTO', 'PAUSADA', 'AGUARDANDO_PECA')
        RETURNING data_conclusao`;
      if (r.length === 0) return null; // mudou de estado entre a leitura e o update
      // E2 (Fase 35): finalização técnica -> solicitante e manutenção, sem PDF; o discriminador é a data do RETURNING.
      await notificarFinalizadaTecnico(tx, ordemId, r[0]!.data_conclusao, req.log);
      return tempoLiquidoSegundos(ordemId, tx);
    });
    if (tempo === null) return reply.code(409).send(erro('STATUS_INVALIDO', 'A OM mudou de status. Recarregue.'));
    req.log.info({ evento: 'om_aguardando_aprovacao', ordemId: ordemId.toString(), tecnicoId: tecnicoId.toString() });
    publicar({ tipo: 'om.concluida', ordemId, statusKanban: 'AGUARDANDO_APROVACAO' });
    return { statusKanban: 'AGUARDANDO_APROVACAO', tempoLiquidoSegundos: tempo };
  });

  // ---------- Fase 21: conclusão final pelo gestor (GERENTE/ADMIN + PIN) ----------
  app.post('/ordens/:id/encerrar', { preHandler: perfilConcluidor, config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id: ordemId } = params.parse(req.params);
    // Fase 31 (RN-52): o custo é definido AQUI. Validado antes do PIN (400 não consome tentativa). centroCusto vazio = não informado.
    const { pin, custoTipo, centroCusto } = z.object({
      pin: pinSchema,
      custoTipo: z.enum(['INTERNO', 'CLIENTE']),
      centroCusto: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().min(1).max(50).refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'caracteres de controle não são permitidos').optional()),
    }).strict().parse(req.body);
    const userId = BigInt(req.user.sub);
    const perfil = await perfilAtual(userId); // revalida perfil/ativo no banco
    if (!perfil || (perfil !== 'GERENTE' && perfil !== 'ADMIN')) {
      return reply.code(403).send(erro('ACESSO_NEGADO', 'Seu perfil não conclui OMs.'));
    }
    const ordem = await prisma.ordem.findUnique({ where: { id: ordemId }, select: { status: true, responsavelId: true, aprovadoPor: true } });
    if (!ordem) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    if (ordem.status !== 'AGUARDANDO_BAIXA') {
      return reply.code(409).send(erro('STATUS_INVALIDO', `OM no status ${ordem.status} não está aguardando conclusão.`));
    }
    const executores = await prisma.omApontamentoTempo.findMany({
      where: { ordemId, deletadoEm: null }, select: { tecnicoId: true }, distinct: ['tecnicoId'],
    });
    // RN-24 estendida: quem executou (apontamento válido ou responsável) não conclui, nem o ADMIN.
    if (ordem.responsavelId === userId || executores.some((x) => x.tecnicoId === userId)) {
      return reply.code(403).send(erro('AUTOCONCLUSAO_PROIBIDA', 'Você executou esta OM e não pode concluí-la.'));
    }
    const pinFalhou = await confirmarPin(userId, pin, req.log); // PIN do PRÓPRIO usuário
    if (pinFalhou) return falhaPin(reply, pinFalhou);

    const ids = [...new Set([...(ordem.responsavelId ? [ordem.responsavelId] : []), ...executores.map((x) => x.tecnicoId)])];
    const em = await comUsuario(userId, async (tx) => {
      const r = await tx.$queryRaw<{ concluido_em: Date; centro_custo: string | null }[]>`
        UPDATE ordens_manutencao
           SET status = 'CONCLUIDA', concluido_por = ${userId}, concluido_em = now(),
               tipo_custo = ${custoTipo}::tipo_custo, centro_custo = COALESCE(${centroCusto ?? null}, centro_custo)
         WHERE id = ${ordemId} AND status = 'AGUARDANDO_BAIXA'
        RETURNING concluido_em, centro_custo`;
      if (r.length === 0) return null;
      await auditar(tx, {
        atorId: userId, atorPerfil: perfil, acao: 'OM_CONCLUIDA', alvoTipo: 'OM', alvoId: ordemId,
        detalhe: { aprovadoPor: ordem.aprovadoPor?.toString() ?? null, executores: ids.map((x) => x.toString()), custoTipo, centroCusto: r[0]!.centro_custo },
      });
      // E4 (Fase 35): conclusão pelo gerente -> solicitante e manutenção, COM a ficha final em PDF (snapshot após o UPDATE).
      await notificarConcluidaGestor(tx, ordemId, r[0]!.concluido_em, req.log);
      return r[0]!;
    });
    if (!em) return reply.code(409).send(erro('STATUS_INVALIDO', 'A OM mudou de status. Recarregue.'));
    req.log.info({ evento: 'om_concluida', ordemId: ordemId.toString(), usuarioId: userId.toString() });
    publicar({ tipo: 'om.encerrada', ordemId, statusKanban: 'CONCLUIDO' }); // não reutiliza om.concluida (finalização técnica)
    return toJSON({ status: 'CONCLUIDA', statusKanban: 'CONCLUIDO', concluidoPor: userId, concluidoEm: em.concluido_em, custoTipo, centroCusto: em.centro_custo });
  });

  // GERENTE/ADMIN: OMs aprovadas pela produção, aguardando a conclusão final. Fase 35 (RN-75): mais recentes (aprovação) primeiro.
  app.get('/ordens/conclusoes-pendentes', { preHandler: perfilConcluidor }, async (req, reply) => {
    const me = BigInt(req.user.sub);
    const ordens = await prisma.ordem.findMany({
      where: { status: 'AGUARDANDO_BAIXA' },
      select: {
        ...ordemSelect,
        solucao: true,
        dataConclusao: true,
        responsavel: { select: { id: true, nome: true } },
        aprovador: { select: { id: true, nome: true, perfil: true } },
        aprovadoEmNomeDeUsuario: { select: { id: true, nome: true } },
      },
      orderBy: [{ dataAprovacao: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: 200,
    });
    const tempos = ordens.length === 0 ? [] : await prisma.$queryRaw<{ ordem_id: bigint; tecnico_id: bigint; nome: string; s: number }[]>`
      SELECT a.ordem_id, a.tecnico_id, u.nome,
             COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(a.fim, now()) - a.inicio))), 0)::float8 AS s
        FROM om_apontamentos_tempo a JOIN usuarios u ON u.id = a.tecnico_id
       WHERE a.ordem_id IN (${Prisma.join(ordens.map((o) => o.id))}) AND a.deletado_em IS NULL
       GROUP BY a.ordem_id, a.tecnico_id, u.nome`;
    const porOrdem = new Map<string, { id: bigint; nome: string; tempoSegundos: number; responsavel: boolean }[]>();
    for (const t of tempos) {
      const k = t.ordem_id.toString();
      porOrdem.set(k, [...(porOrdem.get(k) ?? []), { id: t.tecnico_id, nome: t.nome, tempoSegundos: Math.floor(t.s), responsavel: false }]);
    }
    reply.header('X-Total-Count', ordens.length);
    return toJSON(ordens.map(({ solucao, dataConclusao, responsavel, aprovadoEmNomeDeUsuario, ...o }) => {
      const lista = porOrdem.get(o.id.toString()) ?? [];
      for (const e of lista) e.responsavel = e.id === responsavel?.id;
      if (responsavel && !lista.some((e) => e.id === responsavel.id)) lista.push({ id: responsavel.id, nome: responsavel.nome, tempoSegundos: 0, responsavel: true });
      lista.sort((a, b) => Number(b.responsavel) - Number(a.responsavel) || b.tempoSegundos - a.tempoSegundos);
      const executou = lista.some((e) => e.id === me);
      return {
        ...toDto(o), solucao, dataConclusao,
        executores: lista,
        aprovadoEmNomeDe: aprovadoEmNomeDeUsuario,
        podeConcluir: !executou,
        motivoBloqueio: executou ? 'AUTOCONCLUSAO_PROIBIDA' : null,
      };
    }));
  });

  // ---------- Aprovação (V006 + US-11.1/11.2 + RN-21/RN-24) ----------
  // OPERADOR vê só as OMs que abriu; LIDER_PRODUCAO e ADMIN veem TODAS as pendentes (D4: escopo global). GERENTE não aprova (Fase 21).
  app.get('/ordens/aprovacoes', { preHandler: perfilAprovador }, async (req) => {
    const me = BigInt(req.user.sub);
    const meuPerfil = (await perfilAtual(me)) ?? req.user.perfil;
    const pol = await lerPoliticas();
    const ordens = await prisma.ordem.findMany({
      where: { status: 'AGUARDANDO_APROVACAO', ...(meuPerfil === 'OPERADOR' && { solicitanteId: me }) },
      select: {
        ...ordemSelect,
        solucao: true,
        dataConclusao: true,
        prazoAprovacao: true,
        responsavel: { select: { id: true, nome: true } },
      },
      orderBy: { dataConclusao: 'asc' }, // mais antigas primeiro
      take: 200,
    });
    const agora = (await prisma.$queryRaw<{ agora: Date }[]>`SELECT now() AS agora`)[0]!.agora;
    const executadas = new Set(
      ordens.length === 0 ? [] : (await prisma.omApontamentoTempo.findMany({
        where: { ordemId: { in: ordens.map((o) => o.id) }, tecnicoId: me, deletadoEm: null },
        select: { ordemId: true }, distinct: ['ordemId'],
      })).map((x) => x.ordemId.toString()),
    );
    return toJSON(ordens.map(({ prazoAprovacao, ...o }) => {
      const prazo = prazoAprovacao ?? new Date((o.dataConclusao ?? agora).getTime() + pol.liderAprovaAposMin * 60_000);
      const r = podeAprovar({
        solicitanteId: o.solicitante.id, responsavelId: o.responsavel?.id ?? null,
        executouPeloUsuario: executadas.has(o.id.toString()), segundosAteLider: (prazo.getTime() - agora.getTime()) / 1000,
      }, me, meuPerfil);
      // Quando o LIDER_PRODUCAO passa a poder decidir uma OM de outro operador (RN-21b; escopo GLOBAL, sem equipe).
      const liberaEm = meuPerfil === 'LIDER_PRODUCAO' && o.solicitante.id !== me ? prazo.toISOString() : null;
      return {
        ...toDto(o),
        liberaEm,
        podeAprovar: r.permitido,
        aprovaEmSegundos: r.codigo === 'AGUARDE_OPERADOR' ? r.liberaEmSegundos ?? 0 : 0,
        decideEmNomeDe: r.permitido && r.emNomeDe ? o.solicitante.nome : null, // líder/gerente decidindo pelo operador
        motivoBloqueio: r.permitido ? null : r.codigo,
      };
    }));
  });

  /** Autorização + PIN comuns a aprovar e reprovar. Retorna o que a decisão precisa gravar, ou a resposta de erro. */
  async function prepararDecisao(req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, ordemId: bigint, pin: string) {
    const userId = BigInt(req.user.sub);
    const perfil = await perfilAtual(userId);
    if (!perfil) { reply.code(403).send(erro('ACESSO_NEGADO', 'Usuário inativo.')); return null; }
    const pol = await lerPoliticas();
    const c = await contextoAprovacao(ordemId, userId, pol.liderAprovaAposMin);
    if (!c) { reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem nao encontrada.')); return null; }
    if (c.status !== 'AGUARDANDO_APROVACAO') {
      reply.code(409).send(erro('STATUS_INVALIDO', `OM no status ${c.status} nao esta aguardando aprovacao.`)); return null;
    }
    const r = podeAprovar({
      solicitanteId: c.solicitante_id, responsavelId: c.responsavel_id, executouPeloUsuario: c.executou, segundosAteLider: c.ate_lider,
    }, userId, perfil);
    if (!r.permitido) {
      reply.code(r.status!).send(erro(r.codigo!, r.motivo!, r.liberaEmSegundos !== undefined ? { liberaEmSegundos: r.liberaEmSegundos } : {}));
      return null;
    }
    const pinFalhou = await confirmarPin(userId, pin, req.log); // PIN do PRÓPRIO decisor
    if (pinFalhou) { falhaPin(reply, pinFalhou); return null; }
    return { userId, perfil, emNomeDe: r.emNomeDe ? c.solicitante_id : null };
  }

  // Aprova (AGUARDANDO_APROVACAO -> AGUARDANDO_BAIXA; a conclusão final é do gestor). Atômico: só uma decisão vale. Grava aprovado_em_nome_de quando o decisor não é o operador.
  app.post('/ordens/:id/aprovar', { preHandler: perfilAprovador, config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id: ordemId } = params.parse(req.params);
    const { pin } = z.object({ pin: pinSchema }).strict().parse(req.body);
    const d = await prepararDecisao(req, reply, ordemId, pin);
    if (!d) return reply;

    const ok = await comUsuario(d.userId, async (tx) => {
      const r = await tx.$queryRaw<{ data_aprovacao: Date }[]>`
        UPDATE ordens_manutencao
           SET status = 'AGUARDANDO_BAIXA', aprovado_por = ${d.userId}, data_aprovacao = now(), aprovado_em_nome_de = ${d.emNomeDe}::bigint
         WHERE id = ${ordemId} AND status = 'AGUARDANDO_APROVACAO'
        RETURNING data_aprovacao`;
      if (r.length === 0) return false;
      await auditar(tx, { atorId: d.userId, atorPerfil: d.perfil, acao: 'OM_APROVADA', alvoTipo: 'OM', alvoId: ordemId, emNomeDe: d.emNomeDe });
      // E3 (Fase 35): aprovação pelo solicitante/líder -> solicitante e manutenção, sem PDF.
      await notificarAprovadaSolicitante(tx, ordemId, r[0]!.data_aprovacao, req.log);
      return true;
    });
    if (!ok) return reply.code(409).send(erro('STATUS_INVALIDO', 'A OM mudou de status. Recarregue.'));
    req.log.info({ evento: 'om_aprovada', ordemId: ordemId.toString(), usuarioId: d.userId.toString(), emNomeDe: d.emNomeDe?.toString() });
    publicar({ tipo: 'om.aprovada', ordemId, statusKanban: 'AGUARDANDO_BAIXA' });
    return toJSON({ status: 'AGUARDANDO_BAIXA', statusKanban: 'AGUARDANDO_BAIXA', emNomeDe: d.emNomeDe });
  });

  // Reprova (AGUARDANDO_APROVACAO -> EM_ANDAMENTO) com motivo obrigatório; o técnico dá play de novo.
  app.post('/ordens/:id/reprovar', { preHandler: perfilAprovador, config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id: ordemId } = params.parse(req.params);
    const { motivo, pin } = z.object({ motivo: reprovarBody.shape.motivo, pin: pinSchema }).strict().parse(req.body);
    const d = await prepararDecisao(req, reply, ordemId, pin);
    if (!d) return reply;

    const ok = await comUsuario(d.userId, async (tx) => {
      const n = await tx.$executeRaw`
        UPDATE ordens_manutencao
           SET status = 'EM_ANDAMENTO', motivo_reprovacao = ${motivo}, data_conclusao = NULL, prazo_aprovacao = NULL
         WHERE id = ${ordemId} AND status = 'AGUARDANDO_APROVACAO'`;
      if (n === 0) return false;
      await auditar(tx, { atorId: d.userId, atorPerfil: d.perfil, acao: 'OM_REPROVADA', alvoTipo: 'OM', alvoId: ordemId, emNomeDe: d.emNomeDe, detalhe: { motivo } });
      return true;
    });
    if (!ok) return reply.code(409).send(erro('STATUS_INVALIDO', 'A OM mudou de status. Recarregue.'));
    req.log.info({ evento: 'om_reprovada', ordemId: ordemId.toString(), usuarioId: d.userId.toString(), emNomeDe: d.emNomeDe?.toString() });
    publicar({ tipo: 'om.reprovada', ordemId, statusKanban: 'EM_ATENDIMENTO' });
    return toJSON({ statusKanban: 'EM_ATENDIMENTO', status: 'EM_ANDAMENTO', motivo, emNomeDe: d.emNomeDe });
  });

  // ---------- OMs recusadas aguardando nova delegação (Despacho) ----------
  // Endpoint próprio (não filtro de /ordens): motivo e recusante só podem ir para quem redelega (GERENTE/ADMIN).
  app.get('/ordens/devolvidas', { preHandler: soGerente }, async () => {
    const ordens = await prisma.ordem.findMany({
      where: { status: 'ABERTA', motivoRecusa: { not: null } },
      select: {
        id: true, numeroFormatado: true, prioridade: true, dataAbertura: true, prazoAtendimento: true, motivoRecusa: true, localDescricao: true,
        equipamento: { select: { id: true, codigo: true, nome: true, setor: true, predial: true, itemLivre: true } },
      },
      take: 200,
    });
    const hist = ordens.length === 0 ? [] : await prisma.historicoStatusOrdem.findMany({
      where: { ordemId: { in: ordens.map((o) => o.id) }, statusAnterior: 'RESERVADA', statusNovo: 'ABERTA', motivo: { not: null } },
      orderBy: { criadoEm: 'desc' },
      select: { ordemId: true, criadoEm: true, usuario: { select: { id: true, nome: true } } },
    });
    const ultima = new Map<string, (typeof hist)[number]>();
    for (const h of hist) if (!ultima.has(h.ordemId.toString())) ultima.set(h.ordemId.toString(), h);
    const agora = (await prisma.$queryRaw<{ agora: Date }[]>`SELECT now() AS agora`)[0]!.agora;
    const itens = ordens.map((o) => {
      const h = ultima.get(o.id.toString());
      const urgente = o.prioridade === 'CRITICA';
      return {
        id: o.id, numero: o.numeroFormatado, equipamento: o.equipamento, setorExibicao: setorExibicao({ equipamento: o.equipamento, localDescricao: o.localDescricao }), prioridade: o.prioridade, urgente,
        dataAbertura: o.dataAbertura,
        recusadoPor: h?.usuario ?? null, recusadoEm: h?.criadoEm ?? null, motivoRecusa: o.motivoRecusa,
        // contagem do fallback (RN-22) recomeça na recusa; null para não urgentes
        liberaEmSegundos: urgente && o.prazoAtendimento ? Math.max(0, Math.ceil((o.prazoAtendimento.getTime() - agora.getTime()) / 1000)) : null,
      };
    });
    itens.sort((a, b) => Number(b.urgente) - Number(a.urgente) || (a.recusadoEm?.getTime() ?? 0) - (b.recusadoEm?.getTime() ?? 0));
    return toJSON(itens);
  });

  // ---------- Linha do tempo de status (V004) ----------
  app.get('/ordens/:id/historico', { preHandler: painelManutencao }, async (req, reply) => {
    const { id: ordemId } = params.parse(req.params);
    const existe = await prisma.ordem.findUnique({ where: { id: ordemId }, select: { id: true } });
    if (!existe) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    const h = await prisma.historicoStatusOrdem.findMany({
      where: { ordemId },
      orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
      select: { statusAnterior: true, statusNovo: true, motivo: true, criadoEm: true, usuario: { select: { id: true, nome: true } } },
      take: 500,
    });
    return toJSON(h);
  });

  // ---------- Notas (US-02: complementar OM) ----------
  app.post('/ordens/:id/notas', async (req, reply) => {
    const { id: ordemId } = params.parse(req.params);
    const { nota } = notaBody.parse(req.body);

    const ordem = await prisma.ordem.findUnique({ where: { id: ordemId }, select: { status: true } });
    if (!ordem) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    if (ordem.status === 'CONCLUIDA' || ordem.status === 'CANCELADA') {
      return reply.code(409).send(erro('OM_ENCERRADA', 'Não é possível complementar uma OM encerrada.'));
    }
    const criada = await prisma.ordemNota.create({
      data: { ordemId, autorId: BigInt(req.user.sub), nota },
      select: { id: true, ordemId: true, nota: true, criadoEm: true, autor: { select: { id: true, nome: true } } },
    });
    publicar({ tipo: 'om.nota', ordemId });
    return reply.code(201).send(toJSON(criada));
  });

  app.get('/ordens/:id/notas', async (req, reply) => {
    const { id: ordemId } = params.parse(req.params);
    const notas = await prisma.ordemNota.findMany({
      where: { ordemId },
      orderBy: { criadoEm: 'asc' },
      select: { id: true, nota: true, criadoEm: true, autor: { select: { id: true, nome: true } } },
      take: 200,
    });
    return toJSON(notas);
  });
};




