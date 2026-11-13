import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db.js';
import { toJSON } from '../serialize.js';
import { cursorSchema, recortarPagina } from '../cursor.js';
import { soAdmin } from '../plugins/rbac.js';

const DIA_MS = 86_400_000;
const query = z.object({
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
  ator: z.string().regex(/^\d{1,18}$/).transform((v) => BigInt(v)).optional(),
  acao: z.string().trim().min(1).max(50).optional(),
  alvoTipo: z.enum(['USUARIO', 'OM', 'PARAMETRO', 'SETOR', 'EQUIPAMENTO', 'GRUPO_ATIVO']).optional(),
  alvoId: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  cursor: cursorSchema.optional(), // Fase 34: keyset (X-Next-Cursor); exclui `offset` e dispensa o COUNT
});

// Trilha de auditoria (RN-25): somente leitura e somente ADMIN. O `detalhe` já é gravado sem PIN/senha/segredo.
export const auditoriaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/auditoria', { preHandler: soAdmin }, async (req, reply) => {
    const q = query.parse(req.query);
    const ate = q.ate ?? new Date();
    const de = q.de ?? new Date(ate.getTime() - 7 * DIA_MS); // padrão: últimos 7 dias
    if (de >= ate) return reply.code(400).send({ error: 'VALIDACAO', message: '"de" deve ser anterior a "ate".' });

    if (q.cursor !== undefined && q.offset > 0) {
      return reply.code(400).send({ error: 'VALIDACAO', message: 'Use "cursor" ou "offset", não os dois.' });
    }

    const where: Prisma.AuditoriaWhereInput = {
      criadoEm: { gte: de, lt: ate },
      ...(q.ator !== undefined && { atorId: q.ator }),
      ...(q.acao && { acao: q.acao }),
      ...(q.alvoTipo && { alvoTipo: q.alvoTipo }),
      ...(q.alvoId && { alvoId: q.alvoId }),
    };
    const [total, linhas] = await Promise.all([
      q.cursor === undefined ? prisma.auditoria.count({ where }) : Promise.resolve(null),
      prisma.auditoria.findMany({
        where, orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }], take: q.limit + 1,
        ...(q.cursor !== undefined ? { cursor: { id: q.cursor }, skip: 1 } : { skip: q.offset }),
        select: {
          id: true, criadoEm: true, acao: true, alvoTipo: true, alvoId: true, atorPerfil: true, detalhe: true,
          ator: { select: { id: true, nome: true, perfil: true } },
          emNomeDeUsuario: { select: { id: true, nome: true } },
        },
      }),
    ]);

    const { itens, proximo } = recortarPagina(linhas, q.limit);
    // Rótulo legível do alvo (nome do usuário / número da OM) em lote.
    const ids = (tipo: string) => [...new Set(itens.filter((i) => i.alvoTipo === tipo && /^\d+$/.test(i.alvoId)).map((i) => BigInt(i.alvoId)))];
    const [us, oms, eqs, sets, grs] = await Promise.all([
      ids('USUARIO').length ? prisma.usuario.findMany({ where: { id: { in: ids('USUARIO') } }, select: { id: true, nome: true } }) : [],
      ids('OM').length ? prisma.ordem.findMany({ where: { id: { in: ids('OM') } }, select: { id: true, numeroFormatado: true } }) : [],
      ids('EQUIPAMENTO').length ? prisma.equipamento.findMany({ where: { id: { in: ids('EQUIPAMENTO') } }, select: { id: true, codigo: true } }) : [],
      ids('SETOR').length ? prisma.setor.findMany({ where: { id: { in: ids('SETOR') } }, select: { id: true, nome: true } }) : [],
      ids('GRUPO_ATIVO').length ? prisma.grupoAtivo.findMany({ where: { id: { in: ids('GRUPO_ATIVO') } }, select: { id: true, nome: true } }) : [],
    ]);
    const nomeGrupo = new Map(grs.map((g) => [g.id.toString(), g.nome]));
    const tagEquip = new Map(eqs.map((e) => [e.id.toString(), e.codigo]));
    const nomeSetor = new Map(sets.map((s) => [s.id.toString(), s.nome]));
    // Excluído: cai para a tag/nome gravados no snapshot do detalhe.
    const doDetalhe = (d: unknown, k: string) => (d && typeof d === 'object' && typeof (d as Record<string, unknown>)[k] === 'string' ? ((d as Record<string, string>)[k] ?? null) : null);
    const nomeUsuario = new Map(us.map((u) => [u.id.toString(), u.nome]));
    const numeroOm = new Map(oms.map((o) => [o.id.toString(), o.numeroFormatado]));

    if (total !== null) reply.header('X-Total-Count', total);
    if (proximo) reply.header('X-Next-Cursor', proximo);
    return toJSON(itens.map(({ emNomeDeUsuario, atorPerfil, ator, ...i }) => ({
      ...i,
      ator: ator ?? (atorPerfil === 'SISTEMA' ? { id: null, nome: 'Sistema', perfil: 'SISTEMA' } : null),
      emNomeDe: emNomeDeUsuario,
      alvoRotulo: i.alvoTipo === 'USUARIO' ? nomeUsuario.get(i.alvoId) ?? null
        : i.alvoTipo === 'OM' ? numeroOm.get(i.alvoId) ?? null
        : i.alvoTipo === 'EQUIPAMENTO' ? tagEquip.get(i.alvoId) ?? doDetalhe(i.detalhe, 'tag') ?? i.alvoId
        : i.alvoTipo === 'GRUPO_ATIVO' ? nomeGrupo.get(i.alvoId) ?? i.alvoId
        : i.alvoTipo === 'SETOR' ? nomeSetor.get(i.alvoId) ?? doDetalhe(i.detalhe, 'nome') ?? i.alvoId
        : i.alvoId,
    })));
  });
};
