import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma, type Tx } from '../db.js';
import { toJSON } from '../serialize.js';
import { publicar } from '../events.js';
import { painelManutencao, soTecnico } from '../plugins/rbac.js';

const id = z.string().regex(/^\d{1,18}$/, 'id inválido').transform((v) => BigInt(v));
const ordemParams = z.object({ id });
const itemParams = z.object({ id, itemId: id });
const erro = (error: string, message: string, extra: object = {}) => ({ error, message, ...extra });

const LINHAS_MAX = 4; // a ficha tem as linhas 01 a 04 em cada grade de teste
const TOLERANCIA_RELOGIO_MS = 60_000;
const DIA_MS = 86_400_000;

/** OM em que ainda se pode editar a ficha (apontar horas/testes). */
const editaveis = ['EM_ANDAMENTO', 'PAUSADA', 'AGUARDANDO_PECA'];
const editaveisTeste = [...editaveis, 'AGUARDANDO_APROVACAO']; // testes acontecem depois da execução, antes do aceite

type Falha = { status: number; body: object };
const naoEditavel = (status: string, lista: string[]): Falha | null =>
  lista.includes(status) ? null : { status: 409, body: erro('OM_NAO_EDITAVEL', `OM com status ${status} não aceita este lançamento.`) };

async function carregarOrdem(ordemId: bigint) {
  return prisma.ordem.findUnique({ where: { id: ordemId }, select: { id: true, status: true, responsavelId: true, dataAbertura: true } });
}
const ehResponsavelOuAdmin = (o: { responsavelId: bigint | null }, user: { sub: string; perfil: string }) =>
  user.perfil === 'ADMIN' || o.responsavelId === BigInt(user.sub);
const NAO_RESPONSAVEL = erro('NAO_E_RESPONSAVEL', 'Apenas o técnico responsável (ou ADMIN) pode lançar na ficha desta OM.');

// ======================= Apontamento retroativo (verso: DATA / HORAS TRABALHADAS / OBS COD) =======================
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'hora no formato HH:MM');
// V007: lançamento retroativo exige `justificativa` (CHECK do banco). `observacao`/`obsCod` são sinônimos
// aceitos (contrato do front e "Observações (COD)" da ficha).
const apontBody = z
  .object({
    // Forma 1 (grade da ficha, horário local de TZ_RELATORIOS): data + horaInicio + horaFim
    data: z.iso.date().optional(),
    horaInicio: hhmm.optional(),
    horaFim: hhmm.optional(),
    // Forma 2 (instantes ISO com fuso): inicio + fim
    inicio: z.iso.datetime({ offset: true }).optional(),
    fim: z.iso.datetime({ offset: true }).optional(),
    justificativa: z.string().trim().min(1).max(250).optional(),
    observacao: z.string().trim().min(1).max(250).optional(),
    obsCod: z.string().trim().min(1).max(250).optional(),
  }).strict()
  .refine((b) => (b.data && b.horaInicio && b.horaFim) || (b.inicio && b.fim), {
    message: 'Informe data+horaInicio+horaFim ou inicio+fim',
  })
  .refine((b) => !!(b.justificativa ?? b.observacao ?? b.obsCod), {
    path: ['justificativa'],
    message: 'Informe a justificativa do lançamento retroativo',
  });

const excluirBody = z.object({ motivo: z.string().trim().min(3).max(250) }).strict();
const apontParams = z.object({ id, apId: id });

interface ApontRow {
  id: bigint; inicio: Date; fim: Date | null; origem: 'CRONOMETRO' | 'RETROATIVO'; justificativa: string | null;
  tecnico_id: bigint; tecnico_nome: string;
  deletado_em: Date | null; motivo_exclusao: string | null; excluido_por_nome: string | null;
}
const apontDto = (r: ApontRow) => ({
  id: r.id,
  inicio: r.inicio,
  fim: r.fim,
  origem: r.origem,
  manual: r.origem === 'RETROATIVO', // contrato do front
  justificativa: r.justificativa,
  observacao: r.justificativa, // alias (contrato do front)
  tecnico: { id: r.tecnico_id, nome: r.tecnico_nome },
  horas: r.fim ? Math.round(((r.fim.getTime() - r.inicio.getTime()) / 3_600_000) * 100) / 100 : null,
  // só preenchidos quando a listagem inclui excluídos (GERENTE/ADMIN)
  excluidoEm: r.deletado_em,
  motivoExclusao: r.motivo_exclusao,
  excluidoPor: r.excluido_por_nome,
});

/** Por padrão só apontamentos válidos (deletado_em IS NULL): é o que conta para tempo líquido e MTTR. */
async function apontamentos(ordemId: bigint, incluirExcluidos = false, tx: Pick<Tx, '$queryRaw'> = prisma) {
  return (await tx.$queryRaw<ApontRow[]>`
    SELECT a.id, a.inicio, a.fim, a.origem::text AS origem, a.justificativa, a.tecnico_id, u.nome AS tecnico_nome,
           a.deletado_em, a.motivo_exclusao, ux.nome AS excluido_por_nome
      FROM om_apontamentos_tempo a
      JOIN usuarios u ON u.id = a.tecnico_id
      LEFT JOIN usuarios ux ON ux.id = a.deletado_por
     WHERE a.ordem_id = ${ordemId} AND (${incluirExcluidos}::boolean OR a.deletado_em IS NULL)
     ORDER BY a.inicio, a.id`).map(apontDto);
}

// ======================= Testes =======================
const instante = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const naoFuturo = (d: Date | null | undefined) => !d || d.getTime() <= Date.now() + TOLERANCIA_RELOGIO_MS;
const MSG_FUTURO = 'Data/hora não pode estar no futuro.';

const tqBase = z.object({
  testeSn: z.boolean(),
  dataHora: instante.nullable().optional(),
  programacao: z.string().trim().max(1000).nullable().optional(),
  cienteExecutante: z.boolean().optional(),
  // Aprovação: somente GESTOR/ADMIN (verificado na rota).
  aprovadoSn: z.boolean().nullable().optional(),
  dataHoraAprov: instante.nullable().optional(),
}).strict();
const APROV_CAMPOS = ['aprovadoSn', 'dataHoraAprov'] as const;

const tpBase = z.object({
  recebido: instante.nullable().optional(),
  inicio: instante.nullable().optional(),
  final: instante.nullable().optional(),
  devolvido: instante.nullable().optional(),
}).strict();
/** Mesmas regras de ordenação das CHECKs do banco, para devolver 400 legível em vez de 500. */
function ordemTemporal(campos: Record<string, Date | null | undefined>, ordem: string[]): string | null {
  let ant: [string, Date] | null = null;
  for (const k of ordem) {
    const v = campos[k];
    if (!v) continue;
    if (!naoFuturo(v)) return `${k}: ${MSG_FUTURO}`;
    if (ant && v < ant[1]) return `${k} não pode ser anterior a ${ant[0]}.`;
    ant = [k, v];
  }
  return null;
}

const tqDto = (t: { id: bigint; ordemId: bigint; testeSn: boolean; dataHora: Date | null; programacao: string | null; aprovadoSn: boolean | null; dataHoraAprov: Date | null; cienteExecutante: boolean }, n: number) => ({ ...t, numero: n });
const tpDto = (t: { id: bigint; ordemId: bigint; recebido: Date | null; inicio: Date | null; final: Date | null; devolvido: Date | null }, n: number) => ({
  ...t,
  numero: n,
  tempoTotalSegundos: t.inicio && t.final ? Math.floor((t.final.getTime() - t.inicio.getTime()) / 1000) : null,
});

export const fichaRoutes: FastifyPluginAsync = async (app) => {
  // ---------- Apontamentos (listar) ----------
  app.get('/ordens/:id/apontamentos', { preHandler: painelManutencao }, async (req, reply) => {
    const { id: ordemId } = ordemParams.parse(req.params);
    const { incluirExcluidos } = z.object({ incluirExcluidos: z.enum(['true', 'false']).default('false') }).parse(req.query);
    if (!(await carregarOrdem(ordemId))) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    // Excluídos (com quem/quando/por quê) só para quem supervisiona.
    const verExcluidos = incluirExcluidos === 'true' && (req.user.perfil === 'GERENTE' || req.user.perfil === 'ADMIN');
    return toJSON(await apontamentos(ordemId, verExcluidos));
  });

  // ---------- Apontamento retroativo ----------
  app.post('/ordens/:id/apontamentos', { preHandler: soTecnico }, async (req, reply) => {
    const { id: ordemId } = ordemParams.parse(req.params);
    const b = apontBody.parse(req.body);
    const tecnicoId = BigInt(req.user.sub);

    const ordem = await carregarOrdem(ordemId);
    if (!ordem) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    if (!ehResponsavelOuAdmin(ordem, req.user)) return reply.code(403).send(NAO_RESPONSAVEL);
    const nao = naoEditavel(ordem.status, editaveis);
    if (nao) return reply.code(nao.status).send(nao.body);

    // Converte data+HH:MM (horário local da fábrica) para instantes; ou usa os ISO informados.
    let inicio: Date, fim: Date;
    if (b.data && b.horaInicio && b.horaFim) {
      const r = await prisma.$queryRaw<{ i: Date; f: Date }[]>`
        SELECT ((${b.data}::date + ${b.horaInicio}::time) AT TIME ZONE ${config.TZ_RELATORIOS}::text) AS i,
               ((${b.data}::date + ${b.horaFim}::time)    AT TIME ZONE ${config.TZ_RELATORIOS}::text) AS f`;
      inicio = r[0]!.i;
      fim = r[0]!.f;
    } else {
      inicio = new Date(b.inicio!);
      fim = new Date(b.fim!);
    }

    const agora = Date.now();
    const problema =
      fim <= inicio ? 'O fim deve ser depois do início.'
      : fim.getTime() - inicio.getTime() > DIA_MS ? 'O intervalo não pode passar de 24 horas.'
      : fim.getTime() > agora + TOLERANCIA_RELOGIO_MS ? 'O fim não pode estar no futuro.'
      : inicio.getTime() < agora - config.RETROATIVO_MAX_DIAS * DIA_MS ? `Lançamento retroativo limitado a ${config.RETROATIVO_MAX_DIAS} dias.`
      : inicio < ordem.dataAbertura ? 'O início não pode ser anterior à abertura da OM.'
      : null;
    if (problema) return reply.code(400).send(erro('VALIDACAO', problema));

    const justificativa = (b.justificativa ?? b.observacao ?? b.obsCod)!;

    const criado = await prisma.$transaction(async (tx) => {
      // Serializa lançamentos do mesmo técnico para a checagem de sobreposição não ter corrida.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'apont:' + tecnicoId}, 0))`;
      const conflito = await tx.$queryRaw<{ id: bigint; ordem_id: bigint }[]>`
        SELECT id, ordem_id FROM om_apontamentos_tempo
         WHERE tecnico_id = ${tecnicoId} AND deletado_em IS NULL
           AND tstzrange(inicio, COALESCE(fim, 'infinity'::timestamptz), '[)') && tstzrange(${inicio}::timestamptz, ${fim}::timestamptz, '[)')
         LIMIT 1`;
      if (conflito.length > 0) return { conflito: conflito[0]!, id: null };
      const ins = await tx.$queryRaw<{ id: bigint }[]>`
        INSERT INTO om_apontamentos_tempo (ordem_id, tecnico_id, inicio, fim, origem, justificativa)
        VALUES (${ordemId}, ${tecnicoId}, ${inicio}, ${fim}, 'RETROATIVO'::apontamento_origem, ${justificativa})
        RETURNING id`;
      // O atendimento começou no primeiro apontamento (MTTA correto mesmo com lançamento retroativo).
      await tx.$executeRaw`UPDATE ordens_manutencao SET data_inicio = LEAST(COALESCE(data_inicio, ${inicio}::timestamptz), ${inicio}::timestamptz) WHERE id = ${ordemId}`;
      return { conflito: null, id: ins[0]!.id };
    });
    if (criado.conflito) {
      return reply.code(409).send(erro('APONTAMENTO_SOBREPOSTO', 'Já existe apontamento seu neste período (incluindo cronômetro em andamento).', {
        apontamentoId: criado.conflito.id.toString(), ordemId: criado.conflito.ordem_id.toString(),
      }));
    }
    req.log.info({ evento: 'apontamento_retroativo', ordemId: ordemId.toString(), tecnicoId: tecnicoId.toString() });
    publicar({ tipo: 'om.apontamento', ordemId });
    const lista = await apontamentos(ordemId);
    return reply.code(201).send(toJSON(lista.find((a) => a.id === criado.id)));
  });

  // ---------- Exclusão (lógica) de apontamento retroativo ----------
  // Só RETROATIVO (cronômetro nunca é excluído). O autor exclui enquanto a OM está em execução; GERENTE/ADMIN
  // excluem a qualquer momento. Motivo obrigatório; ficam registrados quem, quando e por quê (V007).
  app.delete('/ordens/:id/apontamentos/:apId', { preHandler: painelManutencao }, async (req, reply) => {
    const { id: ordemId, apId } = apontParams.parse(req.params);
    const { motivo } = excluirBody.parse(req.body);
    const userId = BigInt(req.user.sub);
    const supervisor = req.user.perfil === 'GERENTE' || req.user.perfil === 'ADMIN';

    const ordem = await carregarOrdem(ordemId);
    if (!ordem) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    const ap = (await prisma.$queryRaw<{ tecnico_id: bigint; origem: string; deletado_em: Date | null }[]>`
      SELECT tecnico_id, origem::text AS origem, deletado_em FROM om_apontamentos_tempo
       WHERE id = ${apId} AND ordem_id = ${ordemId}`)[0];
    if (!ap) return reply.code(404).send(erro('APONTAMENTO_NAO_ENCONTRADO', 'Apontamento não encontrado nesta OM.'));
    if (ap.origem !== 'RETROATIVO') {
      return reply.code(409).send(erro('APONTAMENTO_NAO_EXCLUIVEL', 'Só lançamentos retroativos podem ser excluídos; o tempo do cronômetro é definitivo.'));
    }
    if (ap.deletado_em) return reply.code(409).send(erro('JA_EXCLUIDO', 'Este apontamento já foi excluído.'));
    if (!supervisor) {
      if (ap.tecnico_id !== userId) return reply.code(403).send(erro('NAO_E_AUTOR', 'Só o autor do lançamento (ou GERENTE/ADMIN) pode excluí-lo.'));
      const nao = naoEditavel(ordem.status, editaveis);
      if (nao) return reply.code(nao.status).send(nao.body);
    }

    const ok = await prisma.$transaction(async (tx) => {
      // Condição repetida no UPDATE: se dois pedidos chegarem juntos, só um exclui.
      const n = await tx.$executeRaw`
        UPDATE om_apontamentos_tempo
           SET deletado_em = now(), deletado_por = ${userId}, motivo_exclusao = ${motivo}
         WHERE id = ${apId} AND ordem_id = ${ordemId} AND origem = 'RETROATIVO'::apontamento_origem AND deletado_em IS NULL`;
      if (n === 0) return false;
      // OM ainda em execução: o início do atendimento passa a ser o do primeiro apontamento válido restante.
      await tx.$executeRaw`
        UPDATE ordens_manutencao
           SET data_inicio = (SELECT min(inicio) FROM om_apontamentos_tempo WHERE ordem_id = ${ordemId} AND deletado_em IS NULL)
         WHERE id = ${ordemId} AND status IN ('EM_ANDAMENTO', 'PAUSADA', 'AGUARDANDO_PECA')`;
      return true;
    });
    if (!ok) return reply.code(409).send(erro('JA_EXCLUIDO', 'Este apontamento já foi excluído.'));
    req.log.info({ evento: 'apontamento_excluido', ordemId: ordemId.toString(), apontamentoId: apId.toString(), por: userId.toString() });
    publicar({ tipo: 'om.apontamento', ordemId });
    return reply.code(204).send();
  });

  // ---------- Testes de Qualidade (frente: Nº / TESTE S/N / DATA-HORA / PROGRAMAÇÃO / APROVADO S/N / CIENTE) ----------
  app.get('/ordens/:id/testes-qualidade', { preHandler: painelManutencao }, async (req, reply) => {
    const { id: ordemId } = ordemParams.parse(req.params);
    if (!(await carregarOrdem(ordemId))) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    const itens = await prisma.omTesteQualidade.findMany({ where: { ordemId }, orderBy: { id: 'asc' }, take: LINHAS_MAX });
    return toJSON(itens.map((t, i) => tqDto(t, i + 1)));
  });

  app.post('/ordens/:id/testes-qualidade', { preHandler: painelManutencao }, async (req, reply) => {
    const { id: ordemId } = ordemParams.parse(req.params);
    const b = tqBase.parse(req.body);
    const ordem = await carregarOrdem(ordemId);
    if (!ordem) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    const falha = autorizarTq(req.user, ordem, b);
    if (falha) return reply.code(falha.status).send(falha.body);
    const nao = naoEditavel(ordem.status, editaveisTeste);
    if (nao) return reply.code(nao.status).send(nao.body);
    const v = validarTq(b);
    if (v) return reply.code(400).send(erro('VALIDACAO', v));

    const r = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'tq:' + ordemId}, 0))`;
      if ((await tx.omTesteQualidade.count({ where: { ordemId } })) >= LINHAS_MAX) return null;
      return tx.omTesteQualidade.create({
        data: {
          ordemId, testeSn: b.testeSn, dataHora: b.dataHora ?? null, programacao: b.programacao ?? null,
          cienteExecutante: b.cienteExecutante ?? false,
          aprovadoSn: b.aprovadoSn ?? null,
          dataHoraAprov: b.aprovadoSn == null ? null : (b.dataHoraAprov ?? new Date()),
        },
      });
    });
    if (!r) return reply.code(409).send(erro('LIMITE_LINHAS', `A ficha comporta no máximo ${LINHAS_MAX} testes de qualidade.`));
    publicar({ tipo: 'om.teste', ordemId });
    return reply.code(201).send(toJSON(tqDto(r, (await prisma.omTesteQualidade.count({ where: { ordemId, id: { lte: r.id } } })))));
  });

  app.patch('/ordens/:id/testes-qualidade/:itemId', { preHandler: painelManutencao }, async (req, reply) => {
    const { id: ordemId, itemId } = itemParams.parse(req.params);
    const b = tqBase.partial().parse(req.body);
    if (Object.keys(b).length === 0) return reply.code(400).send(erro('VALIDACAO', 'Nada para atualizar.'));
    const ordem = await carregarOrdem(ordemId);
    if (!ordem) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    const falha = autorizarTq(req.user, ordem, b);
    if (falha) return reply.code(falha.status).send(falha.body);
    const nao = naoEditavel(ordem.status, editaveisTeste);
    if (nao) return reply.code(nao.status).send(nao.body);

    const atual = await prisma.omTesteQualidade.findFirst({ where: { id: itemId, ordemId } });
    if (!atual) return reply.code(404).send(erro('TESTE_NAO_ENCONTRADO', 'Teste não encontrado nesta OM.'));
    const merged = {
      dataHora: b.dataHora !== undefined ? b.dataHora : atual.dataHora,
      aprovadoSn: b.aprovadoSn !== undefined ? b.aprovadoSn : atual.aprovadoSn,
      dataHoraAprov: b.dataHoraAprov !== undefined ? b.dataHoraAprov : atual.dataHoraAprov,
    };
    const v = validarTq(merged);
    if (v) return reply.code(400).send(erro('VALIDACAO', v));

    const r = await prisma.omTesteQualidade.update({
      where: { id: itemId },
      data: {
        ...(b.testeSn !== undefined && { testeSn: b.testeSn }),
        ...(b.dataHora !== undefined && { dataHora: b.dataHora }),
        ...(b.programacao !== undefined && { programacao: b.programacao }),
        ...(b.cienteExecutante !== undefined && { cienteExecutante: b.cienteExecutante }),
        ...(b.aprovadoSn !== undefined && { aprovadoSn: b.aprovadoSn }),
        // CHECK do banco: aprovado_sn preenchido exige data_hora_aprov
        dataHoraAprov: merged.aprovadoSn == null ? null : (merged.dataHoraAprov ?? new Date()),
      },
    });
    publicar({ tipo: 'om.teste', ordemId });
    return toJSON(tqDto(r, await prisma.omTesteQualidade.count({ where: { ordemId, id: { lte: r.id } } })));
  });

  app.delete('/ordens/:id/testes-qualidade/:itemId', { preHandler: soTecnico }, async (req, reply) => {
    const { id: ordemId, itemId } = itemParams.parse(req.params);
    const ordem = await carregarOrdem(ordemId);
    if (!ordem) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    if (!ehResponsavelOuAdmin(ordem, req.user)) return reply.code(403).send(NAO_RESPONSAVEL);
    const nao = naoEditavel(ordem.status, editaveisTeste);
    if (nao) return reply.code(nao.status).send(nao.body);
    const r = await prisma.omTesteQualidade.deleteMany({ where: { id: itemId, ordemId } });
    if (r.count === 0) return reply.code(404).send(erro('TESTE_NAO_ENCONTRADO', 'Teste não encontrado nesta OM.'));
    publicar({ tipo: 'om.teste', ordemId });
    return reply.code(204).send();
  });

  // ---------- Testes de Produção (frente: RECEBIDO / INÍCIO / FINAL / TEMPO TOTAL / DEVOLVIDO) ----------
  app.get('/ordens/:id/testes-producao', { preHandler: painelManutencao }, async (req, reply) => {
    const { id: ordemId } = ordemParams.parse(req.params);
    if (!(await carregarOrdem(ordemId))) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    const itens = await prisma.omTesteProducao.findMany({ where: { ordemId }, orderBy: { id: 'asc' }, take: LINHAS_MAX });
    return toJSON(itens.map((t, i) => tpDto(t, i + 1)));
  });

  app.post('/ordens/:id/testes-producao', { preHandler: soTecnico }, async (req, reply) => {
    const { id: ordemId } = ordemParams.parse(req.params);
    const b = tpBase.parse(req.body);
    const ordem = await carregarOrdem(ordemId);
    if (!ordem) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    if (!ehResponsavelOuAdmin(ordem, req.user)) return reply.code(403).send(NAO_RESPONSAVEL);
    const nao = naoEditavel(ordem.status, editaveisTeste);
    if (nao) return reply.code(nao.status).send(nao.body);
    const v = ordemTemporal(b, ['recebido', 'inicio', 'final', 'devolvido']);
    if (v) return reply.code(400).send(erro('VALIDACAO', v));

    const r = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'tp:' + ordemId}, 0))`;
      if ((await tx.omTesteProducao.count({ where: { ordemId } })) >= LINHAS_MAX) return null;
      return tx.omTesteProducao.create({
        data: { ordemId, recebido: b.recebido ?? null, inicio: b.inicio ?? null, final: b.final ?? null, devolvido: b.devolvido ?? null },
      });
    });
    if (!r) return reply.code(409).send(erro('LIMITE_LINHAS', `A ficha comporta no máximo ${LINHAS_MAX} testes de produção.`));
    publicar({ tipo: 'om.teste', ordemId });
    return reply.code(201).send(toJSON(tpDto(r, await prisma.omTesteProducao.count({ where: { ordemId, id: { lte: r.id } } }))));
  });

  app.patch('/ordens/:id/testes-producao/:itemId', { preHandler: soTecnico }, async (req, reply) => {
    const { id: ordemId, itemId } = itemParams.parse(req.params);
    const b = tpBase.parse(req.body);
    if (Object.keys(b).length === 0) return reply.code(400).send(erro('VALIDACAO', 'Nada para atualizar.'));
    const ordem = await carregarOrdem(ordemId);
    if (!ordem) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    if (!ehResponsavelOuAdmin(ordem, req.user)) return reply.code(403).send(NAO_RESPONSAVEL);
    const nao = naoEditavel(ordem.status, editaveisTeste);
    if (nao) return reply.code(nao.status).send(nao.body);

    const atual = await prisma.omTesteProducao.findFirst({ where: { id: itemId, ordemId } });
    if (!atual) return reply.code(404).send(erro('TESTE_NAO_ENCONTRADO', 'Teste não encontrado nesta OM.'));
    const m = {
      recebido: b.recebido !== undefined ? b.recebido : atual.recebido,
      inicio: b.inicio !== undefined ? b.inicio : atual.inicio,
      final: b.final !== undefined ? b.final : atual.final,
      devolvido: b.devolvido !== undefined ? b.devolvido : atual.devolvido,
    };
    const v = ordemTemporal(m, ['recebido', 'inicio', 'final', 'devolvido']);
    if (v) return reply.code(400).send(erro('VALIDACAO', v));
    const r = await prisma.omTesteProducao.update({ where: { id: itemId }, data: m });
    publicar({ tipo: 'om.teste', ordemId });
    return toJSON(tpDto(r, await prisma.omTesteProducao.count({ where: { ordemId, id: { lte: r.id } } })));
  });

  app.delete('/ordens/:id/testes-producao/:itemId', { preHandler: soTecnico }, async (req, reply) => {
    const { id: ordemId, itemId } = itemParams.parse(req.params);
    const ordem = await carregarOrdem(ordemId);
    if (!ordem) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));
    if (!ehResponsavelOuAdmin(ordem, req.user)) return reply.code(403).send(NAO_RESPONSAVEL);
    const nao = naoEditavel(ordem.status, editaveisTeste);
    if (nao) return reply.code(nao.status).send(nao.body);
    const r = await prisma.omTesteProducao.deleteMany({ where: { id: itemId, ordemId } });
    if (r.count === 0) return reply.code(404).send(erro('TESTE_NAO_ENCONTRADO', 'Teste não encontrado nesta OM.'));
    publicar({ tipo: 'om.teste', ordemId });
    return reply.code(204).send();
  });
};

// ---- regras de Testes de Qualidade ----
type UserTok = { sub: string; perfil: string };
/**
 * Campos de aprovação (aprovadoSn/dataHoraAprov): só GESTOR/ADMIN. Demais campos: técnico responsável ou ADMIN
 * (GESTOR pode apenas aprovar). Aprovador não pode ser o próprio executante da OM (segregação, como na V006).
 */
function autorizarTq(user: UserTok, ordem: { responsavelId: bigint | null }, b: Record<string, unknown>): Falha | null {
  const tocaAprov = APROV_CAMPOS.some((c) => b[c] !== undefined);
  const tocaOutros = Object.keys(b).some((c) => !(APROV_CAMPOS as readonly string[]).includes(c));
  const supervisor = user.perfil === 'GERENTE' || user.perfil === 'ADMIN';
  if (tocaAprov) {
    if (!supervisor) return { status: 403, body: erro('ACESSO_NEGADO', 'Apenas GERENTE/ADMIN registram a aprovação do teste.') };
    if (ordem.responsavelId === BigInt(user.sub)) {
      return { status: 403, body: erro('AUTOAPROVACAO_PROIBIDA', 'O executante da OM não pode aprovar o próprio teste.') };
    }
  }
  if (tocaOutros && !ehResponsavelOuAdmin(ordem, user)) return { status: 403, body: NAO_RESPONSAVEL };
  return null;
}
function validarTq(b: { dataHora?: Date | null; dataHoraAprov?: Date | null; aprovadoSn?: boolean | null }): string | null {
  if (!naoFuturo(b.dataHora) || !naoFuturo(b.dataHoraAprov)) return MSG_FUTURO;
  if (b.dataHora && b.dataHoraAprov && b.dataHoraAprov < b.dataHora) return 'A data/hora da aprovação não pode ser anterior à do teste.';
  return null;
}
