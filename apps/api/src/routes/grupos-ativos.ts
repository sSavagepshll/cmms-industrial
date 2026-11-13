import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { toJSON } from '../serialize.js';
import { auditar } from '../auditoria.js';
import { ehUnico } from '../erros-db.js';
import { soAdmin } from '../plugins/rbac.js';
import { GRUPO_RESERVADO } from '../grupos.js';

// Fase 30 / US-15 (contrato §4.4): administração das 4 macro-categorias do Totem. Conjunto FIXO: sem POST/DELETE;
// só `nome` e `ordem` são editáveis (o `codigo` é imutável, também por trigger no banco). Somente ADMIN.

const id = z.string().regex(/^\d{1,18}$/, 'id inválido').transform((v) => BigInt(v));
const paramsId = z.object({ id }).strict();
const erro = (error: string, message: string, extra: object = {}) => ({ error, message, ...extra });
const nome = z.string().transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2).max(60).refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'caracteres de controle não são permitidos'));
const atualizarBody = z.object({ nome, ordem: z.number().int().min(0).max(9999) }).partial().strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Informe ao menos um campo para atualizar' });

async function item(grupoId: bigint) {
  const g = await prisma.grupoAtivo.findUniqueOrThrow({
    where: { id: grupoId },
    select: { id: true, codigo: true, nome: true, ordem: true },
  });
  // Fase 35: contagens EXCLUEM os pseudo-ativos (PREDIAL e OUTROS); PREDIAL_OUTROS é reservado (RN-50) e o modo é sempre LISTA.
  const [total, ativos, inativos] = await Promise.all([
    prisma.equipamento.count({ where: { grupoId, predial: false, itemLivre: false } }),
    prisma.equipamento.count({ where: { grupoId, predial: false, itemLivre: false, status: 'ATIVO' } }),
    prisma.equipamento.count({ where: { grupoId, predial: false, itemLivre: false, status: 'INATIVO' } }),
  ]);
  return {
    id: g.id, codigo: g.codigo, nome: g.nome, ordem: g.ordem,
    modo: 'LISTA', reservado: g.codigo === GRUPO_RESERVADO,
    equipamentos: total, equipamentosAtivos: ativos, equipamentosInativos: inativos,
  };
}

export const gruposAtivosRoutes: FastifyPluginAsync = async (app) => {
  // Os 4 grupos com contagens totais (inclui inativos e setores inativos), ao contrário de GET /equipamentos/grupos (Totem).
  app.get('/grupos-ativos', { preHandler: soAdmin }, async () => {
    const ids = (await prisma.grupoAtivo.findMany({ select: { id: true }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] })).map((g) => g.id);
    return toJSON(await Promise.all(ids.map(item)));
  });

  app.put('/grupos-ativos/:id', { preHandler: soAdmin }, async (req, reply) => {
    const { id: grupoId } = paramsId.parse(req.params);
    const b = atualizarBody.parse(req.body);
    try {
      const ok = await prisma.$transaction(async (tx) => {
        const atual = await tx.grupoAtivo.findUnique({ where: { id: grupoId }, select: { codigo: true, nome: true, ordem: true } });
        if (!atual) return false;
        const mudaNome = b.nome !== undefined && b.nome !== atual.nome;
        const mudaOrdem = b.ordem !== undefined && b.ordem !== atual.ordem;
        if (mudaNome || mudaOrdem) {
          await tx.grupoAtivo.update({ where: { id: grupoId }, data: { ...(mudaNome && { nome: b.nome! }), ...(mudaOrdem && { ordem: b.ordem! }) } });
          await auditar(tx, {
            atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'GRUPO_ATUALIZADO', alvoTipo: 'GRUPO_ATIVO', alvoId: grupoId,
            detalhe: {
              codigo: atual.codigo,
              ...(mudaNome && { de: atual.nome, para: b.nome }),
              ...(mudaOrdem && { ordemDe: atual.ordem, ordemPara: b.ordem }),
            },
          });
        }
        return true;
      });
      if (!ok) return reply.code(404).send(erro('GRUPO_NAO_ENCONTRADO', 'Grupo não encontrado.'));
      req.log.info({ evento: 'grupo_atualizado', grupoId: grupoId.toString(), campos: Object.keys(b), por: req.user.sub });
      return toJSON(await item(grupoId));
    } catch (e) {
      if (ehUnico(e)) return reply.code(409).send(erro('GRUPO_NOME_DUPLICADO', 'Já existe um grupo com este nome.', { campo: 'nome' }));
      throw e;
    }
  });
};
