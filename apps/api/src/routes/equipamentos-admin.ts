import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db.js';
import { toJSON } from '../serialize.js';
import { auditar } from '../auditoria.js';
import { ehFk, ehUnico } from '../erros-db.js';
import { soAdmin } from '../plugins/rbac.js';
import { GRUPO_RESERVADO } from '../grupos.js';

// Fase 23 (contrato-fase23-maquinas-por-setor.md §3): cadastro simplificado de máquinas por setor. Somente ADMIN.
// A API grava `setor_id`; `equipamentos.setor` (texto) é derivado pelo trigger da V021 e nunca é escrito aqui.

const id = z.string().regex(/^\d{1,18}$/, 'id inválido').transform((v) => BigInt(v));
const paramsId = z.object({ id }).strict();
const erro = (error: string, message: string, extra: object = {}) => ({ error, message, ...extra });

const colapsar = (v: string) => v.replace(/\s+/g, ' ').trim();
const semControle = (v: string) => !/[\u0000-\u001f\u007f]/.test(v);
const tag = z.string().transform(colapsar).pipe(
  z.string().min(2).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/, 'tag: letras, números, espaço e . _ - / (sem acentos)'),
);
const nome = z.string().transform(colapsar).pipe(z.string().min(2).max(150).refine(semControle, 'caracteres de controle não são permitidos'));
// Modelo opcional: vazio/ausente vira null.
const modelo = z.string().transform(colapsar).pipe(z.string().max(100).refine(semControle, 'caracteres de controle não são permitidos'))
  .transform((v) => (v === '' ? null : v));
const status = z.enum(['ATIVO', 'INATIVO']); // EM_MANUTENCAO/DESCARTADO (legado) não são aceitos na entrada

const criarBody = z.object({ tag, nome, modelo: modelo.nullish(), grupoId: id.optional() }).strict(); // grupoId: Fase 30 (padrão PRODUTIVOS)
const atualizarBody = z.object({ tag, nome, modelo: modelo.nullable(), status, setorId: id, grupoId: id }).partial().strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Informe ao menos um campo para atualizar' });
const listQuery = z.object({
  busca: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['ATIVO', 'INATIVO', 'EM_MANUTENCAO', 'DESCARTADO']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
}).strict();

interface Linha {
  id: bigint; codigo: string; nome: string; modelo: string | null; status: string; setor_id: bigint; setor_nome: string;
  grupo_id: bigint; grupo_codigo: string; grupo_nome: string; predial: boolean; item_livre: boolean;
  oms_abertas: number; oms_total: number; criado_em: Date; atualizado_em: Date;
}

/** Itens no formato `EquipamentoAdmin` (§3). `filtro` é um fragmento WHERE sobre `e`; o PREDIAL nunca entra. */
async function listar(filtro: Prisma.Sql, limite?: { limit: number; offset: number }, comReservados = false) {
  const linhas = await prisma.$queryRaw<Linha[]>`
    SELECT e.id, e.codigo, e.nome, e.modelo, e.status::text AS status, e.setor_id, s.nome AS setor_nome, e.grupo_id, g.codigo AS grupo_codigo, g.nome AS grupo_nome, e.predial, e.item_livre,
           (SELECT count(*) FROM ordens_manutencao o WHERE o.equipamento_id = e.id AND o.status NOT IN ('CONCLUIDA','CANCELADA'))::int AS oms_abertas,
           (SELECT count(*) FROM ordens_manutencao o WHERE o.equipamento_id = e.id)::int AS oms_total,
           e.criado_em, e.atualizado_em
      FROM equipamentos e JOIN setores s ON s.id = e.setor_id JOIN grupos_ativos g ON g.id = e.grupo_id
     WHERE ${comReservados ? Prisma.sql`NOT e.item_livre` : Prisma.sql`NOT e.predial AND NOT e.item_livre`} AND ${filtro}
     ORDER BY lower(e.codigo) ASC, e.codigo ASC
     ${limite ? Prisma.sql`LIMIT ${limite.limit} OFFSET ${limite.offset}` : Prisma.empty}`;
  return linhas.map((l) => ({
    id: l.id, tag: l.codigo, nome: l.nome, modelo: l.modelo, status: l.status, setorId: l.setor_id, setorNome: l.setor_nome, grupoId: l.grupo_id, grupoCodigo: l.grupo_codigo, grupoNome: l.grupo_nome, predial: l.predial,
    omsAbertas: l.oms_abertas, omsTotal: l.oms_total, criadoEm: l.criado_em, atualizadoEm: l.atualizado_em,
  }));
}
const item = async (eqId: bigint) => (await listar(Prisma.sql`e.id = ${eqId}`))[0]!;

const GRUPO_RESERVADO_MSG = 'O grupo Predial e Outros é reservado ao predial e ao item avulso.';
const duplicada = () => erro('EQUIPAMENTO_TAG_DUPLICADA', 'Já existe uma máquina com esta TAG.', { campo: 'tag' });
type Falha = { falha: [number, object] };
const falha = (code: number, corpo: object): Falha => ({ falha: [code, corpo] });
const ehFalha = (x: unknown): x is Falha => typeof x === 'object' && x !== null && 'falha' in x;

export const equipamentosAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get('/setores/:id/equipamentos', { preHandler: soAdmin }, async (req, reply) => {
    const { id: setorId } = paramsId.parse(req.params);
    const q = listQuery.parse(req.query);
    const setor = await prisma.setor.findUnique({ where: { id: setorId }, select: { id: true, nome: true, ativo: true, predial: true } });
    if (!setor) return reply.code(404).send(erro('SETOR_NAO_ENCONTRADO', 'Setor não encontrado.'));
    const cond: Prisma.Sql[] = [Prisma.sql`e.setor_id = ${setorId}`];
    if (q.status) cond.push(Prisma.sql`e.status = ${q.status}::status_equipamento`);
    if (q.busca) {
      const like = '%' + q.busca.replace(/[\\%_]/g, '\\$&') + '%';
      cond.push(Prisma.sql`(e.codigo ILIKE ${like} OR e.nome ILIKE ${like} OR e.modelo ILIKE ${like})`);
    }
    const where = Prisma.join(cond, ' AND ');
    const [[tot], itens] = await Promise.all([
      prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM equipamentos e WHERE NOT e.predial AND ${where}`,
      listar(where, { limit: q.limit, offset: q.offset }),
    ]);
    reply.header('X-Total-Count', tot?.n ?? 0);
    return toJSON({ itens, setor });
  });

  app.post('/setores/:id/equipamentos', { preHandler: soAdmin }, async (req, reply) => {
    const { id: setorId } = paramsId.parse(req.params);
    const b = criarBody.parse(req.body);
    try {
      const r = await prisma.$transaction(async (tx) => {
        const setor = await tx.setor.findUnique({ where: { id: setorId }, select: { nome: true, ativo: true, predial: true } });
        if (!setor) return falha(404, erro('SETOR_NAO_ENCONTRADO', 'Setor não encontrado.'));
        if (setor.predial) return falha(422, erro('SETOR_PREDIAL_SEM_EQUIPAMENTOS', 'O setor predial não possui máquinas cadastráveis.'));
        if (!setor.ativo) return falha(422, erro('SETOR_INATIVO', 'Este setor está desativado.'));
        if ((await tx.equipamento.count({ where: { codigo: { equals: b.tag, mode: 'insensitive' } } })) > 0) return falha(409, duplicada());
        const grupo = await tx.grupoAtivo.findFirst({ where: b.grupoId !== undefined ? { id: b.grupoId } : { codigo: 'PRODUTIVOS' }, select: { id: true, codigo: true } });
        if (!grupo) return falha(404, erro('GRUPO_NAO_ENCONTRADO', 'Grupo não encontrado.'));
        if (grupo.codigo === GRUPO_RESERVADO) return falha(422, erro('GRUPO_RESERVADO', GRUPO_RESERVADO_MSG));
        const e = await tx.equipamento.create({
          data: { codigo: b.tag, nome: b.nome, modelo: b.modelo ?? null, setorId, setor: setor.nome, grupoId: grupo.id, status: 'ATIVO', predial: false },
          select: { id: true },
        });
        await auditar(tx, {
          atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'EQUIPAMENTO_CRIADO', alvoTipo: 'EQUIPAMENTO', alvoId: e.id,
          detalhe: { tag: b.tag, nome: b.nome, modelo: b.modelo ?? null, setorId, setorNome: setor.nome, grupo: grupo.codigo },
        });
        return e;
      });
      if (ehFalha(r)) return reply.code(r.falha[0]).send(r.falha[1]);
      req.log.info({ evento: 'equipamento_criado', equipamentoId: r.id.toString(), por: req.user.sub });
      return reply.code(201).send(toJSON(await item(r.id)));
    } catch (e) {
      if (ehUnico(e)) return reply.code(409).send(duplicada());
      throw e;
    }
  });

  // ---------- Fase 31 (§4): equipamentos por grupo ----------
  const infoGrupo = async (grupoId: bigint) => {
    const g = await prisma.grupoAtivo.findUnique({ where: { id: grupoId }, select: { id: true, codigo: true, nome: true } });
    if (!g) return null;
    return { ...g, reservado: g.codigo === GRUPO_RESERVADO, modo: 'LISTA' as const };
  };

  app.get('/grupos-ativos/:id/equipamentos', { preHandler: soAdmin }, async (req, reply) => {
    const { id: grupoId } = paramsId.parse(req.params);
    const q = listQuery.parse(req.query);
    const grupo = await infoGrupo(grupoId);
    if (!grupo) return reply.code(404).send(erro('GRUPO_NAO_ENCONTRADO', 'Grupo não encontrado.'));
    if (grupo.reservado) { reply.header('X-Total-Count', 0); return toJSON({ itens: [], total: 0, grupo }); }
    const cond: Prisma.Sql[] = [Prisma.sql`e.grupo_id = ${grupoId}`];
    if (q.status) cond.push(Prisma.sql`e.status = ${q.status}::status_equipamento`);
    if (q.busca) {
      const like = '%' + q.busca.replace(/[\\%_]/g, '\\$&') + '%';
      cond.push(Prisma.sql`(e.codigo ILIKE ${like} OR e.nome ILIKE ${like} OR e.modelo ILIKE ${like})`);
    }
    const where = Prisma.join(cond, ' AND ');
    // O pseudo-ativo PREDIAL aparece (predial:true, somente leitura na UI); o pseudo-ativo OUTROS nunca.
    const [[tot], itens] = await Promise.all([
      prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM equipamentos e WHERE NOT e.item_livre AND ${where}`,
      listar(where, { limit: q.limit, offset: q.offset }, true),
    ]);
    reply.header('X-Total-Count', tot?.n ?? 0);
    return toJSON({ itens, total: tot?.n ?? 0, grupo });
  });

  app.post('/grupos-ativos/:id/equipamentos', { preHandler: soAdmin }, async (req, reply) => {
    const { id: grupoId } = paramsId.parse(req.params);
    // Fase 35 (RN-72, §6.2): `setorId` é OBRIGATÓRIO e sem valor padrão; o setor da máquina nunca mais nasce "Geral".
    const b = z.object({ tag, nome, modelo: modelo.nullish(), setorId: id }).strict().parse(req.body);
    try {
      const r = await prisma.$transaction(async (tx) => {
        const grupo = await tx.grupoAtivo.findUnique({ where: { id: grupoId }, select: { codigo: true } });
        if (!grupo) return falha(404, erro('GRUPO_NAO_ENCONTRADO', 'Grupo não encontrado.'));
        if (grupo.codigo === GRUPO_RESERVADO) return falha(422, erro('GRUPO_RESERVADO', GRUPO_RESERVADO_MSG));
        const setor = await tx.setor.findUnique({ where: { id: b.setorId }, select: { nome: true, ativo: true, predial: true } });
        if (!setor) return falha(404, erro('SETOR_NAO_ENCONTRADO', 'Setor não encontrado.'));
        if (setor.predial) return falha(422, erro('SETOR_PREDIAL_SEM_EQUIPAMENTOS', 'O setor predial não possui máquinas cadastráveis.'));
        if (!setor.ativo) return falha(422, erro('SETOR_INATIVO', 'Este setor está desativado.'));
        if ((await tx.equipamento.count({ where: { codigo: { equals: b.tag, mode: 'insensitive' } } })) > 0) return falha(409, duplicada());
        const e = await tx.equipamento.create({
          data: { codigo: b.tag, nome: b.nome, modelo: b.modelo ?? null, setorId: b.setorId, setor: setor.nome, grupoId, status: 'ATIVO', predial: false },
          select: { id: true },
        });
        await auditar(tx, {
          atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'EQUIPAMENTO_CRIADO', alvoTipo: 'EQUIPAMENTO', alvoId: e.id,
          detalhe: { tag: b.tag, nome: b.nome, modelo: b.modelo ?? null, setorId: b.setorId, setorNome: setor.nome, grupo: grupo.codigo },
        });
        return e;
      });
      if (ehFalha(r)) return reply.code(r.falha[0]).send(r.falha[1]);
      req.log.info({ evento: 'equipamento_criado', equipamentoId: r.id.toString(), grupoId: grupoId.toString(), por: req.user.sub });
      return reply.code(201).send(toJSON((await listar(Prisma.sql`e.id = ${r.id}`))[0]));
    } catch (e) {
      if (ehUnico(e)) return reply.code(409).send(duplicada());
      throw e;
    }
  });

  app.put('/equipamentos/:id', { preHandler: soAdmin }, async (req, reply) => {
    const { id: eqId } = paramsId.parse(req.params);
    const b = atualizarBody.parse(req.body);
    try {
      const r = await prisma.$transaction(async (tx) => {
        const atual = await tx.equipamento.findUnique({
          where: { id: eqId },
          select: { codigo: true, nome: true, modelo: true, status: true, setorId: true, grupoId: true, predial: true, itemLivre: true, setorRef: { select: { nome: true } }, grupo: { select: { codigo: true } } },
        });
        if (!atual) return falha(404, erro('EQUIPAMENTO_NAO_ENCONTRADO', 'Equipamento não encontrado.'));
        if (atual.predial) return falha(409, erro('EQUIPAMENTO_PROTEGIDO', 'O pseudo-ativo PREDIAL é protegido e não pode ser alterado.'));
        if (atual.itemLivre) return falha(422, erro('ATIVO_RESERVADO', 'O pseudo-ativo OUTROS é reservado e não pode ser alterado.'));

        const mudaTag = b.tag !== undefined && b.tag !== atual.codigo;
        const mudaNome = b.nome !== undefined && b.nome !== atual.nome;
        const mudaModelo = b.modelo !== undefined && b.modelo !== atual.modelo;
        const mudaStatus = b.status !== undefined && b.status !== atual.status;
        const mudaSetor = b.setorId !== undefined && b.setorId !== atual.setorId;
        const mudaGrupo = b.grupoId !== undefined && b.grupoId !== atual.grupoId;

        if (mudaTag && (await tx.equipamento.count({ where: { id: { not: eqId }, codigo: { equals: b.tag!, mode: 'insensitive' } } })) > 0) {
          return falha(409, duplicada());
        }
        let destinoNome: string | null = null;
        if (mudaSetor) {
          const dest = await tx.setor.findUnique({ where: { id: b.setorId! }, select: { nome: true, ativo: true, predial: true } });
          if (!dest) return falha(404, erro('SETOR_NAO_ENCONTRADO', 'Setor não encontrado.'));
          if (dest.predial) return falha(422, erro('SETOR_PREDIAL_SEM_EQUIPAMENTOS', 'O setor predial não possui máquinas cadastráveis.'));
          if (!dest.ativo) return falha(422, erro('SETOR_INATIVO', 'Este setor está desativado.'));
          destinoNome = dest.nome;
        }
        let destinoGrupo: string | null = null;
        if (mudaGrupo) {
          const g = await tx.grupoAtivo.findUnique({ where: { id: b.grupoId! }, select: { codigo: true } });
          if (!g) return falha(404, erro('GRUPO_NAO_ENCONTRADO', 'Grupo não encontrado.'));
          if (g.codigo === GRUPO_RESERVADO) return falha(422, erro('GRUPO_RESERVADO', GRUPO_RESERVADO_MSG));
          destinoGrupo = g.codigo; // GRUPO_INVALIDO_PREDIAL é inalcançável aqui: o pseudo-ativo predial já voltou 409 EQUIPAMENTO_PROTEGIDO
        }
        if (mudaStatus && b.status === 'INATIVO') {
          const omsAbertas = await tx.ordem.count({ where: { equipamentoId: eqId, status: { notIn: ['CONCLUIDA', 'CANCELADA'] } } });
          if (omsAbertas > 0) return falha(409, erro('EQUIPAMENTO_COM_OMS_ATIVAS', 'A máquina tem OMs em andamento e não pode ser inativada.', { omsAbertas }));
        }

        if (!(mudaTag || mudaNome || mudaModelo || mudaStatus || mudaSetor || mudaGrupo)) return { mudou: false, moveu: false };
        await tx.equipamento.update({
          where: { id: eqId },
          data: {
            ...(mudaTag && { codigo: b.tag! }), ...(mudaNome && { nome: b.nome! }), ...(mudaModelo && { modelo: b.modelo ?? null }),
            ...(mudaStatus && { status: b.status! }), ...(mudaSetor && { setorId: b.setorId! }), ...(mudaGrupo && { grupoId: b.grupoId! }), // `setor` (texto): só o trigger
          },
        });
        const antes: Record<string, unknown> = {}; const depois: Record<string, unknown> = {};
        if (mudaTag) { antes.tag = atual.codigo; depois.tag = b.tag; }
        if (mudaNome) { antes.nome = atual.nome; depois.nome = b.nome; }
        if (mudaModelo) { antes.modelo = atual.modelo; depois.modelo = b.modelo ?? null; }
        if (mudaStatus) { antes.status = atual.status; depois.status = b.status; }
        if (mudaSetor) { antes.setorId = atual.setorId; antes.setorNome = atual.setorRef?.nome ?? null; depois.setorId = b.setorId; depois.setorNome = destinoNome; }
        if (mudaGrupo) { antes.grupo = atual.grupo?.codigo ?? null; depois.grupo = destinoGrupo; }
        await auditar(tx, {
          atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'EQUIPAMENTO_ATUALIZADO', alvoTipo: 'EQUIPAMENTO', alvoId: eqId,
          detalhe: { antes, depois },
        });
        return { mudou: true, moveu: mudaSetor };
      });
      if (ehFalha(r)) return reply.code(r.falha[0]).send(r.falha[1]);
      req.log.info({ evento: 'equipamento_atualizado', equipamentoId: eqId.toString(), campos: Object.keys(b), por: req.user.sub });
      const it = await item(eqId);
      // Mover reescreve o setor do histórico nas métricas (contrato D8): a UI avisa; a API sinaliza.
      return toJSON(r.moveu ? { ...it, avisos: ['HISTORICO_PASSA_A_CONTAR_NO_NOVO_SETOR'] } : it);
    } catch (e) {
      if (ehUnico(e)) return reply.code(409).send(duplicada());
      throw e;
    }
  });

  app.delete('/equipamentos/:id', { preHandler: soAdmin }, async (req, reply) => {
    const { id: eqId } = paramsId.parse(req.params);
    const historico = async () => {
      const [omsTotal, omsAbertas] = await Promise.all([
        prisma.ordem.count({ where: { equipamentoId: eqId } }),
        prisma.ordem.count({ where: { equipamentoId: eqId, status: { notIn: ['CONCLUIDA', 'CANCELADA'] } } }),
      ]);
      return reply.code(409).send(erro('EQUIPAMENTO_COM_HISTORICO', 'A máquina possui OMs e não pode ser excluída. Inative-a em vez de excluir.', { omsTotal, omsAbertas, sugestao: 'INATIVAR' }));
    };
    try {
      const r = await prisma.$transaction(async (tx) => {
        const e = await tx.equipamento.findUnique({
          where: { id: eqId },
          select: { codigo: true, nome: true, modelo: true, setorId: true, predial: true, itemLivre: true, setorRef: { select: { nome: true } } },
        });
        if (!e) return 'NAO_ENCONTRADO' as const;
        if (e.itemLivre) return 'RESERVADO' as const;
        if (e.predial) return 'PROTEGIDO' as const;
        if ((await tx.ordem.count({ where: { equipamentoId: eqId } })) > 0) return 'HISTORICO' as const;
        await tx.equipamento.delete({ where: { id: eqId } });
        await auditar(tx, {
          atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'EQUIPAMENTO_EXCLUIDO', alvoTipo: 'EQUIPAMENTO', alvoId: eqId,
          detalhe: { tag: e.codigo, nome: e.nome, modelo: e.modelo, setorId: e.setorId, setorNome: e.setorRef?.nome ?? null },
        });
        return 'OK' as const;
      });
      if (r === 'NAO_ENCONTRADO') return reply.code(404).send(erro('EQUIPAMENTO_NAO_ENCONTRADO', 'Equipamento não encontrado.'));
      if (r === 'RESERVADO') return reply.code(422).send(erro('ATIVO_RESERVADO', 'O pseudo-ativo OUTROS é reservado e não pode ser excluído.'));
      if (r === 'PROTEGIDO') return reply.code(409).send(erro('EQUIPAMENTO_PROTEGIDO', 'O pseudo-ativo PREDIAL é protegido e não pode ser excluído.'));
      if (r === 'HISTORICO') return historico();
      req.log.info({ evento: 'equipamento_excluido', equipamentoId: eqId.toString(), por: req.user.sub });
      return reply.code(204).send();
    } catch (e) {
      if (ehFk(e)) return historico(); // corrida: OM criada entre a checagem e o DELETE
      throw e;
    }
  });
};
