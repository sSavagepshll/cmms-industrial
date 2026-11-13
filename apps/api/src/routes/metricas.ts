import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { painelAdmin } from '../plugins/rbac.js';
import { toJSON } from '../serialize.js';
import { Prisma } from '../generated/prisma/client.js';
import { parseFiltros, trechos, type Filtros } from '../metricas/filtros.js';

const mttrQuery = z.object({ granularidade: z.enum(['day', 'week', 'month']).default('day') });
const ofensoresQuery = z.object({
  agrupar: z.enum(['equipamento', 'categoria', 'setor']).default('equipamento'),
  ordenarPor: z.enum(['ocorrencias', 'tempo_parada']).default('ocorrencias'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// Códigos reais de pausa e categorias reais (qualquer outro valor legado é normalizado para OUTRO / OUTROS).
const MOTIVOS_PAUSA = ['AGUARDANDO_PECA', 'AGUARDANDO_PRODUCAO', 'REFEICAO', 'TROCA_TURNO', 'AGUARDANDO_SUPORTE', 'OUTRO'];
const CATEGORIAS = ['MECANICO', 'ELETRICO', 'PNEUMATICO_HIDRAULICO', 'INSTRUMENTACAO', 'SEGURANCA', 'OUTROS'];

const TZ = config.TZ_RELATORIOS;
const num = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

export const metricasRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', painelAdmin);

  // ---------- 1) MTTR ----------
  // Base: OMs CONCLUIDAS no período (por data_conclusao). Três visões, em segundos:
  //  - mttrLiquido : MTTR (US-12 §2): aceite -> conclusão menos o tempo em PAUSADA, AGUARDANDO_PECA e AGUARDANDO_APROVACAO (vw_om_tempos)
  //  - mttrTotal   : média de data_abertura -> data_conclusao (inclui espera e pausas = tempo de parada)
  //  - mtta        : média de data_abertura -> aceite (1ª entrada em EM_ANDAMENTO)
  // `serie` é DENSA (todos os dias/semanas/meses do período, com zeros) e traz `abertas` (por data_abertura);
  // com comparar=true devolve `anterior` com a mesma forma, alinhado por posição.
  type Gran = 'day' | 'week' | 'month';
  async function mttrPeriodo(f: Filtros, de: Date, ate: Date, gran: Gran) {
    const { tec, pri } = trechos(f);
    const { setor, tipo } = f;
    // GROUPING() identifica o agrupamento de cada linha (bit 1 = coluna fora do agrupamento).
    const G = { SERIE: 15, SETOR: 23, CATEGORIA: 27, PRIORIDADE: 29, TECNICO: 30, GERAL: 31 } as const;
    const linhas = await prisma.$queryRaw<
      { g: number; bucket: Date | null; setor: string | null; categoria: string | null; prioridade: string | null;
        tecnico_id: bigint | null; tecnico: string | null; os: number; liquido: number; total: number; mtta: number | null }[]
    >`
      WITH t AS (
        SELECT o.ordem_id AS id, e.setor, o.categoria, o.prioridade::text AS prioridade, o.responsavel_id AS tecnico_id, u.nome AS tecnico,
               date_trunc(${gran}::text, o.data_conclusao AT TIME ZONE ${TZ}::text)::date AS bucket, -- dia local
               o.parada_segundos AS total, o.mtta_segundos AS mtta, o.mttr_segundos AS liquido
          FROM vw_om_tempos o
          JOIN equipamentos e ON e.id = o.equipamento_id
          LEFT JOIN usuarios u ON u.id = o.responsavel_id
         WHERE o.status = 'CONCLUIDA'
           AND o.tipo = ${tipo}::tipo_manutencao
           AND o.data_conclusao >= ${de}::timestamptz AND o.data_conclusao < ${ate}::timestamptz
           AND (${setor}::text IS NULL OR e.setor = ${setor}::text) ${tec} ${pri}
      )
      SELECT GROUPING(bucket, setor, categoria, prioridade, tecnico_id)::int AS g,
             bucket, setor, categoria, prioridade, tecnico_id, max(tecnico) AS tecnico,
             count(*)::int AS os,
             avg(liquido)::float8 AS liquido, avg(total)::float8 AS total, avg(mtta)::float8 AS mtta
        FROM t
       GROUP BY GROUPING SETS ((bucket), (setor), (categoria), (prioridade), (tecnico_id), ())`;

    // Fluxo de entrada: OMs ABERTAS no período (por data_abertura), exceto CANCELADA. Fluxo é da equipe: não filtra por técnico.
    const abertas = await prisma.$queryRaw<{ bucket: Date; n: number }[]>`
      SELECT date_trunc(${gran}::text, o.data_abertura AT TIME ZONE ${TZ}::text)::date AS bucket, count(*)::int AS n
        FROM ordens_manutencao o JOIN equipamentos e ON e.id = o.equipamento_id
       WHERE o.status <> 'CANCELADA' AND o.tipo = ${tipo}::tipo_manutencao
         AND o.data_abertura >= ${de}::timestamptz AND o.data_abertura < ${ate}::timestamptz
         AND (${setor}::text IS NULL OR e.setor = ${setor}::text) ${trechos(f, { tecnico: false }).pri}
       GROUP BY 1`;
    // Todos os intervalos do período (denso): é o que permite alinhar o período anterior por posição.
    const todos = await prisma.$queryRaw<{ bucket: Date }[]>`
      SELECT d::date AS bucket FROM generate_series(
        date_trunc(${gran}::text, ${de}::timestamptz AT TIME ZONE ${TZ}::text),
        date_trunc(${gran}::text, (${ate}::timestamptz - interval '1 millisecond') AT TIME ZONE ${TZ}::text),
        ('1 ' || ${gran}::text)::interval) AS d`;

    type Linha = (typeof linhas)[number];
    const fmt = (r: Linha) => ({
      ordensConcluidas: r.os,
      mttrLiquidoSegundos: num(r.liquido),
      mttrTotalSegundos: num(r.total),
      mttaSegundos: num(r.mtta),
    });
    const pior = (a: Linha, b: Linha) => (b.total ?? 0) - (a.total ?? 0);
    const ORDEM_PRIORIDADE = ['BAIXA', 'MEDIA', 'ALTA', 'CRITICA']; // rampa ordinal do Dashboard
    const dia = (d: Date) => d.toISOString().slice(0, 10);
    const porBucket = new Map(linhas.filter((r) => r.g === G.SERIE).map((r) => [dia(r.bucket!), r]));
    const abertasPor = new Map(abertas.map((a) => [dia(a.bucket), a.n]));
    const geral = linhas.find((r) => r.g === G.GERAL);
    return {
      geral: geral && geral.os > 0 ? fmt(geral) : { ordensConcluidas: 0, mttrLiquidoSegundos: null, mttrTotalSegundos: null, mttaSegundos: null },
      serie: todos.map((t) => {
        const k = dia(t.bucket);
        const r = porBucket.get(k);
        return {
          periodo: k, // início do dia/semana/mês (fuso local)
          abertas: abertasPor.get(k) ?? 0,
          ...(r ? fmt(r) : { ordensConcluidas: 0, mttrLiquidoSegundos: null, mttrTotalSegundos: null, mttaSegundos: null }),
        };
      }),
      porSetor: linhas.filter((r) => r.g === G.SETOR).sort(pior).map((r) => ({ setor: r.setor, ...fmt(r) })),
      porCategoria: linhas.filter((r) => r.g === G.CATEGORIA).sort(pior).map((r) => ({ categoria: r.categoria, ...fmt(r) })),
      porPrioridade: linhas
        .filter((r) => r.g === G.PRIORIDADE)
        .sort((a, b) => ORDEM_PRIORIDADE.indexOf(a.prioridade!) - ORDEM_PRIORIDADE.indexOf(b.prioridade!))
        .map((r) => ({ prioridade: r.prioridade, ...fmt(r) })),
      porTecnico: linhas
        .filter((r) => r.g === G.TECNICO && r.tecnico_id !== null) // OM concluída sem responsável não entra
        .sort(pior)
        .map((r) => ({ tecnicoId: r.tecnico_id, tecnico: r.tecnico, ...fmt(r) })),
    };
  }

  app.get('/metricas/mttr', async (req, reply) => {
    const f = parseFiltros(req.query);
    const { granularidade } = mttrQuery.parse(req.query);
    const atual = await mttrPeriodo(f, f.de, f.ate, granularidade);
    const ant = f.anterior ? await mttrPeriodo(f, f.anterior.de, f.anterior.ate, granularidade) : null;
    const geradoEm = new Date().toISOString();
    reply.header('X-Gerado-Em', geradoEm);
    return toJSON({
      geradoEm,
      periodo: { de: f.de, ate: f.ate },
      filtros: { tipo: f.tipo, setor: f.setor, granularidade, fuso: TZ, tecnicoIds: f.tecnicoIds, prioridade: f.prioridades },
      ...atual,
      // período anterior (mesma duração), `serie` alinhada por posição com a atual
      ...(ant && { periodoAnterior: f.anterior, geralAnterior: ant.geral, anterior: ant.serie }),
    });
  });

  // ---------- 2) Principais ofensores ----------
  // Base: OMs abertas no período (exceto CANCELADA). Tempo de parada = abertura -> conclusão (ou agora, se aberta).
  app.get('/metricas/ofensores', async (req, reply) => {
    const f = parseFiltros(req.query);
    const { de, ate, setor } = f;
    const { tec, pri } = trechos(f);
    const { agrupar, ordenarPor, limit } = ofensoresQuery.parse(req.query);

    const rows = await prisma.$queryRaw<
      { chave: string; rotulo: string; ocorrencias: number; paradas: number; tempo_parada: number; tempo_liquido: number }[]
    >`
      SELECT chave, rotulo,
             count(*)::int AS ocorrencias,
             count(*) FILTER (WHERE prioridade = 'CRITICA')::int AS paradas,
             COALESCE(sum(parada), 0)::float8 AS tempo_parada,
             COALESCE(sum(liquido), 0)::float8 AS tempo_liquido
        FROM (
          SELECT o.prioridade,
                 CASE ${agrupar}::text WHEN 'equipamento' THEN e.codigo WHEN 'categoria' THEN (CASE WHEN o.categoria IN (${Prisma.join(CATEGORIAS)}) THEN o.categoria ELSE 'OUTROS' END) ELSE e.setor END AS chave,
                 CASE ${agrupar}::text WHEN 'equipamento' THEN e.nome   WHEN 'categoria' THEN (CASE WHEN o.categoria IN (${Prisma.join(CATEGORIAS)}) THEN o.categoria ELSE 'OUTROS' END) ELSE e.setor END AS rotulo,
                 EXTRACT(EPOCH FROM (COALESCE(o.data_conclusao, now()) - o.data_abertura)) AS parada,
                 (SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(a.fim, now()) - a.inicio)))
                    FROM om_apontamentos_tempo a WHERE a.ordem_id = o.id AND a.deletado_em IS NULL) AS liquido
            FROM ordens_manutencao o
            JOIN equipamentos e ON e.id = o.equipamento_id
           WHERE o.status <> 'CANCELADA'
             AND o.data_abertura >= ${de} AND o.data_abertura < ${ate}
             AND (${setor}::text IS NULL OR e.setor = ${setor}::text) ${tec} ${pri}
        ) x
       GROUP BY chave, rotulo
       ORDER BY CASE ${ordenarPor}::text WHEN 'tempo_parada' THEN COALESCE(sum(parada), 0) ELSE count(*) END DESC, chave
       LIMIT ${limit}`;

    const geradoEm = new Date().toISOString();
    reply.header('X-Gerado-Em', geradoEm);
    return toJSON({
      geradoEm,
      periodo: { de, ate },
      filtros: { agrupar, ordenarPor, setor, tecnicoIds: f.tecnicoIds, prioridade: f.prioridades },
      itens: rows.map((r, i) => ({
        posicao: i + 1,
        chave: r.chave,
        rotulo: r.rotulo,
        ocorrencias: r.ocorrencias,
        maquinaParada: r.paradas,
        tempoParadaSegundos: Math.round(r.tempo_parada),
        tempoReparoLiquidoSegundos: Math.round(r.tempo_liquido),
      })),
    });
  });

  // ---------- 3) Ranking de pausas ----------
  // Fonte: historico_status_ordem (V004). Cada entrada em PAUSADA dura até o próximo evento da mesma OM
  // (ou até agora, se a pausa ainda está em curso).
  app.get('/metricas/pausas', async (req, reply) => {
    const f = parseFiltros(req.query);
    // top=N: os N maiores motivos (por tempo total) + `outros` já SOMADO no servidor (pizza de N+1 fatias)
    const { top } = z.object({ top: z.coerce.number().int().min(1).max(10).optional() }).parse(req.query);
    const { de, ate, setor } = f;
    const { tec, pri } = trechos(f);

    const rows = await prisma.$queryRaw<
      { motivo: string; pausas: number; em_curso: number; total: number; media: number; maxima: number }[]
    >`
      WITH h AS (
        SELECT ordem_id, status_novo, motivo, criado_em,
               LEAD(criado_em) OVER (PARTITION BY ordem_id ORDER BY criado_em, id) AS proximo
          FROM historico_status_ordem
      )
      SELECT (CASE WHEN btrim(split_part(h.motivo, ':', 1)) IN (${Prisma.join(MOTIVOS_PAUSA)}) THEN btrim(split_part(h.motivo, ':', 1)) ELSE 'OUTRO' END) AS motivo,
             count(*)::int AS pausas,
             count(*) FILTER (WHERE h.proximo IS NULL)::int AS em_curso,
             sum(EXTRACT(EPOCH FROM (COALESCE(h.proximo, now()) - h.criado_em)))::float8 AS total,
             avg(EXTRACT(EPOCH FROM (COALESCE(h.proximo, now()) - h.criado_em)))::float8 AS media,
             max(EXTRACT(EPOCH FROM (COALESCE(h.proximo, now()) - h.criado_em)))::float8 AS maxima
        FROM h
        JOIN ordens_manutencao o ON o.id = h.ordem_id
        JOIN equipamentos e ON e.id = o.equipamento_id
       WHERE h.status_novo = 'PAUSADA'
         AND h.criado_em >= ${de} AND h.criado_em < ${ate}
         AND (${setor}::text IS NULL OR e.setor = ${setor}::text) ${tec} ${pri}
       GROUP BY 1
       ORDER BY total DESC, motivo`;

    const totalPausas = rows.reduce((t, r) => t + r.pausas, 0);
    const totalSeg = rows.reduce((t, r) => t + r.total, 0);
    const item = (r: (typeof rows)[number], i: number) => ({
      posicao: i + 1,
      motivo: r.motivo,
      pausas: r.pausas,
      emCurso: r.em_curso,
      tempoTotalSegundos: Math.round(r.total),
      tempoMedioSegundos: Math.round(r.media),
      tempoMaximoSegundos: Math.round(r.maxima),
      percentualDoTempo: totalSeg > 0 ? num((r.total / totalSeg) * 100) : 0,
    });
    const visiveis = top ? rows.slice(0, top) : rows;
    const resto = top ? rows.slice(top) : [];
    const geradoEm = new Date().toISOString();
    reply.header('X-Gerado-Em', geradoEm);
    return toJSON({
      geradoEm,
      periodo: { de, ate },
      filtros: { setor, tecnicoIds: f.tecnicoIds, prioridade: f.prioridades, top: top ?? null },
      totalPausas,
      tempoTotalPausadoSegundos: Math.round(totalSeg),
      itens: visiveis.map(item),
      // Só com top=N e se houver mais motivos do que N; os percentuais continuam sobre o TOTAL (fatias somam 100).
      outros: resto.length === 0 ? null : {
        motivos: resto.length,
        pausas: resto.reduce((t, r) => t + r.pausas, 0),
        emCurso: resto.reduce((t, r) => t + r.em_curso, 0),
        tempoTotalSegundos: Math.round(resto.reduce((t, r) => t + r.total, 0)),
        percentualDoTempo: totalSeg > 0 ? num((resto.reduce((t, r) => t + r.total, 0) / totalSeg) * 100) : 0,
      },
    });
  });
};
