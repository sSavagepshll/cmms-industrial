import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { chaveDerivadaDoJwt, migrarSegredosLegados } from './crypto/segredo.js';
import { iniciarFallback } from './jobs/fallback.js';
import { iniciarOutbox, type OutboxWorker } from './mail/outbox.js';
import { marcarEncerramento } from './routes/health.js';

const app = buildApp();
let outbox: OutboxWorker | null = null;

const shutdown = async (signal: string) => {
  marcarEncerramento(); // 1. Sinaliza readiness probe (/health/ready -> 503) para desviar tráfego de entrada
  app.log.info({ signal }, 'iniciando encerramento gracioso');

  // Timeout de segurança global: se alguma pendência prender o processo além de 25s, força saída
  const timeoutSeguranca = setTimeout(() => {
    app.log.error('Timeout de 25s atingido no encerramento gracioso; forçando encerramento.');
    process.exit(1);
  }, 25_000);
  timeoutSeguranca.unref();

  try {
    if (outbox) {
      app.log.info('drenando e finalizando worker outbox...');
      await outbox.parar();
      app.log.info('worker outbox finalizado com sucesso.');
    }
    app.log.info('fechando servidor HTTP Fastify...');
    await app.close();
    app.log.info('servidor Fastify encerrado.');

    app.log.info('desconectando pool do Prisma/PostgreSQL...');
    await prisma.$disconnect();
    app.log.info('desconectado do banco de dados.');

    clearTimeout(timeoutSeguranca);
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'erro durante o encerramento gracioso');
    clearTimeout(timeoutSeguranca);
    process.exit(1);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

if (chaveDerivadaDoJwt) {
  app.log.warn('CONFIG_ENCRYPTION_KEY não definida: chave de criptografia derivada do JWT_SECRET (trocar o JWT_SECRET invalidaria os segredos salvos).');
}
try {
  const n = await migrarSegredosLegados();
  if (n > 0) app.log.info({ migrados: n }, 'segredos de configuração criptografados');
} catch (err) {
  // Banco indisponível no boot não deve impedir a API de subir (a migração roda de novo no próximo boot).
  app.log.error({ err }, 'falha ao migrar segredos legados');
}

app.listen({ port: config.PORT, host: config.HOST }).then(() => {
  iniciarFallback(app.log);
  // Fase 35: o outbox é o único caminho de e-mail (o modo em memória foi removido); OUTBOX_EMAIL_ATIVO é ignorada.
  if (process.env.OUTBOX_EMAIL_ATIVO !== undefined) app.log.warn({ evento: 'outbox_flag_ignorada' }, 'OUTBOX_EMAIL_ATIVO foi removida na Fase 35 e é ignorada.');
  outbox = iniciarOutbox(app.log);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
