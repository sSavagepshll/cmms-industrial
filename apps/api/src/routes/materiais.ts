import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { toJSON } from '../serialize.js';
import { publicar } from '../events.js';
import { painelManutencao, soTecnico } from '../plugins/rbac.js';

const id = z.string().regex(/^\d{1,18}$/, 'id inválido').transform((v) => BigInt(v));
const ordemParams = z.object({ id });
const materialParams = z.object({ id, materialId: id });

// Limites derivados de NUMERIC(12,3) e NUMERIC(12,2) da V003.
const materialBody = z.object({
  codigo: z.string().trim().min(1).max(50).optional(),
  descricao: z.string().trim().min(1).max(200),
  quantidade: z.number().positive().max(999_999_999).multipleOf(0.001),
  unidade: z.string().trim().toUpperCase().min(1).max(10).default('UN'),
  custoUnitario: z.number().min(0).max(9_999_999_999).multipleOf(0.01).optional(),
  // Ficha física: INTER. (material do estoque interno) e CONF. N.F. (conferência da nota fiscal).
  flagInterno: z.boolean().default(true),
  // Referência da NF (até 50). `true` = conferida sem referência (guardada como 'CONFERIDA'); false/ausente = não conferida.
  confNf: z
    .union([z.boolean(), z.string().trim().min(1).max(50)])
    .optional()
    .transform((v) => (v === true ? 'CONFERIDA' : v === false || v === undefined ? null : v)),
}).strict();

const erro = (error: string, message: string) => ({ error, message });

const select = {
  id: true, codigo: true, descricao: true, quantidade: true, unidade: true, custoUnitario: true, flagInterno: true, confNf: true, criadoEm: true,
  registrou: { select: { id: true, nome: true } },
} as const;

type Row = { quantidade: unknown; custoUnitario: unknown };
const toDto = <T extends Row>(m: T) => ({
  ...m,
  quantidade: Number(m.quantidade),
  custoUnitario: m.custoUnitario === null ? null : Number(m.custoUnitario),
});

export const materiaisRoutes: FastifyPluginAsync = async (app) => {
  // Só edita material em OM ativa; apenas o responsável (ou ADMIN) lança/remove (RN-07).
  async function ordemEditavel(ordemId: bigint, userId: bigint, perfil: string) {
    const o = await prisma.ordem.findUnique({ where: { id: ordemId }, select: { status: true, responsavelId: true } });
    if (!o) return { status: 404, body: erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.') } as const;
    if (o.status === 'CONCLUIDA' || o.status === 'CANCELADA' || o.status === 'AGUARDANDO_APROVACAO' || o.status === 'AGUARDANDO_BAIXA') {
      return { status: 409, body: erro('OM_ENCERRADA', 'Não é possível alterar materiais de uma OM encerrada ou aguardando aprovação/conclusão.') } as const;
    }
    if (o.responsavelId !== userId && perfil !== 'ADMIN') {
      return { status: 403, body: erro('NAO_E_RESPONSAVEL', 'Apenas o técnico responsável pode apontar materiais.') } as const;
    }
    return null;
  }

  app.get('/ordens/:id/materiais', { preHandler: painelManutencao }, async (req, reply) => {
    const { id: ordemId } = ordemParams.parse(req.params);
    const existe = await prisma.ordem.findUnique({ where: { id: ordemId }, select: { id: true } });
    if (!existe) return reply.code(404).send(erro('OM_NAO_ENCONTRADA', 'Ordem não encontrada.'));

    const itens = (await prisma.omMaterialUtilizado.findMany({
      where: { ordemId }, orderBy: { criadoEm: 'asc' }, select, take: 500,
    })).map(toDto);
    const custoTotal = itens.reduce((t, m) => t + (m.custoUnitario === null ? 0 : m.quantidade * m.custoUnitario), 0);
    return toJSON({ itens, custoTotal: Math.round(custoTotal * 100) / 100 });
  });

  app.post('/ordens/:id/materiais', { preHandler: soTecnico }, async (req, reply) => {
    const { id: ordemId } = ordemParams.parse(req.params);
    const b = materialBody.parse(req.body);
    const userId = BigInt(req.user.sub);

    const bloqueio = await ordemEditavel(ordemId, userId, req.user.perfil);
    if (bloqueio) return reply.code(bloqueio.status).send(bloqueio.body);

    const criado = await prisma.omMaterialUtilizado.create({
      data: {
        ordemId, registradoPor: userId, codigo: b.codigo ?? null, descricao: b.descricao,
        quantidade: b.quantidade, unidade: b.unidade, custoUnitario: b.custoUnitario ?? null,
        flagInterno: b.flagInterno, confNf: b.confNf,
      },
      select,
    });
    publicar({ tipo: 'om.material', ordemId });
    return reply.code(201).send(toJSON(toDto(criado)));
  });

  app.delete('/ordens/:id/materiais/:materialId', { preHandler: soTecnico }, async (req, reply) => {
    const { id: ordemId, materialId } = materialParams.parse(req.params);
    const userId = BigInt(req.user.sub);

    const bloqueio = await ordemEditavel(ordemId, userId, req.user.perfil);
    if (bloqueio) return reply.code(bloqueio.status).send(bloqueio.body);

    // Escopo por ordemId evita apagar material de outra OM trocando o id na URL.
    const r = await prisma.omMaterialUtilizado.deleteMany({ where: { id: materialId, ordemId } });
    if (r.count === 0) return reply.code(404).send(erro('MATERIAL_NAO_ENCONTRADO', 'Material não encontrado nesta OM.'));
    publicar({ tipo: 'om.material', ordemId });
    return reply.code(204).send();
  });
};
