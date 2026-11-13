import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';

let encerrando = false;

/** Sinaliza aos healthchecks de prontidão que o servidor iniciou o processo de encerramento gracioso. */
export function marcarEncerramento() {
  encerrando = true;
}

export function estaEncerrando(): boolean {
  return encerrando;
}

export function resetarEncerramentoParaTestes() {
  encerrando = false;
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Healthcheck legado retrocompatível.
   */
  app.get('/health', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up' };
    } catch (err) {
      app.log.error(err);
      return reply.code(503).send({ status: 'degraded', db: 'down' });
    }
  });

  /**
   * Liveness Probe (/health/live):
   * Verifica se o processo Node.js e o event loop estão ativos e responsivos.
   * Não depende de banco de dados para evitar reinicializações desnecessárias em cascata.
   */
  app.get('/health/live', async (_req, _reply) => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * Readiness Probe (/health/ready):
   * Verifica se a API está pronta para aceitar e rotear tráfego.
   * Rejeita requisições com HTTP 503 se o processo estiver em drenagem/shutdown ou se o banco estiver indisponível.
   * Conforme docs/arch/outbox-resiliencia.md §5.3, backlog do outbox não derruba readiness.
   */
  app.get('/health/ready', async (_req, reply) => {
    if (encerrando) {
      return reply.code(503).send({
        status: 'shutting_down',
        ready: false,
        motivo: 'servidor em processo de encerramento gracioso',
        timestamp: new Date().toISOString(),
      });
    }

    try {
      await prisma.$queryRaw`SELECT 1`;
      // Valida acessibilidade da infraestrutura de outbox sem travar se houver backlog
      await prisma.$queryRaw`SELECT 1 FROM outbox_email LIMIT 1`;
      return {
        status: 'ready',
        ready: true,
        db: 'up',
        outbox: 'accessible',
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      app.log.error({ err }, 'readiness falhou: banco ou outbox inacessivel');
      return reply.code(503).send({
        status: 'unready',
        ready: false,
        db: 'down',
        motivo: 'banco de dados ou tabela de mensageria inacessivel',
        timestamp: new Date().toISOString(),
      });
    }
  });
};
