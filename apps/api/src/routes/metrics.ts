import type { FastifyPluginAsync } from 'fastify';
import { obterMetricasPrometheus } from '../telemetria/metrics.js';

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/metrics', async (_req, reply) => {
    const textoMetricas = await obterMetricasPrometheus();
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(textoMetricas);
  });
};
