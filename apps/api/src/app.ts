import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { incrementarRequisicoesAtivas, decrementarRequisicoesAtivas, registrarRequisicaoHttp } from './telemetria/metrics.js';
import { equipamentosRoutes } from './routes/equipamentos.js';
import { ordensRoutes } from './routes/ordens.js';
import { atendimentoRoutes } from './routes/atendimento.js';
import { materiaisRoutes } from './routes/materiais.js';
import { fichaRoutes } from './routes/ficha.js';
import { metricasRoutes } from './routes/metricas.js';
import { eventosStreamRoutes, eventosTicketRoutes } from './routes/eventos.js';
import { configuracoesRoutes } from './routes/configuracoes.js';
import { usuariosRoutes } from './routes/usuarios.js';
import { despachoRoutes } from './routes/despacho.js';
import { auditoriaRoutes } from './routes/auditoria.js';
import { setoresRoutes } from './routes/setores.js';
import { equipamentosAdminRoutes } from './routes/equipamentos-admin.js';
import { gruposAtivosRoutes } from './routes/grupos-ativos.js';
import { publicoRoutes } from './routes/publico.js';
import { desempenhoRoutes } from './routes/desempenho.js';

/** X-Request-Id do cliente/proxy só é aceito se for curto e sem caracteres de controle (evita log injection); senão gera um UUID. */
const REQ_ID_VALIDO = /^[A-Za-z0-9._-]{8,64}$/;

const origensPermitidas = config.CORS_ORIGIN.split(',').map((o) => o.trim());

/** Origem de rede local/intranet: localhost, loopback, faixas privadas RFC 1918 e hostnames .local. */
function origemRedeLocal(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return true;
  // Faixas numéricas só valem para IPv4 literal: um domínio como "10.exemplo.com" não pode passar por prefixo.
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return host.startsWith('192.168.') || host.startsWith('10.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/** HTTPS só quando SSL_KEY_PATH e SSL_CERT_PATH estão definidos E os arquivos existem; senão HTTP (testes, dev). */
function carregarTls(): { https?: { key: Buffer; cert: Buffer }; aviso?: string } {
  const { SSL_KEY_PATH: keyPath, SSL_CERT_PATH: certPath } = config;
  if (!keyPath && !certPath) return {};
  if (!keyPath || !certPath) return { aviso: 'SSL_KEY_PATH e SSL_CERT_PATH devem ser definidos juntos: iniciando em HTTP.' };
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    return { aviso: `Arquivo(s) SSL não encontrado(s) (key=${keyPath}, cert=${certPath}): iniciando em HTTP.` };
  }
  return { https: { key: readFileSync(keyPath), cert: readFileSync(certPath) } };
}

export function buildApp() {
  const tls = carregarTls();
  const app = Fastify({
    ...(tls.https && { https: tls.https }),
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      // Nunca logar credenciais/tokens.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.pin', 'req.body.senha', 'req.body.novoPin'],
    },
    // Fase 34 (telemetria): todo log da requisição carrega `reqId` (label padrão do Fastify), devolvido em X-Request-Id e gravado no outbox.
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && REQ_ID_VALIDO.test(h) ? h : randomUUID();
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
  });
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
  });

  const HRTIME_SEGUNDOS = 1e9;
  app.addHook('onRequest', async (req) => {
    incrementarRequisicoesAtivas();
    (req.raw as unknown as { __inicioHr?: bigint }).__inicioHr = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (req, reply) => {
    decrementarRequisicoesAtivas();
    const inicio = (req.raw as unknown as { __inicioHr?: bigint }).__inicioHr;
    if (inicio) {
      const duracao = Number(process.hrtime.bigint() - inicio) / HRTIME_SEGUNDOS;
      const rota = req.routeOptions?.url || req.url.split('?')[0] || 'desconhecido';
      registrarRequisicaoHttp(req.method, rota, reply.statusCode, duracao);
    }
  });

  if (tls.https) app.log.info('HTTPS habilitado (SSL_KEY_PATH/SSL_CERT_PATH).');
  else if (tls.aviso) app.log.warn(tls.aviso);

  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
    noSniff: true,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  // Limite global; rotas sensíveis (/auth/*) definem limites mais estritos via config.rateLimit.
  app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  app.register(authPlugin);
  app.register(cors, {
    // Lista explícita (CORS_ORIGIN) + sem Origin (curl, server-to-server) + rede local privada (intranet); nunca '*'.
    origin: (origin, cb) => {
      if (!origin || origensPermitidas.includes(origin) || origemRedeLocal(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Totem-Id', 'X-Request-Id'],
    exposedHeaders: ['X-Total-Count', 'X-Gerado-Em', 'X-Next-Cursor', 'X-Request-Id'], // paginação (offset e cursor) + correlação
    maxAge: 600,
  });

  app.setErrorHandler((err: Error, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'VALIDACAO',
        message: 'Dados inválidos.',
        detalhes: err.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
      });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      req.log.error(err);
      return reply.code(500).send({ error: 'ERRO_INTERNO', message: 'Erro interno do servidor.' });
    }
    return reply.code(status).send({ error: 'REQUISICAO_INVALIDA', message: err.message });
  });

  app.register(healthRoutes);
  app.register(metricsRoutes);
  app.register(authRoutes);
  app.register(publicoRoutes); // GET /config/publica: sem autenticação (totem em repouso), resposta mínima
  app.register(eventosStreamRoutes); // autenticado por ticket de uso único (EventSource não envia Authorization)

  // Tudo abaixo exige JWT válido.
  app.register(async (protegido) => {
    protegido.addHook('onRequest', protegido.autenticar);
    await protegido.register(equipamentosRoutes);
    await protegido.register(ordensRoutes);
    await protegido.register(atendimentoRoutes);
    await protegido.register(materiaisRoutes);
    await protegido.register(fichaRoutes);
    await protegido.register(metricasRoutes);
    await protegido.register(desempenhoRoutes); // /metricas/kpis|meta|equipe|backlog (GERENTE/ADMIN)
    await protegido.register(eventosTicketRoutes);
    await protegido.register(configuracoesRoutes);
    await protegido.register(usuariosRoutes); // somente ADMIN
    await protegido.register(despachoRoutes); // GET /usuarios/tecnicos: GERENTE e ADMIN
    await protegido.register(auditoriaRoutes); // somente ADMIN
    await protegido.register(gruposAtivosRoutes); // Fase 30: macro-categorias do Totem (ADMIN)
    await protegido.register(equipamentosAdminRoutes); // Fase 23: máquinas por setor (ADMIN)
    await protegido.register(setoresRoutes); // Fase 22: ADMIN (GET /setores/opcoes: GERENTE/ADMIN)
  });
  return app;
}
