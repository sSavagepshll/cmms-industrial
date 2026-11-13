import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db.js';
import { toJSON } from '../serialize.js';
import { auditar } from '../auditoria.js';
import { ehFk, ehUnico } from '../erros-db.js';
import { painelAdmin, soAdmin } from '../plugins/rbac.js';

// Fase 22 (contrato-fase22-setores-e-dashboards.md §3): CRUD de setores e locais padrão do setor predial.
// Administração: soAdmin (revalida perfil/ativo no banco a cada chamada). Exceção: GET /setores/opcoes (GERENTE/ADMIN).

const id = z.string().regex(/^\d{1,18}$/, 'id inválido').transform((v) => BigInt(v));
const erro = (error: string, message: string, extra: object = {}) => ({ error, message, ...extra });

// Nome: trim, espaços internos colapsados, sem caracteres de controle.
const semControle = (v: string) => !/[\u0000-\u001f\u007f]/.test(v);
const texto = (min: number, max: number) =>
  z.string().transform((v) => v.replace(/\s+/g, ' ').trim()).pipe(z.string().min(min).max(max).refine(semControle, 'caracteres de controle não são permitidos'));
const nomeSetor = texto(2, 100);
const nomeLocal = texto(1, 60);
const ordem = z.number().int().min(0).max(9999);

const criarBody = z.object({ nome: nomeSetor, ordem: ordem.optional() }).strict();
// `.strict()`: enviar `predial` (ou qualquer campo desconhecido) é 400, como exige o contrato.
const atualizarBody = z.object({ nome: nomeSetor, ativo: z.boolean(), ordem }).partial().strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Informe ao menos um campo para atualizar' });
const listQuery = z.object({
  ativo: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  busca: z.string().trim().min(1).max(100).optional(),
});
const criarLocalBody = z.object({ nome: nomeLocal, ordem: ordem.optional() }).strict();
const atualizarLocalBody = z.object({ nome: nomeLocal, ativo: z.boolean(), ordem }).partial().strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Informe ao menos um campo para atualizar' });
const reordenarBody = z.object({ ids: z.array(id).min(1).max(200) }).strict();

interface LinhaSetor {
  id: bigint; nome: string; ativo: boolean; predial: boolean; ordem: number;
  equipamentos: number; equipamentos_ativos: number; oms_abertas: number; oms_total: number; locais: number;
}

/** Itens no formato do §3.2 (contagens calculadas no banco). `filtro` é um fragmento WHERE sobre `s`. */
async function listar(filtro: Prisma.Sql) {
  const linhas = await prisma.$queryRaw<LinhaSetor[]>`
    SELECT s.id, s.nome, s.ativo, s.predial, s.ordem,
           (SELECT count(*) FROM equipamentos e WHERE e.setor_id = s.id)::int AS equipamentos,
           (SELECT count(*) FROM equipamentos e WHERE e.setor_id = s.id AND e.status = 'ATIVO')::int AS equipamentos_ativos,
           (SELECT count(*) FROM ordens_manutencao o JOIN equipamentos e ON e.id = o.equipamento_id
             WHERE e.setor_id = s.id
               AND o.status IN ('ABERTA','RESERVADA','EM_ANDAMENTO','PAUSADA','AGUARDANDO_PECA','AGUARDANDO_APROVACAO','AGUARDANDO_BAIXA'))::int AS oms_abertas,
           (SELECT count(*) FROM ordens_manutencao o JOIN equipamentos e ON e.id = o.equipamento_id WHERE e.setor_id = s.id)::int AS oms_total,
           (SELECT count(*) FROM setor_locais l WHERE l.setor_id = s.id)::int AS locais
      FROM setores s
     WHERE ${filtro}
     ORDER BY s.predial ASC, s.ordem ASC, s.nome ASC`;
  return linhas.map((l) => {
    const podeExcluir = !l.predial && l.equipamentos === 0;
    return {
      id: l.id, nome: l.nome, ativo: l.ativo, predial: l.predial, ordem: l.ordem,
      equipamentos: l.equipamentos, equipamentosAtivos: l.equipamentos_ativos,
      omsAbertas: l.oms_abertas, omsTotal: l.oms_total,
      podeExcluir,
      motivoNaoExclui: podeExcluir ? null : l.predial ? 'SETOR_PROTEGIDO' : 'SETOR_COM_VINCULOS',
      ...(l.predial && { locais: l.locais }),
    };
  });
}
const item = async (setorId: bigint) => (await listar(Prisma.sql`s.id = ${setorId}`))[0]!;

const localSelect = { id: true, nome: true, ativo: true, ordem: true } as const;

export const setoresRoutes: FastifyPluginAsync = async (app) => {
  // ---------- Setores ----------
  app.get('/setores', { preHandler: soAdmin }, async (req, reply) => {
    const q = listQuery.parse(req.query);
    const cond: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (q.ativo !== undefined) cond.push(Prisma.sql`s.ativo = ${q.ativo}`);
    if (q.busca) cond.push(Prisma.sql`s.nome ILIKE ${'%' + q.busca.replace(/[\\%_]/g, '\\$&') + '%'}`);
    const itens = await listar(Prisma.join(cond, ' AND '));
    reply.header('X-Total-Count', itens.length);
    return toJSON(itens);
  });

  // Lista leve para filtros/telas de gestão, INCLUINDO inativos (análise histórica).
  app.get('/setores/opcoes', { preHandler: painelAdmin }, async (req) => {
    // Fase 37 (RN-88): ?uso=equipamento devolve só o catálogo oficial (oficial AND ativo), na ordem da US. Sem o parâmetro: contrato antigo.
    const { uso } = z.object({ uso: z.literal('equipamento').optional() }).parse(req.query);
    const setores = await prisma.setor.findMany({
      ...(uso === 'equipamento' && { where: { oficial: true, ativo: true } }),
      select: { id: true, nome: true, ativo: true, predial: true, oficial: true },
      orderBy: [{ predial: 'asc' }, { ordem: 'asc' }, { nome: 'asc' }],
    });
    return toJSON(setores);
  });

  // Fase 37 (RN-88, O4): catálogo fechado de 10 setores oficiais (V028). Um setor novo nunca seria selecionável.
  app.post('/setores', { preHandler: soAdmin }, async (req, reply) => {
    criarBody.parse(req.body);
    return reply.code(422).send(erro('SETOR_CATALOGO_FECHADO', 'O catálogo de setores é fechado. Use um dos setores oficiais.'));
  });

  app.put('/setores/:id', { preHandler: soAdmin }, async (req, reply) => {
    const { id: setorId } = z.object({ id }).parse(req.params);
    const b = atualizarBody.parse(req.body);
    try {
      const r = await prisma.$transaction(async (tx) => {
        const atual = await tx.setor.findUnique({ where: { id: setorId }, select: { nome: true, ativo: true, ordem: true, predial: true } });
        if (!atual) return null;
        const mudaNome = b.nome !== undefined && b.nome !== atual.nome;
        const mudaAtivo = b.ativo !== undefined && b.ativo !== atual.ativo;
        const mudaOrdem = b.ordem !== undefined && b.ordem !== atual.ordem;
        if (mudaNome || mudaAtivo || mudaOrdem) {
          await tx.setor.update({
            where: { id: setorId },
            data: { ...(mudaNome && { nome: b.nome! }), ...(mudaAtivo && { ativo: b.ativo! }), ...(mudaOrdem && { ordem: b.ordem! }) },
          });
          const base = { atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, alvoTipo: 'SETOR', alvoId: setorId } as const;
          if (mudaNome || mudaOrdem) {
            await auditar(tx, {
              ...base, acao: 'SETOR_ATUALIZADO',
              detalhe: { ...(mudaNome && { de: atual.nome, para: b.nome }), ...(mudaOrdem && { ordemDe: atual.ordem, ordemPara: b.ordem }) },
            });
          }
          if (mudaAtivo) await auditar(tx, { ...base, acao: b.ativo ? 'SETOR_ATIVADO' : 'SETOR_DESATIVADO', detalhe: { nome: b.nome ?? atual.nome } });
        }
        return { predial: atual.predial };
      });
      if (!r) return reply.code(404).send(erro('SETOR_NAO_ENCONTRADO', 'Setor não encontrado.'));
      const it = await item(setorId);
      req.log.info({ evento: 'setor_atualizado', setorId: setorId.toString(), campos: Object.keys(b), por: req.user.sub });
      return toJSON(r.predial && !it.ativo ? { ...it, avisos: ['PREDIAL_INDISPONIVEL_NO_TOTEM'] } : it);
    } catch (e) {
      if (ehUnico(e)) return reply.code(409).send(erro('SETOR_DUPLICADO', 'Já existe um setor com este nome.'));
      throw e;
    }
  });

  app.delete('/setores/:id', { preHandler: soAdmin }, async (req, reply) => {
    const { id: setorId } = z.object({ id }).parse(req.params);
    const vinculos = async () => {
      const [equipamentos, [oms]] = await Promise.all([
        prisma.equipamento.count({ where: { setorId } }),
        prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM ordens_manutencao o JOIN equipamentos e ON e.id = o.equipamento_id WHERE e.setor_id = ${setorId}`,
      ]);
      return { equipamentos, omsTotal: oms?.n ?? 0 };
    };
    const comVinculos = async () =>
      reply.code(409).send(erro('SETOR_COM_VINCULOS', 'O setor possui equipamentos vinculados. Desative-o em vez de excluir.', { ...(await vinculos()), sugestao: 'DESATIVAR' }));
    try {
      const resultado = await prisma.$transaction(async (tx) => {
        const s = await tx.setor.findUnique({ where: { id: setorId }, select: { nome: true, predial: true } });
        if (!s) return 'NAO_ENCONTRADO' as const;
        if (s.predial) return 'PROTEGIDO' as const;
        if ((await tx.equipamento.count({ where: { setorId } })) > 0) return 'VINCULOS' as const;
        await tx.setor.delete({ where: { id: setorId } });
        await auditar(tx, { atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'SETOR_EXCLUIDO', alvoTipo: 'SETOR', alvoId: setorId, detalhe: { nome: s.nome } });
        return 'OK' as const;
      });
      if (resultado === 'NAO_ENCONTRADO') return reply.code(404).send(erro('SETOR_NAO_ENCONTRADO', 'Setor não encontrado.'));
      if (resultado === 'PROTEGIDO') return reply.code(409).send(erro('SETOR_PROTEGIDO', 'O setor predial (Outros) não pode ser excluído. Desative-o, se necessário.'));
      if (resultado === 'VINCULOS') return comVinculos();
      req.log.info({ evento: 'setor_excluido', setorId: setorId.toString(), por: req.user.sub });
      return reply.code(204).send();
    } catch (e) {
      if (ehFk(e)) return comVinculos(); // corrida: equipamento incluído entre a checagem e o DELETE
      throw e;
    }
  });

  // ---------- Locais padrão (somente setor predial) ----------
  /** 404 se o setor não existe; 422 se não for o predial. Devolve true quando a resposta já foi enviada. */
  async function setorComLocais(setorId: bigint, reply: import('fastify').FastifyReply): Promise<boolean> {
    const s = await prisma.setor.findUnique({ where: { id: setorId }, select: { predial: true } });
    if (!s) { await reply.code(404).send(erro('SETOR_NAO_ENCONTRADO', 'Setor não encontrado.')); return true; }
    if (!s.predial) { await reply.code(422).send(erro('SETOR_SEM_LOCAIS', 'Apenas o setor predial possui locais padrão.')); return true; }
    return false;
  }
  const params = z.object({ id });
  const paramsLocal = z.object({ id, localId: id });

  app.get('/setores/:id/locais', { preHandler: soAdmin }, async (req, reply) => {
    const { id: setorId } = params.parse(req.params);
    if (await setorComLocais(setorId, reply)) return;
    return toJSON(await prisma.setorLocal.findMany({ where: { setorId }, select: localSelect, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] }));
  });

  app.post('/setores/:id/locais', { preHandler: soAdmin }, async (req, reply) => {
    const { id: setorId } = params.parse(req.params);
    const b = criarLocalBody.parse(req.body);
    if (await setorComLocais(setorId, reply)) return;
    try {
      const criado = await prisma.$transaction(async (tx) => {
        const ord = b.ordem ?? ((await tx.setorLocal.aggregate({ where: { setorId }, _max: { ordem: true } }))._max.ordem ?? 0) + 1;
        const l = await tx.setorLocal.create({ data: { setorId, nome: b.nome, ordem: ord }, select: localSelect });
        await auditar(tx, { atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'SETOR_LOCAL_CRIADO', alvoTipo: 'SETOR', alvoId: setorId, detalhe: { localId: l.id, nome: b.nome } });
        return l;
      });
      return reply.code(201).send(toJSON(criado));
    } catch (e) {
      if (ehUnico(e)) return reply.code(409).send(erro('LOCAL_DUPLICADO', 'Já existe um local com este nome.'));
      throw e;
    }
  });

  // Rota estática: tem precedência sobre /setores/:id/locais/:localId.
  app.put('/setores/:id/locais/ordem', { preHandler: soAdmin }, async (req, reply) => {
    const { id: setorId } = params.parse(req.params);
    const { ids } = reordenarBody.parse(req.body);
    if (await setorComLocais(setorId, reply)) return;
    const existentes = (await prisma.setorLocal.findMany({ where: { setorId }, select: { id: true } })).map((l) => l.id.toString());
    const enviados = ids.map((x) => x.toString());
    const igual = new Set(enviados).size === enviados.length && enviados.length === existentes.length && existentes.every((x) => enviados.includes(x));
    if (!igual) {
      return reply.code(400).send(erro('VALIDACAO', 'Dados inválidos.', { detalhes: [{ campo: 'ids', mensagem: 'Envie todos os locais do setor, sem repetição.' }] }));
    }
    await prisma.$transaction(async (tx) => {
      for (const [i, localId] of ids.entries()) await tx.setorLocal.update({ where: { id: localId }, data: { ordem: i + 1 } });
      await auditar(tx, { atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'SETOR_LOCAIS_REORDENADOS', alvoTipo: 'SETOR', alvoId: setorId, detalhe: { ids: enviados } });
    });
    return reply.code(204).send();
  });

  app.put('/setores/:id/locais/:localId', { preHandler: soAdmin }, async (req, reply) => {
    const { id: setorId, localId } = paramsLocal.parse(req.params);
    const b = atualizarLocalBody.parse(req.body);
    if (await setorComLocais(setorId, reply)) return;
    try {
      const upd = await prisma.$transaction(async (tx) => {
        const atual = await tx.setorLocal.findFirst({ where: { id: localId, setorId }, select: localSelect });
        if (!atual) return null;
        const l = await tx.setorLocal.update({ where: { id: localId }, data: b, select: localSelect });
        const renomeou = b.nome !== undefined && b.nome !== atual.nome;
        await auditar(tx, {
          atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'SETOR_LOCAL_ATUALIZADO', alvoTipo: 'SETOR', alvoId: setorId,
          detalhe: {
            localId,
            ...(renomeou && { de: atual.nome, para: b.nome }),
            ...(b.ativo !== undefined && b.ativo !== atual.ativo && { ativo: b.ativo }),
            ...(b.ordem !== undefined && b.ordem !== atual.ordem && { ordemDe: atual.ordem, ordemPara: b.ordem }),
          },
        });
        return l;
      });
      if (!upd) return reply.code(404).send(erro('LOCAL_NAO_ENCONTRADO', 'Local não encontrado.'));
      return toJSON(upd);
    } catch (e) {
      if (ehUnico(e)) return reply.code(409).send(erro('LOCAL_DUPLICADO', 'Já existe um local com este nome.'));
      throw e;
    }
  });

  app.delete('/setores/:id/locais/:localId', { preHandler: soAdmin }, async (req, reply) => {
    const { id: setorId, localId } = paramsLocal.parse(req.params);
    if (await setorComLocais(setorId, reply)) return;
    const ok = await prisma.$transaction(async (tx) => {
      const l = await tx.setorLocal.findFirst({ where: { id: localId, setorId }, select: { nome: true } });
      if (!l) return false;
      await tx.setorLocal.delete({ where: { id: localId } }); // exclusão física: a OM guarda só o texto do local
      await auditar(tx, { atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'SETOR_LOCAL_EXCLUIDO', alvoTipo: 'SETOR', alvoId: setorId, detalhe: { localId, nome: l.nome } });
      return true;
    });
    if (!ok) return reply.code(404).send(erro('LOCAL_NAO_ENCONTRADO', 'Local não encontrado.'));
    return reply.code(204).send();
  });
};
