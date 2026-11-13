import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { DUMMY_HASH, verifyPin } from '../auth/password.js';
import { auditar } from '../auditoria.js';
import { mensagemTotem, perfilPermitido, portalDe, ERRO_PORTAL } from '../politicaAcesso.js';
import { limparFalhas, registrarFalha, segundosBloqueado } from '../auth/lockout.js';

const pinBody = z.object({
  matricula: z.string().trim().min(1).max(30).refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'caracteres de controle não são permitidos'),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN deve ter 4 a 6 dígitos'),
  // Device ID do totem. Com ele o login é uma SESSÃO DE TOTEM (curta, absoluta e vinculada ao dispositivo).
  // Também aceito no header X-Totem-Id.
  totemId: z.string().trim().regex(/^[A-Za-z0-9._-]{1,50}$/, 'totemId inválido').optional(),
  // Fase 32 (US-17): o Kanban (/tecnico) declara o portal. Declaração do cliente (UX/defesa em profundidade); a fronteira real é o RBAC por rota.
  portal: z.literal('TECNICO').optional(),
}).strict();

// Mensagem única para qualquer falha de credencial: não revela se matrícula/crachá existe (anti-enumeração).
const CREDENCIAIS_INVALIDAS = {
  error: 'CREDENCIAIS_INVALIDAS',
  message: 'Matrícula ou PIN incorreto. Tente novamente',
};

type UsuarioAuth = { id: bigint; nome: string; perfil: 'ADMIN' | 'GERENTE' | 'TECNICO' | 'OPERADOR' | 'LIDER_PRODUCAO'; ativo: boolean };

export const authRoutes: FastifyPluginAsync = async (app) => {
  async function emitirSessao(reply: FastifyReply, u: UsuarioAuth, totemId?: string, portal?: string) {
    const usuario = { id: u.id.toString(), nome: u.nome, perfil: u.perfil };
    if (totemId !== undefined) {
      // Sessão de totem: expira em KIOSK_TOKEN_TTL_S (900 s) ABSOLUTOS, sem renovação (não existe refresh) e presa ao Device ID.
      const ttl = config.KIOSK_TOKEN_TTL_S;
      const token = await reply.jwtSign({ sub: u.id.toString(), perfil: u.perfil, nome: u.nome, tid: totemId }, { expiresIn: `${ttl}s` });
      return reply.header('Cache-Control', 'no-store').send({
        token, tipo: 'Bearer', sessao: 'TOTEM', totemId, expiraEm: `${ttl}s`, expiraEmSegundos: ttl, usuario,
      });
    }
    // Fase 37 (RN-87): painel (GERENTE/ADMIN, sem totem e sem portal declarado) vive ADMIN_SESSAO_TTL_S (12 h), absoluto.
    // Tecnico/Operador/Lider e logins por portal (/tecnico, inclusive ADMIN) seguem em JWT_EXPIRES_IN.
    if (portal === 'PADRAO' && (u.perfil === 'GERENTE' || u.perfil === 'ADMIN')) {
      const ttl = config.ADMIN_SESSAO_TTL_S;
      const token = await reply.jwtSign({ sub: u.id.toString(), perfil: u.perfil, nome: u.nome }, { expiresIn: `${ttl}s` });
      return reply.header('Cache-Control', 'no-store').send({ token, tipo: 'Bearer', sessao: 'PADRAO', expiraEm: `${ttl}s`, expiraEmSegundos: ttl, usuario });
    }
    const token = await reply.jwtSign({ sub: u.id.toString(), perfil: u.perfil, nome: u.nome });
    return reply.header('Cache-Control', 'no-store').send({ token, tipo: 'Bearer', sessao: 'PADRAO', expiraEm: config.JWT_EXPIRES_IN, usuario });
  }

  // Limite por IP (totem). Excedido => 429 com Retry-After.
  const limitePin = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  const autenticarPorPin = async (req: import('fastify').FastifyRequest, reply: FastifyReply) => {
    const { matricula, pin, totemId: totemBody, portal: portalBody } = pinBody.parse(req.body);

    // Device ID: no corpo ou no header X-Totem-Id (se vierem os dois, têm de coincidir).
    const totemHeader = typeof req.headers['x-totem-id'] === 'string' ? req.headers['x-totem-id'].trim() : undefined;
    if (totemBody !== undefined && totemHeader !== undefined && totemBody !== totemHeader) {
      return reply.code(400).send({ error: 'TOTEM_ID_DIVERGENTE', message: 'O Device ID do corpo e do header X-Totem-Id não coincidem.' });
    }
    const totemId = totemBody ?? totemHeader;
    if (portalBody !== undefined && totemId !== undefined) {
      return reply.code(400).send({ error: 'VALIDACAO', message: 'Portal e totemId são mutuamente exclusivos.' });
    }
    if (totemId !== undefined && !/^[A-Za-z0-9._-]{1,50}$/.test(totemId)) {
      return reply.code(400).send({ error: 'VALIDACAO', message: 'totemId inválido.' });
    }
    // Totem fora da lista de autorizados: recusa ANTES de verificar o PIN (não consome tentativas de PIN de ninguém).
    if (totemId !== undefined && config.TOTENS_AUTORIZADOS.length > 0 && !config.TOTENS_AUTORIZADOS.includes(totemId)) {
      req.log.warn({ evento: 'login_totem_nao_autorizado', totemId, ip: req.ip });
      return reply.code(403).send({ error: 'TOTEM_NAO_AUTORIZADO', message: 'Este dispositivo não está autorizado como totem.' });
    }

    const espera = segundosBloqueado(matricula);
    if (espera > 0) {
      return reply.code(429).header('Retry-After', espera).send({
        error: 'CONTA_BLOQUEADA_TEMPORARIAMENTE',
        message: 'Muitas tentativas. Procure seu líder ou aguarde para tentar novamente.',
        retryAfterSegundos: espera,
      });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { matricula },
      select: { id: true, nome: true, perfil: true, ativo: true, pinHash: true },
    });

    // Sempre executa um scrypt (real ou dummy) para manter o tempo de resposta uniforme.
    const pinOk = await verifyPin(pin, usuario?.pinHash ?? DUMMY_HASH);
    if (!usuario || !usuario.pinHash || !pinOk || !usuario.ativo) {
      registrarFalha(matricula);
      req.log.warn({ evento: 'login_pin_falhou', ip: req.ip }, 'falha de autenticação por PIN');
      return reply.code(401).send(CREDENCIAIS_INVALIDAS);
    }

    limparFalhas(matricula);
    // Fase 32 (US-17): política por portal DEPOIS do PIN (sem oráculo de perfil) e sem registrarFalha (credencial correta).
    const portal = portalDe(totemId, portalBody);
    if (!perfilPermitido(portal, usuario.perfil, config.TOTEM_PERFIS_PERMITIDOS)) {
      req.log.warn({ evento: 'login_perfil_bloqueado', usuarioId: usuario.id.toString(), perfil: usuario.perfil, portal, totemId, ip: req.ip });
      try {
        await auditar(prisma, {
          atorId: usuario.id, atorPerfil: usuario.perfil, acao: 'LOGIN_PERFIL_BLOQUEADO', alvoTipo: 'USUARIO', alvoId: usuario.id,
          detalhe: { portal, perfil: usuario.perfil, totemId: totemId ?? null },
        });
      } catch (e) {
        req.log.error(e, 'falha ao auditar bloqueio de perfil'); // a recusa não depende da auditoria
      }
      const base = ERRO_PORTAL[portal as 'TOTEM' | 'TECNICO'];
      return reply.code(403).send({ error: base.error, message: portal === 'TOTEM' ? mensagemTotem(usuario.perfil) : base.message });
    }
    // Perfis que só existem no totem não podem abrir sessão fora dele (ex.: token usado em outro aparelho/navegador).
    if (totemId === undefined && config.TOTEM_OBRIGATORIO_PERFIS.includes(usuario.perfil)) {
      req.log.warn({ evento: 'login_sem_totem_recusado', usuarioId: usuario.id.toString(), perfil: usuario.perfil, ip: req.ip });
      return reply.code(403).send({ error: 'TOTEM_OBRIGATORIO', message: 'Este perfil só pode entrar por um totem cadastrado.' });
    }
    req.log.info({ evento: 'login_pin_ok', usuarioId: usuario.id.toString(), sessao: totemId ? 'TOTEM' : 'PADRAO', totemId }, 'login por PIN');
    return emitirSessao(reply, usuario, totemId, portal);
  };

  app.post('/auth/pin', { config: limitePin }, autenticarPorPin);
  app.post('/auth/login', { config: limitePin }, autenticarPorPin);
  app.post('/auth/totem', { config: limitePin }, autenticarPorPin);

  // Dados da sessão atual (o totem usa para exibir "Olá, <nome>").
  app.get('/auth/me', { onRequest: app.autenticar }, async (req) => ({
    id: req.user.sub,
    nome: req.user.nome,
    perfil: req.user.perfil,
    // sessão de totem: dispositivo e fim ABSOLUTO (o front pode exibir/encerrar a sessão sem adivinhar)
    totemId: req.user.tid ?? null,
    expiraEm: req.user.exp ? new Date(req.user.exp * 1000).toISOString() : null,
  }));
};
