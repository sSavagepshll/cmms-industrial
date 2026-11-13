import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma, STATUS_ATIVOS } from '../db.js';
import { toJSON } from '../serialize.js';

import { GRUPOS_TOTEM, GRUPO_RESERVADO } from '../grupos.js';

const query = z.object({
  busca: z.string().trim().min(1).max(50).optional(),
  setor: z.string().trim().min(1).max(100).optional(),
  grupo: z.enum(GRUPOS_TOTEM).optional(), // Fase 30/35: macro-categoria do Totem; código antigo (MOLDES_PREDIAL, OUTROS) -> 400
  setorId: z.string().regex(/^\d{1,18}$/, 'id inválido').transform((v) => BigInt(v)).optional(), // Fase 22 (aditivo)
}).strict();

export const equipamentosRoutes: FastifyPluginAsync = async (app) => {
  // Lista equipamentos ATIVOS (RN-02), com busca por TAG/nome e contagem de OMs ativas (US-02).
  app.get('/equipamentos', async (req) => {
    const { busca, setor, setorId, grupo } = query.parse(req.query);
    // Fase 35 (§7.2): o pseudo-ativo OUTROS (item avulso) só aparece com grupo=PREDIAL_OUTROS e SEM busca; nunca em busca por TAG.
    const incluiAvulso = grupo === GRUPO_RESERVADO && busca === undefined;
    const itens = await prisma.equipamento.findMany({
      where: {
        status: 'ATIVO',
        ...(!incluiAvulso && { itemLivre: false }),
        ...(setor && { setor }),
        ...(setorId !== undefined && { setorId }),
        ...(grupo && { grupo: { codigo: grupo } }),
        ...(busca && {
          OR: [
            { codigo: { contains: busca, mode: 'insensitive' } },
            { nome: { contains: busca, mode: 'insensitive' } },
          ],
        }),
      },
      select: {
        id: true,
        codigo: true,
        nome: true,
        setor: true,
        localizacao: true,
        predial: true,
        itemLivre: true,
        grupo: { select: { codigo: true } },
        _count: { select: { ordens: { where: { status: { in: [...STATUS_ATIVOS] } } } } },
      },
      orderBy: { codigo: 'asc' },
      take: 200,
    });
    return toJSON(itens.map(({ _count, grupo: g, ...e }) => ({ ...e, grupo: g?.codigo ?? null, omsAtivas: _count.ordens })));
  });

  // Fase 30/35 (US-15, §7.2): as 4 macro-categorias do Totem, sempre todas e na ordem fixa (grupo vazio aparece: UC-15-01 1D).
  // `modo` é sempre LISTA (o texto livre agora é o card "Item avulso" dentro de PREDIAL_OUTROS). `total` conta os ATIVOS do grupo.
  app.get('/equipamentos/grupos', async () => {
    const grupos = await prisma.grupoAtivo.findMany({
      select: {
        codigo: true, nome: true, ordem: true,
        _count: { select: { equipamentos: { where: { status: 'ATIVO' } } } },
      },
      orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
    });
    return toJSON(grupos.map((g) => ({ codigo: g.codigo, nome: g.nome, ordem: g.ordem, total: g._count.equipamentos, modo: 'LISTA' })));
  });

  // Fase 31 (§5.4): locais padrão ativos do setor predial, por ordem. Substitui o bloco de locais de /equipamentos/setores.
  app.get('/equipamentos/locais', async () => {
    const locais = await prisma.setorLocal.findMany({
      where: { ativo: true, setor: { predial: true } },
      select: { id: true, nome: true },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });
    return toJSON(locais);
  });

  // Setores ATIVOS com equipamento ATIVO (grade de botões da US-02). Fase 22: lê da tabela `setores`; o predial
  // (qualquer nome) vai sempre por último e traz os locais padrão ativos (chips do Totem).
  app.get('/equipamentos/setores', async () => {
    const setores = await prisma.setor.findMany({
      where: { ativo: true, equipamentos: { some: { status: 'ATIVO' } } },
      select: {
        id: true, nome: true, predial: true, ordem: true,
        _count: { select: { equipamentos: { where: { status: 'ATIVO' } } } },
        locais: { where: { ativo: true }, select: { id: true, nome: true }, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] },
      },
    });
    setores.sort((a, b) => Number(a.predial) - Number(b.predial) || a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));
    return toJSON(setores.map((s) => ({
      id: s.id,
      setor: s.nome,
      equipamentos: s._count.equipamentos,
      predial: s.predial,
      ...(s.predial && { locais: s.locais }),
    })));
  });

  // Um equipamento ATIVO por id numérico ou TAG (ex.: PREDIAL).
  app.get('/equipamentos/:ref', async (req, reply) => {
    const { ref } = z.object({ ref: z.string().trim().min(1).max(50) }).strict().parse(req.params);
    const porId = /^\d{1,18}$/.test(ref);
    const e = await prisma.equipamento.findFirst({
      where: { status: 'ATIVO', itemLivre: false, ...(porId ? { id: BigInt(ref) } : { codigo: { equals: ref, mode: 'insensitive' } }) },
      select: {
        id: true, codigo: true, nome: true, setor: true, localizacao: true, predial: true,
        setorRef: { select: { ativo: true } },
        _count: { select: { ordens: { where: { status: { in: [...STATUS_ATIVOS] } } } } },
      },
    });
    if (!e) return reply.code(404).send({ error: 'EQUIPAMENTO_NAO_ENCONTRADO', message: 'Equipamento não encontrado.' });
    const { _count, setorRef, ...resto } = e;
    // Fase 22: a busca por TAG devolve o item mesmo com setor desativado; a abertura de OM é que recusa (422 SETOR_INATIVO).
    return toJSON({ ...resto, setorAtivo: setorRef?.ativo ?? true, omsAtivas: _count.ordens });
  });
};
