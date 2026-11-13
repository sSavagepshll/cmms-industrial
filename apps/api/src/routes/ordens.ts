import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { comUsuario, prisma, STATUS_ATIVOS } from '../db.js';
import { toJSON } from '../serialize.js';
import { cursorSchema, recortarPagina } from '../cursor.js';
import { publicar } from '../events.js';
import { notificarOmAberta } from '../mail/notificacoes.js';
import { painelManutencao } from '../plugins/rbac.js';
import { montarFichaSnapshot } from '../ficha/snapshot.js';
import { renderFichaPdf } from '../ficha/pdf.js';
import { config } from '../config.js';
import { setorExibicao } from '../setorExibicao.js';
import { lerPoliticas } from '../regras.js';
import { derivarTipoAtivo, tipoAtivoRotulo } from '../tipoAtivo.js';

const id = z.string().regex(/^\d{1,18}$/, 'id inválido').transform((v) => BigInt(v));

const CATEGORIAS = ['MECANICO', 'ELETRICO', 'PNEUMATICO_HIDRAULICO', 'INSTRUMENTACAO', 'SEGURANCA', 'CIVIL_PREDIAL', 'OUTROS'] as const;

// Fase 20: local em texto livre (equipamento predial). Colapsa espaços; a comparação de duplicidade é case-insensitive.
const SEM_CONTROLE = /^[^\u0000-\u001f\u007f]*$/;
const localDescricaoSchema = z.string().transform((v) => v.replace(/\s+/g, ' ').trim())
  .refine((v) => SEM_CONTROLE.test(v), 'não pode conter caracteres de controle');

// sintomas é TEXT no banco: gravados separados por '; ' (por isso o ';' é proibido dentro de um sintoma).
export const SEP_SINTOMAS = '; ';
const sintoma = z.string().trim().min(1).max(80).refine((v) => !v.includes(';'), "não pode conter ';'");

// Aceita `tipoCusto` como sinônimo de `custoTipo` (nome da coluna no banco).
const abrirOmBody = z.preprocess(
  (v) => {
    if (v && typeof v === 'object' && 'tipoCusto' in v) {
      const { tipoCusto, ...rest } = v as Record<string, unknown>;
      return { ...rest, custoTipo: 'custoTipo' in rest ? rest.custoTipo : tipoCusto };
    }
    return v;
  },
  z.object({
  equipamentoId: id,
  maquinaParada: z.boolean(), // US-03: define severidade (RN-03)
  categoria: z.enum(CATEGORIAS),
  sintomas: z.array(sintoma).min(1).max(10),
  // Identificador do totem/posto (RN-01). Omitido = aberta fora de totem (NULL).
  totemIdOrigem: z.string().trim().min(1).max(50).optional(),
  // V005 (ficha física): obrigatórios para novas OMs (o banco é anulável por causa das OMs antigas).
  // Fase 30 (US-15): opcional. Omitido, o servidor deriva do grupo/equipamento (derivarTipoAtivo); o Totem não pergunta mais.
  tipoAtivo: z.enum(['MOLDE', 'MAQUINA', 'ROBO', 'OUTRO']).optional(),
  // B-19-05: texto da 3ª opção da ficha. Obrigatório se OUTRO; ignorado (NULL) nos demais (ver superRefine).
  tipoAtivoOutro: z.string().transform((v) => v.replace(/\s+/g, ' ').trim())
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'não pode conter caracteres de controle').optional(),
  // Fase 31 (RN-52): custo NÃO se define na abertura; aceitos só por compatibilidade e DESCARTADOS (persiste NULL). O custo vai em /encerrar.
  custoTipo: z.enum(['INTERNO', 'CLIENTE']).optional(),
  centroCusto: z.string().trim().min(1).max(50).optional(),
  // Fase 31: texto do item do pseudo-ativo OUTROS (obrigatório 3..100 nele, checado na rota); descartado nos demais.
  itemDescricao: localDescricaoSchema.optional(),
  observacao: z.string().trim().max(250).optional(),
  // Fase 20: obrigatório se o equipamento for predial (checado na rota); ignorado/NULL caso contrário.
  localDescricao: localDescricaoSchema.optional(),
  confirmarDuplicidade: z.boolean().default(false), // US-02 cenário 2 / RN-04
}).strict().superRefine((b, ctx) => {
  if (b.tipoAtivo !== 'OUTRO') return;
  if (!b.tipoAtivoOutro) ctx.addIssue({ code: 'custom', path: ['tipoAtivoOutro'], message: 'Informe o tipo de ativo.' });
  else if (b.tipoAtivoOutro.length > 30) ctx.addIssue({ code: 'custom', path: ['tipoAtivoOutro'], message: 'Máximo de 30 caracteres.' });
}));

const listQuery = z.object({
  status: z.enum(['ABERTA', 'RESERVADA', 'EM_ANDAMENTO', 'PAUSADA', 'AGUARDANDO_PECA', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_BAIXA', 'CONCLUIDA', 'CANCELADA']).optional(),
  equipamentoId: id.optional(),
  localDescricao: localDescricaoSchema.optional(), // equipamento predial: filtra pelo local normalizado
  itemDescricao: localDescricaoSchema.optional(), // Fase 31: pseudo-ativo OUTROS, mesma normalização
  // Todos os filtros são opcionais (tela de Gestão de OMs). Sem nenhum, lista as mais recentes.
  setor: z.string().trim().min(1).max(100).optional(),
  prioridade: z.enum(['BAIXA', 'MEDIA', 'ALTA', 'CRITICA']).optional(),
  busca: z.string().trim().min(1).max(100).optional(), // nº da OM, título, TAG ou nome do equipamento
  de: z.coerce.date().optional(), // data_abertura >= de
  ate: z.coerce.date().optional(), // data_abertura < ate
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  cursor: cursorSchema.optional(), // Fase 34: paginação por cursor (X-Next-Cursor); exclui `offset` e dispensa a contagem total
});

export const ordemSelect = {
  id: true,
  numeroFormatado: true,
  titulo: true,
  descricao: true,
  categoria: true,
  sintomas: true,
  totemIdOrigem: true,
  tipo: true,
  prioridade: true,
  status: true,
  tipoAtivo: true,
  tipoAtivoOutro: true,
  custoTipo: true,
  centroCusto: true,
  localDescricao: true,
  itemDescricao: true,
  motivoReprovacao: true, // preenchido quando o supervisor reprova; limpo ao concluir de novo
  dataAbertura: true,
  dataAprovacao: true,
  concluidoEm: true,
  aprovador: { select: { id: true, nome: true } },
  concluidor: { select: { id: true, nome: true } },
  equipamento: { select: { id: true, codigo: true, nome: true, setor: true, localizacao: true, predial: true, itemLivre: true } },
  solicitante: { select: { id: true, nome: true } },
} as const;

// Expõe `sintomas` como array e `numero` (OM-AAAA-NNNNNN, gerado pelo trigger do banco).
export const toDto = <T extends {
  numeroFormatado: string; sintomas: string | null; tipoAtivo?: string | null; tipoAtivoOutro?: string | null;
  aprovador?: object | null; concluidor?: object | null;
  equipamento?: { setor: string; predial?: boolean | null; itemLivre?: boolean | null } | null; localDescricao?: string | null;
}>({ numeroFormatado, sintomas, aprovador, concluidor, ...o }: T) => ({
  ...o,
  // Fase 35 (§6.2): setor SEMPRE derivado do equipamento (predial mostra o local; item avulso tem rótulo próprio).
  ...(o.equipamento && { setorExibicao: setorExibicao({ equipamento: o.equipamento, localDescricao: o.localDescricao ?? null }) }),
  aprovadoPor: aprovador ?? null, // Fase 21: quem aprovou / quem concluiu (null = legado ou ainda não ocorreu)
  concluidoPor: concluidor ?? null,
  tipoAtivoRotulo: tipoAtivoRotulo(o.tipoAtivo, o.tipoAtivoOutro),
  numero: numeroFormatado,
  sintomas: sintomas ? sintomas.split(SEP_SINTOMAS) : [],
});

export const ordensRoutes: FastifyPluginAsync = async (app) => {
  app.post('/ordens', async (req, reply) => {
    const body = abrirOmBody.parse(req.body);
    // RN-01: o solicitante vem SEMPRE do token (um solicitanteId no corpo é descartado pelo schema).
    const solicitanteId = BigInt(req.user.sub);

    const [solicitante, equipamento] = await Promise.all([
      prisma.usuario.findUnique({ where: { id: solicitanteId }, select: { id: true, ativo: true, perfil: true } }),
      prisma.equipamento.findUnique({ where: { id: body.equipamentoId }, select: { id: true, status: true, predial: true, itemLivre: true, grupo: { select: { codigo: true } } } }),
    ]);
    if (!solicitante?.ativo) {
      return reply.code(422).send({ error: 'SOLICITANTE_INVALIDO', message: 'Solicitante inexistente ou inativo.' });
    }
    // RN-28: TECNICO não abre OM (autorização no servidor, RN-20).
    if (solicitante.perfil === 'TECNICO') {
      return reply.code(403).send({ error: 'ACESSO_NEGADO', message: 'Técnicos não abrem OM. Peça ao operador ou ao líder de produção.' });
    }
    if (!equipamento) {
      return reply.code(404).send({ error: 'EQUIPAMENTO_NAO_ENCONTRADO', message: 'Equipamento não encontrado.' });
    }
    if (equipamento.status !== 'ATIVO') {
      return reply.code(422).send({ error: 'EQUIPAMENTO_INATIVO', message: 'Equipamento não está ativo no cadastro.' });
    }
    // Fase 31 (B4): setor deixou de ser critério de bloqueio (SETOR_INATIVO não é mais emitido); só o status da máquina vale.

    // Fase 20: equipamento predial exige o local; nos demais o valor enviado é descartado (NULL).
    const predial = equipamento.predial;
    const local = predial ? body.localDescricao : null;
    // Fase 31: pseudo-ativo OUTROS exige o texto do item (3..100); nos demais equipamentos o valor enviado é descartado.
    const itemLivre = equipamento.itemLivre;
    const item = itemLivre ? body.itemDescricao : null;
    if (itemLivre && (!item || item.length < 3 || item.length > 100)) {
      return reply.code(400).send({
        error: 'VALIDACAO', message: 'Dados inválidos.',
        detalhes: [{ campo: 'itemDescricao', mensagem: 'Informe o que está com defeito (3 a 100 caracteres).' }],
      });
    }
    if (predial && (!local || local.length > 100)) {
      return reply.code(400).send({
        error: 'VALIDACAO', message: 'Dados inválidos.',
        detalhes: [{ campo: 'localDescricao', mensagem: local ? 'Máximo de 100 caracteres.' : 'Informe o local do problema.' }],
      });
    }

    // RN-04: advertência de duplicidade (o cliente confirma com confirmarDuplicidade=true).
    // Predial: duplicada só se o mesmo local (lower + espaços colapsados) já tem OM aberta.
    if (!body.confirmarDuplicidade) {
      const idsMesmoLocal = predial
        ? (await prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM ordens_manutencao
            WHERE equipamento_id = ${body.equipamentoId} AND local_descricao IS NOT NULL
              AND lower(btrim(regexp_replace(local_descricao, '\\s+', ' ', 'g'))) = ${local!.toLowerCase()}`).map((r) => r.id)
        : null;
      const idsMesmoItem = itemLivre
        ? (await prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM ordens_manutencao
            WHERE equipamento_id = ${body.equipamentoId} AND item_descricao IS NOT NULL
              AND lower(btrim(regexp_replace(item_descricao, '\\s+', ' ', 'g'))) = ${item!.toLowerCase()}`).map((r) => r.id)
        : null;
      const idsFiltro = idsMesmoLocal ?? idsMesmoItem;
      const abertas = await prisma.ordem.findMany({
        where: { equipamentoId: body.equipamentoId, status: { in: [...STATUS_ATIVOS] }, ...(idsFiltro && { id: { in: idsFiltro } }) },
        select: ordemSelect,
        orderBy: { dataAbertura: 'desc' },
      });
      if (abertas.length > 0) {
        return reply.code(409).send({
          error: 'OM_DUPLICADA',
          message: 'Já existe OM em aberto para este equipamento.',
          ordensAbertas: toJSON(abertas.map(toDto)),
        });
      }
    }

    // Fase 30: tipoAtivo explícito (legado/integrações) é respeitado; omitido, deriva do grupo do equipamento (contrato §3.3).
    const tipoAtivoFinal = body.tipoAtivo
      ? { tipoAtivo: body.tipoAtivo, tipoAtivoOutro: body.tipoAtivo === 'OUTRO' ? body.tipoAtivoOutro ?? null : null }
      : derivarTipoAtivo({ predial }, equipamento.grupo?.codigo);

    const polCriacao = await lerPoliticas();
    const sintomas = body.sintomas.join(SEP_SINTOMAS);
    const titulo = `${itemLivre ? `${item} — ` : ''}${body.categoria.replaceAll('_', '/')}: ${sintomas}`.slice(0, 200);
    const descricao = [
      `Impacto: ${predial
        ? (body.maquinaParada ? 'ÁREA/INSTALAÇÃO INTERDITADA OU COM RISCO' : 'FALHA / REPARO NÃO URGENTE')
        : (body.maquinaParada ? 'MÁQUINA TOTALMENTE PARADA' : 'MÁQUINA OPERANDO COM FALHA / AJUSTE')}`,
      predial ? `Local: ${local}` : null,
      itemLivre ? `Item: ${item}` : null,
      `Categoria: ${body.categoria}`,
      `Sintomas: ${sintomas}`,
      body.observacao ? `Observação: ${body.observacao}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const ordem = await comUsuario(solicitanteId, async (tx) => {
      const criada = await tx.ordem.create({
      data: {
        equipamentoId: body.equipamentoId,
        solicitanteId,
        totemIdOrigem: body.totemIdOrigem ?? null,
        tipoAtivo: tipoAtivoFinal.tipoAtivo,
        tipoAtivoOutro: tipoAtivoFinal.tipoAtivoOutro,
        custoTipo: null, // Fase 31 (RN-52): definido só no encerramento
        centroCusto: null,
        localDescricao: local,
        itemDescricao: item,
        categoria: body.categoria,
        sintomas,
        tipo: 'CORRETIVA',
        prioridade: body.maquinaParada ? 'CRITICA' : 'MEDIA', // RN-03
        status: 'ABERTA',
        titulo,
        descricao,
      },
      select: ordemSelect,
      });
      // RN-22: urgente (máquina parada) nasce com o prazo do fallback; passado o prazo sem responsável, qualquer técnico pode puxar.
      if (body.maquinaParada) {
        await tx.$executeRaw`UPDATE ordens_manutencao SET prazo_atendimento = now() + make_interval(mins => ${polCriacao.fallbackUrgenteMin}::int) WHERE id = ${criada.id}`;
      }
      // E1 (Fase 35): e-mail de abertura + snapshot da ficha entram no outbox NA MESMA transação (rollback da OM = nenhum e-mail).
      await notificarOmAberta(tx, criada.id, req.log);
      return criada;
    });
    req.log.info({ ordemId: ordem.id.toString() }, 'OM aberta');
    publicar({ tipo: 'om.criada', ordemId: ordem.id, numero: ordem.numeroFormatado, statusKanban: 'ABERTO' }); // RN-06
    return reply.code(201).send(toJSON(toDto(ordem)));
  });

  // Paginação opcional: offset (X-Total-Count) ou cursor (X-Next-Cursor, sem COUNT — escala em histórico grande). O corpo segue sendo um array.
  app.get('/ordens', async (req, reply) => {
    const q = listQuery.parse(req.query);
    // Listagem geral só para a equipe de manutenção/gestão. OPERADOR/LIDER_PRODUCAO (totem) precisam informar o equipamento.
    if ((req.user.perfil === 'OPERADOR' || req.user.perfil === 'LIDER_PRODUCAO') && !q.equipamentoId) {
      return reply.code(403).send({
        error: 'FILTRO_OBRIGATORIO',
        message: 'Seu perfil só pode consultar OMs de um equipamento (informe equipamentoId).',
      });
    }
    if (q.de && q.ate && q.de >= q.ate) {
      return reply.code(400).send({ error: 'VALIDACAO', message: '"de" deve ser anterior a "ate".' });
    }
    if (q.cursor !== undefined && q.offset > 0) {
      return reply.code(400).send({ error: 'VALIDACAO', message: 'Use "cursor" ou "offset", não os dois.' });
    }
    const where = {
      ...(q.status && { status: q.status }),
      ...(q.equipamentoId && { equipamentoId: q.equipamentoId }),
      ...(q.localDescricao && { localDescricao: { equals: q.localDescricao, mode: 'insensitive' as const } }),
      ...(q.itemDescricao && { itemDescricao: { equals: q.itemDescricao, mode: 'insensitive' as const } }),
      ...(q.prioridade && { prioridade: q.prioridade }),
      ...(q.setor && { equipamento: { setor: q.setor } }),
      ...((q.de || q.ate) && { dataAbertura: { ...(q.de && { gte: q.de }), ...(q.ate && { lt: q.ate }) } }),
      ...(q.busca && {
        OR: [
          { numeroFormatado: { contains: q.busca, mode: 'insensitive' as const } },
          { titulo: { contains: q.busca, mode: 'insensitive' as const } },
          { localDescricao: { contains: q.busca, mode: 'insensitive' as const } },
          { equipamento: { codigo: { contains: q.busca, mode: 'insensitive' as const } } },
          { equipamento: { nome: { contains: q.busca, mode: 'insensitive' as const } } },
        ],
      }),
    };
    const [total, linhas] = await Promise.all([
      q.cursor === undefined ? prisma.ordem.count({ where }) : Promise.resolve(null),
      prisma.ordem.findMany({
        where,
        select: {
          ...ordemSelect,
          responsavel: { select: { id: true, nome: true } },
          delegador: { select: { id: true, nome: true } },
          delegadoEm: true,
          motivoRecusa: true,
        },
        orderBy: [{ dataAbertura: 'desc' }, { id: 'desc' }], // id desempata: paginação estável
        take: q.limit + 1, // +1 detecta a próxima página sem COUNT
        ...(q.cursor !== undefined ? { cursor: { id: q.cursor }, skip: 1 } : { skip: q.offset }), // cursor: Prisma resolve (data_abertura, id) da linha no banco
      }),
    ]);
    const { itens: ordens, proximo } = recortarPagina(linhas, q.limit);
    if (total !== null) reply.header('X-Total-Count', total);
    if (proximo) reply.header('X-Next-Cursor', proximo);
    // Quem atende/reservou só vai para o painel (técnico, gerente, admin); o totem do operador/líder não recebe.
    const painel = ['TECNICO', 'GERENTE', 'ADMIN'].includes(req.user.perfil);
    return toJSON(ordens.map(({ responsavel, delegador, delegadoEm, motivoRecusa, ...o }) => ({
      ...toDto(o),
      ...(painel && {
        responsavel: o.status === 'RESERVADA' ? null : responsavel, // executa / executou
        reservadoPara: o.status === 'RESERVADA' ? responsavel : null,
        reservadoEm: o.status === 'RESERVADA' ? delegadoEm : null,
        delegadoPor: o.status === 'RESERVADA' ? delegador : null,
        devolvida: o.status === 'ABERTA' && motivoRecusa !== null, // motivo da recusa: GET /ordens/devolvidas
      }),
    })));
  });

  // Fase 35 (§3.6, opcional): PDF da ficha AO VIVO para conferência de layout (QA/suporte). FICHA_FINAL se CONCLUIDA, senão FICHA_INICIAL.
  app.get('/ordens/:id/ficha.pdf', { preHandler: painelManutencao, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id: ordemId } = z.object({ id }).strict().parse(req.params);
    const snap = await prisma.$transaction(async (tx) => {
      const o = await tx.ordem.findUnique({ where: { id: ordemId }, select: { status: true } });
      if (!o) return null;
      return montarFichaSnapshot(tx, ordemId, o.status === 'CONCLUIDA' ? 'FICHA_FINAL' : 'FICHA_INICIAL', req.log);
    });
    if (!snap) return reply.code(404).send({ error: 'OM_NAO_ENCONTRADA', message: 'Ordem não encontrada.' });
    const pdf = await renderFichaPdf(snap, { tz: config.TZ_RELATORIOS });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="ficha_${snap.om.numeroFormatado.replace(/[^A-Za-z0-9_.-]/g, '_')}.pdf"`)
      .header('Cache-Control', 'no-store')
      .send(pdf);
  });

  app.get('/ordens/:id', async (req, reply) => {
    const { id: ordemId } = z.object({ id }).strict().parse(req.params);
    const ordem = await prisma.ordem.findUnique({
      where: { id: ordemId },
      select: {
        ...ordemSelect,
        responsavel: { select: { id: true, matricula: true, nome: true, perfil: true } },
        delegadoEm: true,
      },
    });
    if (!ordem) {
      return reply.code(404).send({ error: 'OM_NAO_ENCONTRADA', message: 'Ordem não encontrada.' });
    }
    const { responsavel, delegadoEm, ...o } = ordem;
    // Mesma regra da listagem: quem executa/reservou só vai para o painel (técnico, gerente, admin).
    const painel = ['TECNICO', 'GERENTE', 'ADMIN'].includes(req.user.perfil);
    return toJSON({
      ...toDto(o),
      ...(painel && {
        responsavel: o.status === 'RESERVADA' ? null : responsavel, // executa / executou
        reservadoPara: o.status === 'RESERVADA' ? responsavel : null,
        reservadoEm: o.status === 'RESERVADA' ? delegadoEm : null,
      }),
    });
  });
};
