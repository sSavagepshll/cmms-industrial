import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db.js';
import { assinar } from '../events.js';
import { painelAdmin } from '../plugins/rbac.js';
import { lerMetas, lerPoliticas, zonaMta, zonaMttr } from '../regras.js';
import { toJSON } from '../serialize.js';
import {
  DIA_MS, PRIORIDADES, chaveQuery, comCache, limparCacheMetricas, parseFiltros, pct, r1, trechos, variacaoPct, variacaoPp,
  type Filtros,
} from '../metricas/filtros.js';

// Dashboard de desempenho da equipe (Fase 18). Princípio ético (doc UX §2): sem ranking nem score individual,
// média individual só com amostra mínima, metas são da EQUIPE. Todos os endpoints: GERENTE/ADMIN.
const AMOSTRA_MIN = 5;

/** D8: todo endpoint do painel informa quando o dado foi GERADO (header X-Gerado-Em e, no corpo, `geradoEm`). Dado em cache mantém o instante original. */
const comGerado = <T extends object>(v: T) => ({ ...v, geradoEm: new Date().toISOString() });
/** toJSON (BigInt -> string) preservando o tipo, para o cache/`enviar` enxergarem `geradoEm`. */
const gerarJson = <T extends object>(v: T): T => toJSON(v) as T;
const enviar = <T extends { geradoEm?: string }>(reply: { header: (k: string, v: string) => unknown }, v: T): T => {
  if (v.geradoEm) reply.header('X-Gerado-Em', v.geradoEm);
  return v;
};
const SERIE_MAX_PONTOS = 30;

// Qualquer evento de OM invalida o cache do servidor (o cliente relê após o SSE e não pode receber dado velho).
let ouvindo = false;
function ouvirEventos() {
  if (ouvindo) return;
  ouvindo = true;
  assinar(() => limparCacheMetricas());
}

/** Intervalos do sparkline: no máximo 30 pontos (largura em dias = ceil(dias / 30)). */
function intervalos(de: Date, ate: Date) {
  const dias = Math.max(1, Math.ceil((ate.getTime() - de.getTime()) / DIA_MS));
  const larguraDias = Math.max(1, Math.ceil(dias / SERIE_MAX_PONTOS));
  const bucketSeg = larguraDias * 86_400;
  const n = Math.max(1, Math.ceil((ate.getTime() - de.getTime()) / 1000 / bucketSeg));
  return { larguraDias, bucketSeg, n };
}
type Bk = ReturnType<typeof intervalos>;
const vazia = (n: number): (number | null)[] => Array.from({ length: n }, () => null);

interface Periodo {
  conc: { n: number; liquido: number | null; parada: number | null; mtta: number | null };
  abertas: number;
  retrab: { entradas: number; reprov: number };
  recusa: { delegacoes: number; recusas: number };
  serie: {
    mttrLiquido: (number | null)[]; mtta: (number | null)[]; parada: (number | null)[];
    concluidas: (number | null)[]; retrabalho: (number | null)[]; recusa: (number | null)[]; abertas: (number | null)[];
  };
}

/** Todas as métricas de UM período [de, ate) com os filtros (e a série curta alinhada por intervalo). */
async function calcPeriodo(f: Filtros, de: Date, ate: Date, bk: Bk): Promise<Periodo> {
  const { tec, pri } = trechos(f);
  const bs = bk.bucketSeg;

  const conc = await prisma.$queryRaw<
    { g: number; b: number | null; n: number; liquido: number | null; parada: number | null; mtta: number | null }[]
  >`
    WITH c AS (
      SELECT FLOOR(EXTRACT(EPOCH FROM (o.data_conclusao - ${de}::timestamptz)) / ${bs}::float8)::int AS b,
             o.parada_segundos AS parada, o.mtta_segundos AS mtta, o.mttr_segundos AS liquido
        FROM vw_om_tempos o
       WHERE o.status = 'CONCLUIDA' AND o.tipo = ${f.tipo}::tipo_manutencao
         AND o.data_conclusao >= ${de}::timestamptz AND o.data_conclusao < ${ate}::timestamptz ${tec} ${pri}
    )
    SELECT GROUPING(b)::int AS g, b, count(*)::int AS n, avg(liquido)::float8 AS liquido, avg(parada)::float8 AS parada,
           avg(mtta)::float8 AS mtta
      FROM c GROUP BY ROLLUP (b)`;

  // Retrabalho: transições para AGUARDANDO_APROVACAO (base) e AGUARDANDO_APROVACAO -> EM_ANDAMENTO (reprovações). CANCELADA fora.
  const trans = await prisma.$queryRaw<{ g: number; b: number | null; entradas: number; reprov: number }[]>`
    SELECT GROUPING(b)::int AS g, b, (count(*) FILTER (WHERE entrada))::int AS entradas, (count(*) FILTER (WHERE reprov))::int AS reprov
      FROM (
        SELECT FLOOR(EXTRACT(EPOCH FROM (h.criado_em - ${de}::timestamptz)) / ${bs}::float8)::int AS b,
               (h.status_novo = 'AGUARDANDO_APROVACAO') AS entrada,
               (h.status_anterior = 'AGUARDANDO_APROVACAO' AND h.status_novo = 'EM_ANDAMENTO') AS reprov
          FROM historico_status_ordem h
          JOIN ordens_manutencao o ON o.id = h.ordem_id
         WHERE h.criado_em >= ${de}::timestamptz AND h.criado_em < ${ate}::timestamptz
           AND h.status_novo IN ('AGUARDANDO_APROVACAO', 'EM_ANDAMENTO')
           AND o.status <> 'CANCELADA' AND o.tipo = ${f.tipo}::tipo_manutencao ${tec} ${pri}
      ) x GROUP BY ROLLUP (b)`;

  // Recusa de delegação: FONTE = tabela de auditoria (gravada na mesma transação da ação; existe desde a V011).
  const tecAud = f.tecnicoIds.length > 0
    ? Prisma.sql`AND (CASE WHEN a.acao = 'OM_RECUSADA' THEN a.ator_id ELSE (a.detalhe->>'tecnicoId')::bigint END) IN (${Prisma.join(f.tecnicoIds)})`
    : Prisma.empty;
  const aud = await prisma.$queryRaw<{ g: number; b: number | null; recusas: number; delegacoes: number }[]>`
    SELECT GROUPING(b)::int AS g, b, (count(*) FILTER (WHERE acao = 'OM_RECUSADA'))::int AS recusas,
           (count(*) FILTER (WHERE acao IN ('OM_DELEGADA', 'OM_REATRIBUIDA')))::int AS delegacoes
      FROM (
        SELECT FLOOR(EXTRACT(EPOCH FROM (a.criado_em - ${de}::timestamptz)) / ${bs}::float8)::int AS b, a.acao
          FROM auditoria a
          JOIN ordens_manutencao o ON a.alvo_tipo = 'OM' AND a.alvo_id ~ '^[0-9]+$'
                                  AND o.id = (CASE WHEN a.alvo_id ~ '^[0-9]+$' THEN a.alvo_id::bigint END)
         WHERE a.criado_em >= ${de}::timestamptz AND a.criado_em < ${ate}::timestamptz
           AND a.acao IN ('OM_RECUSADA', 'OM_DELEGADA', 'OM_REATRIBUIDA')
           AND o.status <> 'CANCELADA' AND o.tipo = ${f.tipo}::tipo_manutencao ${pri} ${tecAud}
      ) x GROUP BY ROLLUP (b)`;

  // Fluxo de entrada (D1): OMs abertas no período, exceto CANCELADA. Fluxo é da equipe: não filtra por técnico.
  const { pri: priAb } = trechos(f, { tecnico: false });
  const abertas = await prisma.$queryRaw<{ g: number; b: number | null; n: number }[]>`
    SELECT GROUPING(b)::int AS g, b, count(*)::int AS n
      FROM (
        SELECT FLOOR(EXTRACT(EPOCH FROM (o.data_abertura - ${de}::timestamptz)) / ${bs}::float8)::int AS b
          FROM ordens_manutencao o
         WHERE o.status <> 'CANCELADA' AND o.tipo = ${f.tipo}::tipo_manutencao
           AND o.data_abertura >= ${de}::timestamptz AND o.data_abertura < ${ate}::timestamptz ${priAb}
      ) x GROUP BY ROLLUP (b)`;

  const tot = conc.find((r) => r.g === 1);
  const serie = {
    mttrLiquido: vazia(bk.n), mtta: vazia(bk.n), parada: vazia(bk.n),
    concluidas: vazia(bk.n).map(() => 0 as number | null), retrabalho: vazia(bk.n), recusa: vazia(bk.n),
    abertas: vazia(bk.n).map(() => 0 as number | null),
  };
  for (const r of conc) {
    if (r.g === 1 || r.b === null || r.b < 0 || r.b >= bk.n) continue;
    serie.concluidas[r.b] = r.n; serie.mttrLiquido[r.b] = r1(r.liquido); serie.mtta[r.b] = r1(r.mtta); serie.parada[r.b] = r1(r.parada);
  }
  for (const r of abertas) if (r.g === 0 && r.b !== null && r.b >= 0 && r.b < bk.n) serie.abertas[r.b] = r.n;
  for (const r of trans) if (r.g === 0 && r.b !== null && r.b >= 0 && r.b < bk.n) serie.retrabalho[r.b] = pct(r.reprov, r.entradas);
  for (const r of aud) if (r.g === 0 && r.b !== null && r.b >= 0 && r.b < bk.n) serie.recusa[r.b] = pct(r.recusas, r.delegacoes);

  const tt = trans.find((r) => r.g === 1);
  const ta = aud.find((r) => r.g === 1);
  return {
    conc: { n: tot?.n ?? 0, liquido: r1(tot?.liquido), parada: r1(tot?.parada), mtta: r1(tot?.mtta) },
    abertas: abertas.find((r) => r.g === 1)?.n ?? 0,
    retrab: { entradas: tt?.entradas ?? 0, reprov: tt?.reprov ?? 0 },
    recusa: { delegacoes: ta?.delegacoes ?? 0, recusas: ta?.recusas ?? 0 },
    serie,
  };
}

async function backlogAgora(f: Filtros) {
  const { pri } = trechos(f, { tecnico: false }); // backlog é da EQUIPE: ignora tecnicoIds (OM aberta nem tem técnico) e o período
  const rows = await prisma.$queryRaw<{ status: string; prioridade: string; faixa: string; n: number }[]>`
    SELECT o.status::text AS status, o.prioridade::text AS prioridade,
           CASE WHEN now() - o.data_abertura < interval '1 hour'  THEN '<1h'
                WHEN now() - o.data_abertura < interval '4 hours' THEN '1-4h'
                WHEN now() - o.data_abertura < interval '8 hours' THEN '4-8h'
                ELSE '>8h' END AS faixa,
           count(*)::int AS n
      FROM ordens_manutencao o
     WHERE o.status IN ('ABERTA', 'RESERVADA', 'EM_ANDAMENTO', 'PAUSADA', 'AGUARDANDO_PECA', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_BAIXA')
       AND o.tipo = ${f.tipo}::tipo_manutencao ${pri}
     GROUP BY 1, 2, 3`;
  const porStatus = { aguardandoTecnico: 0, emAtendimento: 0, pausadas: 0, aguardandoAprovacao: 0, aguardandoConclusao: 0 };
  const porIdade = new Map([['<1h', 0], ['1-4h', 0], ['4-8h', 0], ['>8h', 0]]);
  const porPrioridade: Record<string, number> = { CRITICA: 0, ALTA: 0, MEDIA: 0, BAIXA: 0 };
  for (const r of rows) {
    if (r.status === 'ABERTA' || r.status === 'RESERVADA') porStatus.aguardandoTecnico += r.n;
    else if (r.status === 'EM_ANDAMENTO') porStatus.emAtendimento += r.n;
    else if (r.status === 'PAUSADA' || r.status === 'AGUARDANDO_PECA') porStatus.pausadas += r.n;
    else if (r.status === 'AGUARDANDO_APROVACAO') porStatus.aguardandoAprovacao += r.n;
    else if (r.status === 'AGUARDANDO_BAIXA') porStatus.aguardandoConclusao += r.n;
    porIdade.set(r.faixa, (porIdade.get(r.faixa) ?? 0) + r.n);
    porPrioridade[r.prioridade] = (porPrioridade[r.prioridade] ?? 0) + r.n;
  }
  const total = Object.values(porStatus).reduce((a, b) => a + b, 0);
  return {
    total, criticas: porPrioridade.CRITICA ?? 0, porStatus,
    porIdade: [...porIdade].map(([faixa, n]) => ({ faixa, n })), porPrioridade,
  };
}

export const desempenhoRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', painelAdmin);
  ouvirEventos();

  // ---------- KPIs (faixa de cartões + sparklines) ----------
  app.get('/metricas/kpis', async (req, reply) => {
    const f = parseFiltros(req.query);
    return enviar(reply, await comCache(chaveQuery('kpis', req.query), async () => {
      const bk = intervalos(f.de, f.ate);
      const atual = await calcPeriodo(f, f.de, f.ate, bk);
      const ant = f.anterior ? await calcPeriodo(f, f.anterior.de, f.anterior.ate, bk) : null;

      const valor = (a: number | null, b: number | null | undefined, serie: (number | null)[], extra: object) => ({
        valor: a, anterior: ant ? (b ?? null) : null, variacaoPct: ant ? variacaoPct(a, b ?? null) : null, ...extra, serie,
      });
      const taxa = (parte: number, base: number, a2: { p: number; b: number } | null, serie: (number | null)[]) => {
        const v = pct(parte, base);
        const anterior = a2 ? pct(a2.p, a2.b) : null;
        return { valor: v, anterior, variacaoPp: a2 ? variacaoPp(v, anterior) : null, base, serie };
      };
      const am = atual.conc.n;
      return gerarJson(comGerado({
        periodo: { de: f.de, ate: f.ate },
        anterior: f.anterior,
        serieBucketDias: bk.larguraDias,
        kpis: {
          // MTTR (US-12 §2): aceite -> conclusão menos o tempo em PAUSADA/AGUARDANDO_PECA/AGUARDANDO_APROVACAO
          mttrLiquidoSegundos: valor(am > 0 ? atual.conc.liquido : null, ant?.conc.liquido, atual.serie.mttrLiquido, { amostra: am }),
          mttaSegundos: valor(am > 0 ? atual.conc.mtta : null, ant?.conc.mtta, atual.serie.mtta, { amostra: am }),
          tempoParadaSegundos: valor(am > 0 ? atual.conc.parada : null, ant?.conc.parada, atual.serie.parada, { amostra: am }),
          abertas: {
            valor: atual.abertas, anterior: ant ? ant.abertas : null, variacaoPct: ant ? variacaoPct(atual.abertas, ant.abertas) : null, serie: atual.serie.abertas,
          },
          concluidas: {
            valor: am, anterior: ant ? ant.conc.n : null, variacaoPct: ant ? variacaoPct(am, ant.conc.n) : null, serie: atual.serie.concluidas,
          },
          retrabalhoPct: taxa(atual.retrab.reprov, atual.retrab.entradas, ant ? { p: ant.retrab.reprov, b: ant.retrab.entradas } : null, atual.serie.retrabalho),
          recusaPct: taxa(atual.recusa.recusas, atual.recusa.delegacoes, ant ? { p: ant.recusa.recusas, b: ant.recusa.delegacoes } : null, atual.serie.recusa),
        },
        backlog: await backlogAgora(f).then((b) => ({ total: b.total, criticas: b.criticas })), // foto de agora
      }));
    }));
  });

  // ---------- Cumprimento da meta de MTTA (+ meta de MTTR e limiares de zona para os velocímetros) ----------
  // Nada configurado => EXATAMENTE { configurada: false } (o X-Gerado-Em segue no header).
  // Só a meta de MTTR (sem MTTA) => { configurada: false, metaMttrSegundos, mttr, zonas }.
  app.get('/metricas/meta', async (req, reply) => {
    const f = parseFiltros(req.query);
    const gerado = new Date().toISOString();
    const r = await comCache(chaveQuery('meta', req.query), async () => {
      const metas = await lerMetas();
      const prios = (f.prioridades.length ? f.prioridades : PRIORIDADES).filter((p) => metas.mtta[p] !== null);
      const algumaMtta = PRIORIDADES.some((p) => metas.mtta[p] !== null);
      if (!algumaMtta && metas.mttr === null) return { corpo: { configurada: false } as Record<string, unknown>, geradoEm: gerado };

      // Velocímetro do MTTR: valor médio do período em % da meta (limiares em `zonas`; a classificação é do cliente).
      let mttr: Record<string, unknown> | null = null;
      if (metas.mttr !== null) {
        const bk = intervalos(f.de, f.ate);
        const cur = await calcPeriodo(f, f.de, f.ate, bk);
        const ant = f.anterior ? await calcPeriodo(f, f.anterior.de, f.anterior.ate, bk) : null;
        const pctMeta = (v: number | null, n: number) => (v !== null && n > 0 ? Math.round((v / metas.mttr!) * 1000) / 10 : null);
        mttr = {
          metaSegundos: metas.mttr,
          valorSegundos: cur.conc.n > 0 ? cur.conc.liquido : null,
          pctDaMeta: pctMeta(cur.conc.liquido, cur.conc.n),
          amostra: cur.conc.n,
          anteriorPctDaMeta: ant ? pctMeta(ant.conc.liquido, ant.conc.n) : null,
          zona: zonaMttr(pctMeta(cur.conc.liquido, cur.conc.n), metas.zonas),
        };
      }
      const base = { metaMttrSegundos: metas.mttr, mttr, zonas: metas.zonas };
      if (!algumaMtta) return { corpo: { configurada: false, ...base }, geradoEm: gerado };

      const calc = async (de: Date, ate: Date) => {
        const { tec } = trechos(f);
        return prisma.$queryRaw<{ prioridade: string; total: number; dentro: number }[]>`
          SELECT o.prioridade::text AS prioridade, count(*)::int AS total,
                 (count(*) FILTER (WHERE o.mtta_segundos <=
                    (CASE o.prioridade::text WHEN 'CRITICA' THEN ${metas.mtta.CRITICA}::float8 WHEN 'ALTA' THEN ${metas.mtta.ALTA}::float8
                                             WHEN 'MEDIA' THEN ${metas.mtta.MEDIA}::float8 ELSE ${metas.mtta.BAIXA}::float8 END)))::int AS dentro
            FROM vw_om_tempos o
           WHERE o.status = 'CONCLUIDA' AND o.tipo = ${f.tipo}::tipo_manutencao
             AND o.data_conclusao >= ${de}::timestamptz AND o.data_conclusao < ${ate}::timestamptz
             AND o.mtta_segundos IS NOT NULL AND o.prioridade::text::text IN (${Prisma.join(prios.length ? prios : ['_'])}) ${tec}
           GROUP BY 1`;
      };
      const rows = await calc(f.de, f.ate);
      const total = rows.reduce((t, x) => t + x.total, 0);
      const dentro = rows.reduce((t, x) => t + x.dentro, 0);
      let anteriorPct: number | null = null;
      if (f.anterior) {
        const ra = await calc(f.anterior.de, f.anterior.ate);
        anteriorPct = pct(ra.reduce((t, x) => t + x.dentro, 0), ra.reduce((t, x) => t + x.total, 0));
      }
      return {
        corpo: {
          configurada: true,
          metasMttaSegundos: { CRITICA: metas.mtta.CRITICA, ALTA: metas.mtta.ALTA, MEDIA: metas.mtta.MEDIA, BAIXA: metas.mtta.BAIXA },
          ...base,
          geral: { dentroDaMeta: dentro, total, pct: pct(dentro, total), anteriorPct, zona: zonaMta(pct(dentro, total), metas.zonas) },
          // só prioridades que têm meta; ordem do doc (mais urgente primeiro)
          porPrioridade: prios.map((p) => {
            const x = rows.find((y) => y.prioridade === p);
            return { prioridade: p, dentroDaMeta: x?.dentro ?? 0, total: x?.total ?? 0, pct: pct(x?.dentro ?? 0, x?.total ?? 0) };
          }).sort((a, b) => PRIORIDADES.indexOf(b.prioridade) - PRIORIDADES.indexOf(a.prioridade)),
        } as Record<string, unknown>,
        geradoEm: gerado,
      };
    });
    reply.header('X-Gerado-Em', r.geradoEm);
    // mínimo { configurada:false } fica exato; os demais corpos levam `geradoEm`
    return Object.keys(r.corpo).length === 1 ? r.corpo : toJSON({ ...r.corpo, geradoEm: r.geradoEm });
  });

  // ---------- Equipe: carga agora + contexto do período (SEM ranking, SEM score) ----------
  app.get('/metricas/equipe', async (req, reply) => {
    const f = parseFiltros(req.query);
    return enviar(reply, await comCache(chaveQuery('equipe', req.query), async () => {
      const { pri } = trechos(f, { tecnico: false });
      const usuarios = await prisma.usuario.findMany({
        where: { ativo: true, perfil: { in: ['TECNICO', 'GERENTE', 'ADMIN'] }, ...(f.tecnicoIds.length > 0 && { id: { in: f.tecnicoIds } }) },
        select: { id: true, nome: true, perfil: true },
      });
      const ids = usuarios.map((u) => u.id);
      if (ids.length === 0) return comGerado({ tecnicos: [] });
      const lista = Prisma.join(ids);

      const [carga, atuais, conc, retr, horas] = await Promise.all([
        prisma.ordem.groupBy({
          by: ['responsavelId', 'status'],
          where: { responsavelId: { in: ids }, status: { in: ['EM_ANDAMENTO', 'RESERVADA', 'PAUSADA', 'AGUARDANDO_PECA'] } },
          _count: { _all: true },
        }),
        prisma.$queryRaw<{ tecnico_id: bigint; ordem_id: bigint; numero: string; equipamento: string; inicio: Date }[]>`
          SELECT DISTINCT ON (a.tecnico_id) a.tecnico_id, o.id AS ordem_id, o.numero_formatado AS numero, e.codigo AS equipamento, a.inicio
            FROM om_apontamentos_tempo a
            JOIN ordens_manutencao o ON o.id = a.ordem_id
            JOIN equipamentos e ON e.id = o.equipamento_id
           WHERE a.fim IS NULL AND a.deletado_em IS NULL AND a.tecnico_id IN (${lista})
           ORDER BY a.tecnico_id, a.inicio DESC`,
        prisma.$queryRaw<{ tecnico_id: bigint; n: number; liquido: number; mtta: number | null }[]>`
          SELECT o.responsavel_id AS tecnico_id, count(*)::int AS n,
                 avg(o.mttr_segundos)::float8 AS liquido, avg(o.mtta_segundos)::float8 AS mtta
            FROM vw_om_tempos o
           WHERE o.status = 'CONCLUIDA' AND o.tipo = ${f.tipo}::tipo_manutencao AND o.responsavel_id IN (${lista})
             AND o.data_conclusao >= ${f.de}::timestamptz AND o.data_conclusao < ${f.ate}::timestamptz ${pri}
           GROUP BY 1`,
        prisma.$queryRaw<{ tecnico_id: bigint; entradas: number; reprov: number }[]>`
          SELECT o.responsavel_id AS tecnico_id, (count(*) FILTER (WHERE h.status_novo = 'AGUARDANDO_APROVACAO'))::int AS entradas,
                 (count(*) FILTER (WHERE h.status_anterior = 'AGUARDANDO_APROVACAO' AND h.status_novo = 'EM_ANDAMENTO'))::int AS reprov
            FROM historico_status_ordem h JOIN ordens_manutencao o ON o.id = h.ordem_id
           WHERE h.criado_em >= ${f.de}::timestamptz AND h.criado_em < ${f.ate}::timestamptz
             AND h.status_novo IN ('AGUARDANDO_APROVACAO', 'EM_ANDAMENTO') AND o.responsavel_id IN (${lista})
             AND o.status <> 'CANCELADA' AND o.tipo = ${f.tipo}::tipo_manutencao ${pri}
           GROUP BY 1`,
        prisma.$queryRaw<{ tecnico_id: bigint; seg: number; retro: number }[]>`
          SELECT a.tecnico_id,
                 COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(a.fim, now()) - a.inicio))), 0)::float8 AS seg,
                 COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(a.fim, now()) - a.inicio))) FILTER (WHERE a.origem = 'RETROATIVO'), 0)::float8 AS retro
            FROM om_apontamentos_tempo a JOIN ordens_manutencao o ON o.id = a.ordem_id
           WHERE a.deletado_em IS NULL AND a.tecnico_id IN (${lista})
             AND a.inicio >= ${f.de}::timestamptz AND a.inicio < ${f.ate}::timestamptz
             AND o.status <> 'CANCELADA' AND o.tipo = ${f.tipo}::tipo_manutencao ${pri}
           GROUP BY 1`,
      ]);

      const tecnicos = usuarios.flatMap((u) => {
        const c = (st: string[]) => carga.filter((x) => x.responsavelId === u.id && st.includes(x.status)).reduce((t, x) => t + x._count._all, 0);
        const emAtendimento = c(['EM_ANDAMENTO']), reservadas = c(['RESERVADA']), pausadas = c(['PAUSADA', 'AGUARDANDO_PECA']);
        const at = atuais.find((x) => x.tecnico_id === u.id);
        const k = conc.find((x) => x.tecnico_id === u.id);
        const rt = retr.find((x) => x.tecnico_id === u.id);
        const hr = horas.find((x) => x.tecnico_id === u.id);
        const concluidas = k?.n ?? 0;
        // Gerente/admin só aparece na lista se de fato atendeu algo; TECNICO ativo sempre aparece.
        if (u.perfil !== 'TECNICO' && !(emAtendimento || reservadas || pausadas || concluidas || at || hr)) return [];
        const suficiente = concluidas >= AMOSTRA_MIN;
        const estado = at || emAtendimento > 0 ? 'EM_ATENDIMENTO' : pausadas > 0 ? 'PAUSADO' : reservadas > 0 ? 'COM_RESERVA' : 'DISPONIVEL';
        return [{
          id: u.id, nome: u.nome,
          agora: {
            estado, emAtendimento, reservadas, pausadas,
            omAtual: at ? { id: at.ordem_id, numero: at.numero, equipamento: at.equipamento, inicioCronometro: at.inicio } : null,
          },
          periodo: {
            concluidas,
            // Princípio ético aplicado NO SERVIDOR: média individual só com amostra mínima (senão null).
            mttrLiquidoSegundos: suficiente ? r1(k!.liquido) : null,
            mttaSegundos: suficiente ? r1(k!.mtta) : null,
            retrabalhoPct: suficiente && rt ? pct(rt.reprov, rt.entradas) : null,
            horasApontadasSegundos: Math.round(hr?.seg ?? 0),
            retroativoPct: hr && hr.seg > 0 ? pct(hr.retro, hr.seg) : null, // qualidade do dado: parcela lançada retroativamente
            amostraSuficiente: suficiente,
          },
        }];
      }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || (a.id < b.id ? -1 : 1)); // ordem por NOME, nunca por desempenho
      return gerarJson(comGerado({ periodo: { de: f.de, ate: f.ate }, tecnicos }));
    }));
  });

  // ---------- Backlog: FOTO DE AGORA (ignora o período e tecnicoIds) ----------
  app.get('/metricas/backlog', async (req, reply) => {
    const f = parseFiltros(req.query);
    return enviar(reply, await comCache(chaveQuery('backlog', req.query), async () => comGerado(await backlogAgora(f))));
  });

  // ---------- "Atenção agora" (modo TV): no máximo 5 itens, por gravidade ----------
  // Foto de AGORA (ignora período e filtros). Uma OM aparece uma vez, no tipo mais grave:
  //  1) CRITICA_SEM_RESPONSAVEL: urgente ABERTA, sem técnico (idade = desde a abertura)
  //  2) RESERVA_SEM_ACEITE: RESERVADA há mais que OM_FALLBACK_URGENTE_MIN (idade = desde a delegação)
  //  3) MAIS_DE_8H: qualquer OM em aberto há mais de 8 h (idade = desde a abertura)
  const TIPOS_ATENCAO = ['CRITICA_SEM_RESPONSAVEL', 'RESERVA_SEM_ACEITE', 'MAIS_DE_8H'] as const;
  app.get('/metricas/atencao', async (req, reply) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(5).default(5) }).parse(req.query);
    return enviar(reply, await comCache(chaveQuery('atencao', req.query), async () => {
      const pol = await lerPoliticas();
      const minAviso = pol.reservaAvisoMin; // US-12 §4: aviso aos 10 min (faltando 5 para a reserva expirar aos 15)
      const minAceite = pol.reservaAceiteMin;
      const rows = await prisma.$queryRaw<{ tipo: string; id: bigint; numero: string; equipamento: string; nome: string; prioridade: string; idade: number; expira: number | null }[]>`
        SELECT * FROM (
          SELECT CASE WHEN o.status = 'ABERTA' AND o.prioridade = 'CRITICA' AND o.responsavel_id IS NULL THEN 'CRITICA_SEM_RESPONSAVEL'
                      WHEN o.status = 'RESERVADA' AND o.delegado_em <= now() - make_interval(mins => ${minAviso}::int) THEN 'RESERVA_SEM_ACEITE'
                      WHEN now() - o.data_abertura > interval '8 hours' THEN 'MAIS_DE_8H' END AS tipo,
                 o.id, o.numero_formatado AS numero, e.codigo AS equipamento, e.nome, o.prioridade::text AS prioridade,
                 EXTRACT(EPOCH FROM (now() - (CASE WHEN o.status = 'RESERVADA' THEN COALESCE(o.delegado_em, o.data_abertura) ELSE o.data_abertura END)))::float8 AS idade,
                 (CASE WHEN o.status = 'RESERVADA' THEN GREATEST(0, EXTRACT(EPOCH FROM (o.delegado_em + make_interval(mins => ${minAceite}::int) - now()))) END)::float8 AS expira
            FROM ordens_manutencao o JOIN equipamentos e ON e.id = o.equipamento_id
           WHERE o.status IN ('ABERTA', 'RESERVADA', 'EM_ANDAMENTO', 'PAUSADA', 'AGUARDANDO_PECA', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_BAIXA')
        ) x WHERE tipo IS NOT NULL`;
      rows.sort((a, b) => TIPOS_ATENCAO.indexOf(a.tipo as never) - TIPOS_ATENCAO.indexOf(b.tipo as never) || b.idade - a.idade);
      return gerarJson(comGerado({
        total: rows.length, // antes do corte, para a TV mostrar "+N"
        itens: rows.slice(0, limit).map((r) => ({
          tipo: r.tipo, id: r.id, numero: r.numero, equipamento: r.equipamento, equipamentoNome: r.nome,
          prioridade: r.prioridade, idadeSegundos: Math.round(r.idade),
          // RESERVA_SEM_ACEITE: segundos até a reserva EXPIRAR (a TV mostra a contagem regressiva); null nos demais tipos
          expiraEmSegundos: r.expira === null ? null : Math.round(r.expira),
        })),
      }));
    }));
  });
};
