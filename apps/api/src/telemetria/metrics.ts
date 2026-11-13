import { prisma } from '../db.js';

/**
 * Módulo de Observabilidade e Métricas Prometheus da API Fastify (Fase 34 - Mudança 4).
 * Implementa o formato de exportação oficial do Prometheus / OpenMetrics em texto puro.
 */

interface BucketHistogram {
  le: number;
  count: number;
}

interface ItemHistograma {
  buckets: BucketHistogram[];
  sum: number;
  count: number;
}

const BUCKETS_HTTP_PADRAO = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const BUCKETS_OUTBOX_PADRAO = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30];

// Estruturas de métricas em memória
const httpRequestsTotal = new Map<string, number>();
const httpRequestDuration = new Map<string, ItemHistograma>();
let httpActiveRequests = 0;

let outboxEnviadosTotal = 0;
let outboxFalhasPermanentesTotal = 0;
let outboxFalhasTemporariasTotal = 0;
const outboxEnvioDuration: ItemHistograma = {
  buckets: BUCKETS_OUTBOX_PADRAO.map((le) => ({ le, count: 0 })),
  sum: 0,
  count: 0,
};

// Cache de amostragem de banco para não onerar o PostgreSQL a cada scrape
let cacheOutboxTimestamp = 0;
let cacheOutboxData = {
  pendentes: 0,
  processando: 0,
  mortos: 0,
  maisAntigoSegundos: 0,
};

function criarChaveLabels(labels: Record<string, string | number>): string {
  const chaves = Object.keys(labels).sort();
  return chaves.map((k) => `${k}="${labels[k]}"`).join(',');
}

function inicializarHistograma(bucketsDef: number[]): ItemHistograma {
  return {
    buckets: bucketsDef.map((le) => ({ le, count: 0 })),
    sum: 0,
    count: 0,
  };
}

function registrarNoHistograma(item: ItemHistograma, valor: number) {
  item.sum += valor;
  item.count += 1;
  for (const b of item.buckets) {
    if (valor <= b.le) {
      b.count += 1;
    }
  }
}

export function incrementarRequisicoesAtivas() {
  httpActiveRequests += 1;
}

export function decrementarRequisicoesAtivas() {
  httpActiveRequests = Math.max(0, httpActiveRequests - 1);
}

export function registrarRequisicaoHttp(method: string, route: string, statusCode: number, durationSeconds: number) {
  const chave = criarChaveLabels({ method: method.toUpperCase(), route: route || 'outros', status_code: statusCode });
  
  // Contador de requisições
  const atual = httpRequestsTotal.get(chave) ?? 0;
  httpRequestsTotal.set(chave, atual + 1);

  // Histograma de latência
  let hist = httpRequestDuration.get(chave);
  if (!hist) {
    hist = inicializarHistograma(BUCKETS_HTTP_PADRAO);
    httpRequestDuration.set(chave, hist);
  }
  registrarNoHistograma(hist, durationSeconds);
}

export function registrarEnvioOutboxSucesso(duracaoSegundos: number) {
  outboxEnviadosTotal += 1;
  registrarNoHistograma(outboxEnvioDuration, duracaoSegundos);
}

export function registrarEnvioOutboxFalha(permanente: boolean) {
  if (permanente) {
    outboxFalhasPermanentesTotal += 1;
  } else {
    outboxFalhasTemporariasTotal += 1;
  }
}

let anexoFalhas = new Map<string, number>();
const anexoRenderDuration: ItemHistograma = {
  sum: 0, count: 0, buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10].map((le) => ({ le, count: 0 })),
};

/** Fase 35: duração da renderização do PDF da ficha (outbox_email_anexo_render_duracao_segundos). */
export function registrarAnexoRender(duracaoSegundos: number) {
  registrarNoHistograma(anexoRenderDuration, duracaoSegundos);
}

/** Fase 35: falhas de anexo por motivo (outbox_email_anexo_falhas_total{motivo}). */
export function registrarAnexoFalha(motivo: 'snapshot_invalido' | 'render' | 'tamanho') {
  anexoFalhas.set(motivo, (anexoFalhas.get(motivo) ?? 0) + 1);
}

export function resetarMetricas() {
  anexoFalhas = new Map();
  anexoRenderDuration.sum = 0;
  anexoRenderDuration.count = 0;
  anexoRenderDuration.buckets.forEach((b) => { b.count = 0; });
  httpRequestsTotal.clear();
  httpRequestDuration.clear();
  httpActiveRequests = 0;
  outboxEnviadosTotal = 0;
  outboxFalhasPermanentesTotal = 0;
  outboxFalhasTemporariasTotal = 0;
  outboxEnvioDuration.sum = 0;
  outboxEnvioDuration.count = 0;
  outboxEnvioDuration.buckets.forEach((b) => { b.count = 0; });
  cacheOutboxTimestamp = 0;
}

async function atualizarMetricasOutboxDb() {
  const agora = Date.now();
  if (agora - cacheOutboxTimestamp < 10_000) return; // Cache de 10s
  try {
    const [res] = await prisma.$queryRaw<Array<{
      pendentes: bigint | number;
      processando: bigint | number;
      mortos: bigint | number;
      mais_antigo_segundos: number | null;
    }>>`
      SELECT 
        count(*) FILTER (WHERE status = 'PENDENTE') AS pendentes,
        count(*) FILTER (WHERE status = 'PROCESSANDO') AS processando,
        count(*) FILTER (WHERE status = 'MORTO') AS mortos,
        EXTRACT(EPOCH FROM (now() - min(proxima_tentativa_em))) FILTER (WHERE status = 'PENDENTE' AND proxima_tentativa_em <= now()) AS mais_antigo_segundos
      FROM outbox_email`;

    if (res) {
      cacheOutboxData = {
        pendentes: Number(res.pendentes ?? 0),
        processando: Number(res.processando ?? 0),
        mortos: Number(res.mortos ?? 0),
        maisAntigoSegundos: Math.max(0, Number(res.mais_antigo_segundos ?? 0)),
      };
      cacheOutboxTimestamp = agora;
    }
  } catch {
    // Se o banco estiver temporariamente ocupado ou inacessível, mantém o último valor do cache
  }
}

export async function obterMetricasPrometheus(): Promise<string> {
  await atualizarMetricasOutboxDb();

  const linhas: string[] = [];

  // 1. Métricas de Processo e Runtime Node.js
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const uptime = process.uptime();

  linhas.push('# HELP process_cpu_seconds_total Tempo total de CPU utilizado pelo processo em segundos.');
  linhas.push('# TYPE process_cpu_seconds_total counter');
  linhas.push(`process_cpu_seconds_total{type="user"} ${(cpu.user / 1_000_000).toFixed(6)}`);
  linhas.push(`process_cpu_seconds_total{type="system"} ${(cpu.system / 1_000_000).toFixed(6)}`);

  linhas.push('# HELP process_resident_memory_bytes Memoria residente do processo (RSS) em bytes.');
  linhas.push('# TYPE process_resident_memory_bytes gauge');
  linhas.push(`process_resident_memory_bytes ${mem.rss}`);

  linhas.push('# HELP nodejs_heap_size_used_bytes Memoria da Heap do V8 em uso em bytes.');
  linhas.push('# TYPE nodejs_heap_size_used_bytes gauge');
  linhas.push(`nodejs_heap_size_used_bytes ${mem.heapUsed}`);

  linhas.push('# HELP nodejs_heap_size_total_bytes Memoria da Heap do V8 alocada em bytes.');
  linhas.push('# TYPE nodejs_heap_size_total_bytes gauge');
  linhas.push(`nodejs_heap_size_total_bytes ${mem.heapTotal}`);

  linhas.push('# HELP process_uptime_seconds Tempo de atividade do processo em segundos.');
  linhas.push('# TYPE process_uptime_seconds gauge');
  linhas.push(`process_uptime_seconds ${uptime.toFixed(2)}`);

  // 2. Métricas HTTP
  linhas.push('# HELP http_active_requests Numero de requisicoes HTTP atualmente em processamento.');
  linhas.push('# TYPE http_active_requests gauge');
  linhas.push(`http_active_requests ${httpActiveRequests}`);

  linhas.push('# HELP http_requests_total Total de requisicoes HTTP processadas.');
  linhas.push('# TYPE http_requests_total counter');
  for (const [chave, contagem] of httpRequestsTotal.entries()) {
    linhas.push(`http_requests_total{${chave}} ${contagem}`);
  }

  linhas.push('# HELP http_request_duration_seconds Duracao das requisicoes HTTP em segundos.');
  linhas.push('# TYPE http_request_duration_seconds histogram');
  for (const [chave, hist] of httpRequestDuration.entries()) {
    for (const b of hist.buckets) {
      linhas.push(`http_request_duration_seconds_bucket{${chave},le="${b.le}"} ${b.count}`);
    }
    linhas.push(`http_request_duration_seconds_bucket{${chave},le="+Inf"} ${hist.count}`);
    linhas.push(`http_request_duration_seconds_sum{${chave}} ${hist.sum.toFixed(6)}`);
    linhas.push(`http_request_duration_seconds_count{${chave}} ${hist.count}`);
  }

  // 3. Métricas do Worker Outbox de E-mail (Fase 34)
  linhas.push('# HELP outbox_email_pendentes Total de e-mails com status PENDENTE no outbox.');
  linhas.push('# TYPE outbox_email_pendentes gauge');
  linhas.push(`outbox_email_pendentes ${cacheOutboxData.pendentes}`);

  linhas.push('# HELP outbox_email_mais_antigo_segundos Idade em segundos do e-mail pendente mais antigo ja vencido.');
  linhas.push('# TYPE outbox_email_mais_antigo_segundos gauge');
  linhas.push(`outbox_email_mais_antigo_segundos ${cacheOutboxData.maisAntigoSegundos.toFixed(2)}`);

  linhas.push('# HELP outbox_email_processando Total de e-mails atualmente com status PROCESSANDO (com lease ativo).');
  linhas.push('# TYPE outbox_email_processando gauge');
  linhas.push(`outbox_email_processando ${cacheOutboxData.processando}`);

  linhas.push('# HELP outbox_email_mortos Total de e-mails em status terminal MORTO (dead-letter).');
  linhas.push('# TYPE outbox_email_mortos gauge');
  linhas.push(`outbox_email_mortos ${cacheOutboxData.mortos}`);

  linhas.push('# HELP outbox_email_enviados_total Contador acumulado de e-mails enviados com sucesso.');
  linhas.push('# TYPE outbox_email_enviados_total counter');
  linhas.push(`outbox_email_enviados_total ${outboxEnviadosTotal}`);

  linhas.push('# HELP outbox_email_falhas_total Contador acumulado de falhas de envio de e-mail.');
  linhas.push('# TYPE outbox_email_falhas_total counter');
  linhas.push(`outbox_email_falhas_total{permanente="true"} ${outboxFalhasPermanentesTotal}`);
  linhas.push(`outbox_email_falhas_total{permanente="false"} ${outboxFalhasTemporariasTotal}`);

  linhas.push('# HELP outbox_email_envio_duracao_segundos Duracao dos envios de e-mail pelo worker em segundos.');
  linhas.push('# TYPE outbox_email_envio_duracao_segundos histogram');
  for (const b of outboxEnvioDuration.buckets) {
    linhas.push(`outbox_email_envio_duracao_segundos_bucket{le="${b.le}"} ${b.count}`);
  }
  linhas.push(`outbox_email_envio_duracao_segundos_bucket{le="+Inf"} ${outboxEnvioDuration.count}`);
  linhas.push(`outbox_email_envio_duracao_segundos_sum ${outboxEnvioDuration.sum.toFixed(6)}`);
  linhas.push(`outbox_email_envio_duracao_segundos_count ${outboxEnvioDuration.count}`);

  // Fase 35: anexo PDF da ficha
  linhas.push('# HELP outbox_email_anexo_render_duracao_segundos Duracao da renderizacao do PDF da ficha em segundos.');
  linhas.push('# TYPE outbox_email_anexo_render_duracao_segundos histogram');
  for (const b of anexoRenderDuration.buckets) {
    linhas.push(`outbox_email_anexo_render_duracao_segundos_bucket{le="${b.le}"} ${b.count}`);
  }
  linhas.push(`outbox_email_anexo_render_duracao_segundos_bucket{le="+Inf"} ${anexoRenderDuration.count}`);
  linhas.push(`outbox_email_anexo_render_duracao_segundos_sum ${anexoRenderDuration.sum.toFixed(6)}`);
  linhas.push(`outbox_email_anexo_render_duracao_segundos_count ${anexoRenderDuration.count}`);
  linhas.push('# HELP outbox_email_anexo_falhas_total Falhas de anexo (PDF da ficha) por motivo.');
  linhas.push('# TYPE outbox_email_anexo_falhas_total counter');
  for (const motivo of ['snapshot_invalido', 'render', 'tamanho']) {
    linhas.push(`outbox_email_anexo_falhas_total{motivo="${motivo}"} ${anexoFalhas.get(motivo) ?? 0}`);
  }

  return linhas.join('\n') + '\n';
}
