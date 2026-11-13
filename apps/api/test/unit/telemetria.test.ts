import { describe, expect, it, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  marcarEncerramento,
  resetarEncerramentoParaTestes,
  estaEncerrando,
} from '../../src/routes/health.js';
import {
  obterMetricasPrometheus,
  resetarMetricas,
  incrementarRequisicoesAtivas,
  decrementarRequisicoesAtivas,
  registrarRequisicaoHttp,
  registrarEnvioOutboxSucesso,
  registrarEnvioOutboxFalha,
} from '../../src/telemetria/metrics.js';

describe('Telemetria e Observabilidade (Fase 34 - Mudança 4)', () => {
  beforeEach(() => {
    resetarMetricas();
    resetarEncerramentoParaTestes();
  });

  it('registra métricas HTTP e gera formato Prometheus / OpenMetrics válido', async () => {
    incrementarRequisicoesAtivas();
    registrarRequisicaoHttp('GET', '/health', 200, 0.015);
    registrarRequisicaoHttp('POST', '/auth/login', 401, 0.12);
    decrementarRequisicoesAtivas();

    const output = await obterMetricasPrometheus();

    // Valida seções essenciais do Prometheus
    expect(output).toContain('# HELP http_requests_total');
    expect(output).toContain('# TYPE http_requests_total counter');
    expect(output).toContain('http_requests_total{method="GET",route="/health",status_code="200"} 1');
    expect(output).toContain('http_requests_total{method="POST",route="/auth/login",status_code="401"} 1');

    expect(output).toContain('# HELP http_request_duration_seconds');
    expect(output).toContain('# TYPE http_request_duration_seconds histogram');
    expect(output).toContain('http_request_duration_seconds_count{method="GET",route="/health",status_code="200"} 1');
    expect(output).toContain('http_request_duration_seconds_bucket{method="GET",route="/health",status_code="200",le="+Inf"} 1');

    expect(output).toContain('# HELP process_resident_memory_bytes');
    expect(output).toContain('# HELP nodejs_heap_size_used_bytes');
    expect(output).toContain('# HELP process_cpu_seconds_total');
    expect(output).toContain('# HELP process_uptime_seconds');
  });

  it('registra métricas do worker outbox e reflete no dump Prometheus', async () => {
    registrarEnvioOutboxSucesso(0.45);
    registrarEnvioOutboxFalha(false); // temporária
    registrarEnvioOutboxFalha(true);  // permanente / dead-letter

    const output = await obterMetricasPrometheus();

    expect(output).toContain('# HELP outbox_email_enviados_total');
    expect(output).toContain('outbox_email_enviados_total 1');

    expect(output).toContain('# HELP outbox_email_falhas_total');
    expect(output).toContain('outbox_email_falhas_total{permanente="true"} 1');
    expect(output).toContain('outbox_email_falhas_total{permanente="false"} 1');

    expect(output).toContain('# HELP outbox_email_envio_duracao_segundos');
    expect(output).toContain('outbox_email_envio_duracao_segundos_count 1');
  });
});

describe('Healthchecks Segregados e Encerramento Gracioso (Fase 34 - Mudança 5)', () => {
  beforeEach(() => {
    resetarEncerramentoParaTestes();
  });

  it('GET /health/live responde 200 de forma autônoma sem depender de DB', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.timestamp).toBeDefined();
    await app.close();
  });

  it('GET /health responde status degraded 503 quando DB está inacessível (unit sandbox)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('degraded');
    expect(body.db).toBe('down');
    await app.close();
  });

  it('GET /health/ready responde unready 503 quando DB está inacessível', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('unready');
    expect(body.ready).toBe(false);
    expect(body.db).toBe('down');
    await app.close();
  });

  it('GET /health/ready responde shutting_down 503 com prioridade imediata ao sinalizar encerramento gracioso', async () => {
    const app = buildApp();
    
    marcarEncerramento();
    expect(estaEncerrando()).toBe(true);

    const resShutdown = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });
    expect(resShutdown.statusCode).toBe(503);
    const bodyShutdown = resShutdown.json();
    expect(bodyShutdown.status).toBe('shutting_down');
    expect(bodyShutdown.ready).toBe(false);
    expect(bodyShutdown.motivo).toContain('encerramento');

    await app.close();
  });

  it('GET /metrics expõe as métricas públicas com Content-Type Prometheus correto', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.payload).toContain('process_cpu_seconds_total');
    expect(res.payload).toContain('http_active_requests');
    await app.close();
  });

  it('propaga X-Request-Id nos headers e correlaciona em chamadas', async () => {
    const app = buildApp();
    const customReqId = 'corr-uuid-12345678-test';
    const res = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: {
        'x-request-id': customReqId,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBe(customReqId);
    await app.close();
  });
});
