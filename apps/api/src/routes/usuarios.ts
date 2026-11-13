import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db.js';
import { toJSON } from '../serialize.js';
import { hashPin } from '../auth/password.js';
import { bloqueadoAte, limparFalhas } from '../auth/lockout.js';
import { auditar } from '../auditoria.js';
import { soAdmin } from '../plugins/rbac.js';

const PERFIS = ['ADMIN', 'GERENTE', 'TECNICO', 'OPERADOR', 'LIDER_PRODUCAO'] as const;

const id = z.string().regex(/^\d{1,18}$/, 'id inválido').transform((v) => BigInt(v));
const erro = (error: string, message: string, extra: object = {}) => ({ error, message, ...extra });

const nome = z.string().trim().min(2).max(150);
// E-mail é opcional. String vazia equivale a "sem e-mail" (null).
const email = z
  .union([z.literal(''), z.string().trim().toLowerCase().max(254).pipe(z.email())])
  .transform((v) => (v === '' ? null : v));
const matricula = z.string().trim().regex(/^[A-Za-z0-9._-]{1,30}$/, 'matrícula: letras, números, . _ - (até 30)');
const pin = z.string().regex(/^\d{4,6}$/, 'PIN deve ter 4 a 6 dígitos');
const criarBody = z.object({
  nome,
  perfil: z.enum(PERFIS),
  matricula, // identificação no totem: matrícula + PIN são obrigatórios
  pin,
  email: email.nullable().optional(),
  ativo: z.boolean().default(true),
}).strict();

const atualizarBody = z
  .object({
    nome,
    email: email.nullable(), // null ou "" remove o e-mail
    perfil: z.enum(PERFIS),
    matricula,
    ativo: z.boolean(),
  })
  .partial().strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Informe ao menos um campo para atualizar' });

const credenciaisBody = z.object({ pin }).strict();

const listQuery = z.object({
  perfil: z.enum(PERFIS).optional(),
  ativo: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  busca: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

// Nunca expõe senha_hash/pin_hash: só se há PIN cadastrado.
const select = {
  id: true, nome: true, email: true, perfil: true, ativo: true, matricula: true,
  pinHash: true, criadoEm: true, atualizadoEm: true,
} as const;
type Row = Prisma.UsuarioGetPayload<{ select: typeof select }>;
// bloqueadoAte: bloqueio por tentativas de PIN (em memória; null = não bloqueado)
const dto = ({ pinHash, ...u }: Row) => ({ ...u, temPin: pinHash !== null, bloqueadoAte: u.matricula ? bloqueadoAte(u.matricula) : null });

/** P2002 (unicidade): descobre qual campo conflitou para devolver 409 específico. */
function conflito(e: unknown) {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return null;
  const alvo = JSON.stringify(e.meta ?? {}).toLowerCase();
  return alvo.includes('matricula')
    ? erro('MATRICULA_DUPLICADA', 'Já existe usuário com esta matrícula.')
    : erro('EMAIL_DUPLICADO', 'Já existe usuário com este e-mail.');
}

export const usuariosRoutes: FastifyPluginAsync = async (app) => {
  // Todas as rotas deste módulo: somente ADMIN.
  app.addHook('preHandler', soAdmin);

  app.get('/usuarios', async (req, reply) => {
    const q = listQuery.parse(req.query);
    const where: Prisma.UsuarioWhereInput = {
      ...(q.perfil && { perfil: q.perfil }),
      ...(q.ativo !== undefined && { ativo: q.ativo }),
      ...(q.busca && {
        OR: [
          { nome: { contains: q.busca, mode: 'insensitive' } },
          { email: { contains: q.busca, mode: 'insensitive' } },
          { matricula: { contains: q.busca, mode: 'insensitive' } },
        ],
      }),
    };
    const [total, itens] = await Promise.all([
      prisma.usuario.count({ where }),
      prisma.usuario.findMany({ where, select, orderBy: [{ nome: 'asc' }, { id: 'asc' }], take: q.limit, skip: q.offset }),
    ]);
    reply.header('X-Total-Count', total);
    return toJSON(itens.map(dto));
  });

  app.post('/usuarios', async (req, reply) => {
    const b = criarBody.parse(req.body);

    // O índice único do banco é em lower(email) (que o Prisma não modela): checa antes para 409 limpo.
    if (b.email && await prisma.usuario.findFirst({ where: { email: { equals: b.email, mode: 'insensitive' } }, select: { id: true } })) {
      return reply.code(409).send(erro('EMAIL_DUPLICADO', 'Já existe usuário com este e-mail.'));
    }

    // PIN só é gravado como hash; nada em texto puro chega ao banco nem aos logs.
    const pinHash = await hashPin(b.pin);
    try {
      const criado = await prisma.usuario.create({
        data: {
          nome: b.nome, email: b.email ?? null, perfil: b.perfil, ativo: b.ativo,
          matricula: b.matricula, pinHash,
        },
        select,
      });
      await auditar(prisma, { atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'USUARIO_CRIADO', alvoTipo: 'USUARIO', alvoId: criado.id, detalhe: { perfil: criado.perfil, matricula: criado.matricula } });
      req.log.info({ evento: 'usuario_criado', usuarioId: criado.id.toString(), perfil: criado.perfil, por: req.user.sub });
      return reply.code(201).send(toJSON(dto(criado)));
    } catch (e) {
      const c = conflito(e);
      if (c) return reply.code(409).send(c);
      throw e;
    }
  });

  app.put('/usuarios/:id', async (req, reply) => {
    const { id: uid } = z.object({ id }).parse(req.params);
    const b = atualizarBody.parse(req.body);
    const souEu = uid === BigInt(req.user.sub);

    const atual = await prisma.usuario.findUnique({ where: { id: uid }, select: { id: true, perfil: true, ativo: true, matricula: true } });
    if (!atual) return reply.code(404).send(erro('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.'));

    // Evita o ADMIN se trancar para fora (rebaixar/desativar a si mesmo) e ficar sem nenhum ADMIN ativo.
    const perdeAdmin = atual.perfil === 'ADMIN' && atual.ativo
      && ((b.perfil !== undefined && b.perfil !== 'ADMIN') || b.ativo === false);
    if (perdeAdmin) {
      if (souEu) {
        return reply.code(409).send(erro('AUTO_REBAIXAMENTO', 'Você não pode desativar nem rebaixar o próprio usuário ADMIN.'));
      }
      const outros = await prisma.usuario.count({ where: { perfil: 'ADMIN', ativo: true, id: { not: uid } } });
      if (outros === 0) return reply.code(409).send(erro('ULTIMO_ADMIN', 'É necessário manter ao menos um ADMIN ativo.'));
    }
    if (b.email && await prisma.usuario.findFirst({
      where: { email: { equals: b.email, mode: 'insensitive' }, id: { not: uid } }, select: { id: true },
    })) {
      return reply.code(409).send(erro('EMAIL_DUPLICADO', 'Já existe usuário com este e-mail.'));
    }

    try {
      const upd = await prisma.usuario.update({ where: { id: uid }, data: b, select });
      // Usuário desativado ou com matrícula trocada: zera o contador de falhas de PIN da matrícula antiga.
      if (atual.matricula && (b.ativo === false || (b.matricula !== undefined && b.matricula !== atual.matricula))) {
        limparFalhas(atual.matricula);
      }
      const ator = BigInt(req.user.sub);
      if (b.perfil !== undefined && b.perfil !== atual.perfil) {
        await auditar(prisma, { atorId: ator, atorPerfil: req.user.perfil, acao: 'USUARIO_PERFIL_ALTERADO', alvoTipo: 'USUARIO', alvoId: uid, detalhe: { de: atual.perfil, para: b.perfil } });
      }
      if (b.ativo !== undefined && b.ativo !== atual.ativo) {
        await auditar(prisma, { atorId: ator, atorPerfil: req.user.perfil, acao: b.ativo ? 'USUARIO_ATIVADO' : 'USUARIO_DESATIVADO', alvoTipo: 'USUARIO', alvoId: uid });
      }
      const outros = Object.keys(b).filter((c) => c !== 'perfil' && c !== 'ativo');
      if (outros.length > 0) {
        await auditar(prisma, { atorId: ator, atorPerfil: req.user.perfil, acao: 'USUARIO_ATUALIZADO', alvoTipo: 'USUARIO', alvoId: uid, detalhe: { campos: outros } });
      }
      req.log.info({ evento: 'usuario_atualizado', usuarioId: uid.toString(), campos: Object.keys(b), por: req.user.sub });
      return toJSON(dto(upd));
    } catch (e) {
      const c = conflito(e);
      if (c) return reply.code(409).send(c);
      throw e;
    }
  });

  // B-19-01: exclusão física só de quem nunca foi referenciado; com histórico => 409 e a UI sugere desativar.
  app.delete('/usuarios/:id', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id: uid } = z.object({ id }).parse(req.params);
    const ator = BigInt(req.user.sub);
    if (uid === ator) return reply.code(409).send(erro('AUTO_EXCLUSAO', 'Você não pode excluir o próprio usuário.'));

    const r = await prisma.$transaction(async (tx) => {
      const alvo = await tx.usuario.findUnique({ where: { id: uid }, select: { id: true, nome: true, matricula: true, perfil: true, ativo: true } });
      if (!alvo) return { codigo: 404 as const };
      if (alvo.perfil === 'ADMIN' && alvo.ativo) {
        const outros = await tx.usuario.count({ where: { perfil: 'ADMIN', ativo: true, id: { not: uid } } });
        if (outros === 0) return { codigo: 'ULTIMO_ADMIN' as const };
      }
      // Pré-checagem explícita: várias FKs são SET NULL e apagariam a autoria em silêncio. Só ator/em_nome_de da auditoria contam.
      const [ordens, apontamentos, notas, materiais, historico, auditoria, outros] = await Promise.all([
        tx.ordem.count({ where: { OR: [{ solicitanteId: uid }, { responsavelId: uid }, { aprovadoPor: uid }, { delegadoPor: uid }, { aprovadoEmNomeDe: uid }, { concluidoPor: uid }] } }),
        tx.omApontamentoTempo.count({ where: { OR: [{ tecnicoId: uid }, { deletadoPor: uid }] } }),
        tx.ordemNota.count({ where: { autorId: uid } }),
        tx.omMaterialUtilizado.count({ where: { registradoPor: uid } }),
        tx.historicoStatusOrdem.count({ where: { usuarioId: uid } }),
        tx.auditoria.count({ where: { OR: [{ atorId: uid }, { emNomeDe: uid }] } }),
        tx.configuracaoGlobal.count({ where: { atualizadoPor: uid } }),
      ]);
      const contagens = { ordens, apontamentos, notas, materiais, historico, auditoria, outros };
      const referencias = Object.fromEntries(Object.entries(contagens).filter(([, n]) => n > 0));
      if (Object.keys(referencias).length > 0) return { codigo: 'COM_HISTORICO' as const, referencias };

      await tx.usuario.delete({ where: { id: uid } });
      await auditar(tx, { atorId: ator, atorPerfil: req.user.perfil, acao: 'USUARIO_EXCLUIDO', alvoTipo: 'USUARIO', alvoId: uid, detalhe: { nome: alvo.nome, matricula: alvo.matricula, perfil: alvo.perfil } });
      return { codigo: 204 as const, matricula: alvo.matricula };
    });

    if (r.codigo === 404) return reply.code(404).send(erro('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.'));
    if (r.codigo === 'ULTIMO_ADMIN') return reply.code(409).send(erro('ULTIMO_ADMIN', 'É necessário manter ao menos um ADMIN ativo.'));
    if (r.codigo === 'COM_HISTORICO') {
      return reply.code(409).send(erro('USUARIO_COM_HISTORICO', 'Este usuário possui histórico e não pode ser excluído. Desative-o.', { referencias: r.referencias, sugestao: 'DESATIVAR' }));
    }
    if (r.matricula) limparFalhas(r.matricula);
    req.log.info({ evento: 'usuario_excluido', usuarioId: uid.toString(), por: req.user.sub });
    return reply.code(204).send();
  });

  // Troca de PIN (única credencial: o login do totem é matrícula + PIN).
  app.put('/usuarios/:id/credenciais', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id: uid } = z.object({ id }).parse(req.params);
    const { pin: novoPin } = credenciaisBody.parse(req.body);

    const alvo = await prisma.usuario.findUnique({ where: { id: uid }, select: { id: true, matricula: true } });
    if (!alvo) return reply.code(404).send(erro('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.'));
    if (!alvo.matricula) {
      return reply.code(422).send(erro('SEM_MATRICULA', 'Cadastre a matrícula do usuário antes de definir o PIN (o login no totem usa matrícula + PIN).'));
    }

    await prisma.usuario.update({ where: { id: uid }, data: { pinHash: await hashPin(novoPin) } });

    // PIN novo = recomeça do zero o bloqueio por tentativas dessa matrícula.
    limparFalhas(alvo.matricula);
    await auditar(prisma, { atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'PIN_REDEFINIDO', alvoTipo: 'USUARIO', alvoId: uid }); // sem o PIN
    req.log.info({ evento: 'pin_atualizado', usuarioId: uid.toString(), por: req.user.sub });
    return reply.code(204).send();
  });

  // Libera um usuário bloqueado por tentativas erradas de PIN (hoje só era limpo ao trocar PIN/desativar).
  app.post('/usuarios/:id/desbloquear', async (req, reply) => {
    const { id: uid } = z.object({ id }).parse(req.params);
    const alvo = await prisma.usuario.findUnique({ where: { id: uid }, select: { matricula: true } });
    if (!alvo) return reply.code(404).send(erro('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.'));
    const estava = alvo.matricula ? bloqueadoAte(alvo.matricula) !== null : false;
    if (alvo.matricula) limparFalhas(alvo.matricula);
    await auditar(prisma, { atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'USUARIO_DESBLOQUEADO', alvoTipo: 'USUARIO', alvoId: uid, detalhe: { estavaBloqueado: estava } });
    req.log.info({ evento: 'usuario_desbloqueado', usuarioId: uid.toString(), por: req.user.sub });
    return reply.code(204).send();
  });
};
