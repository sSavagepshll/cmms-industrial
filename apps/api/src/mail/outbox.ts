import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { authBloqueadoMs, lerSmtp } from './smtp.js';
import { enviarAgora, erroSeguro, limpaAssunto, type Anexo, type Mensagem } from './mailer.js';
import { registrarEnvioOutboxSucesso, registrarEnvioOutboxFalha, registrarAnexoRender, registrarAnexoFalha } from '../telemetria/metrics.js';
import { ANEXO_POR_TIPO, EmailTipoNaoPermitido, ehTipoVital } from './catalogo.js';
import { fichaSnapshotV1 } from '../ficha/schema.js';
import { renderFichaPdf } from '../ficha/pdf.js';

/**
 * Outbox transacional de e-mail (Fase 34, docs/arch/outbox-resiliencia.md).
 * Produtor: `enfileirarEmail(tx, ...)` grava na MESMA transação da ação de negócio.
 * Consumidor: `iniciarOutbox(log)` — LISTEN/NOTIFY só acorda; a tabela é a fonte da verdade e um polling de segurança cobre NOTIFY perdido.
 * Garantia: at-least-once (um crash entre o SMTP aceitar e o UPDATE ENVIADO pode reenviar; nunca perde).
 */

type Db = Pick<typeof prisma, '$executeRaw' | '$queryRaw'>;

export interface EmailOutbox extends Omit<Mensagem, 'anexos'> {
  tipo: string; // Fase 35: somente o catálogo vital (mail/catalogo.ts)
  ordemId?: bigint;
  anexoId?: bigint; // outbox_anexo: obrigatório em OM_ABERTURA e OM_CONCLUIDA_GESTOR, proibido nos demais (RN-79)
  chaveDedupe?: string; // "<tipo>:<ordemId>:<email>:<discriminador>"
  reqId?: string;
}

const CANAL = 'outbox_email_novo';
/** Espelha ck_outbox_email_dest: o destinatário vai em header SMTP (sem controle/espaço). Inválido é descartado, não derruba a transação. */
export const destinatarioValido = (e: string) => e.length >= 3 && e.length <= 254 && !/[\u0000- \u007f]/.test(e);

/** INSERT na transação do chamador. Falha propaga (a ação de negócio inteira falha: é o objetivo do outbox). */
export async function enfileirarEmail(db: Db, e: EmailOutbox): Promise<boolean> {
  // RN-77: catálogo fechado. Falha cedo (o banco também recusa, V027); a regra do anexo (RN-79) vale no código e no CHECK.
  if (!ehTipoVital(e.tipo)) throw new EmailTipoNaoPermitido(e.tipo);
  if ((ANEXO_POR_TIPO[e.tipo] !== null) !== (e.anexoId !== undefined)) {
    throw new Error(`anexo ${ANEXO_POR_TIPO[e.tipo] ? 'obrigatório' : 'proibido'} em ${e.tipo}`);
  }
  if (!destinatarioValido(e.para)) return false;
  const n = await db.$executeRaw`
    INSERT INTO outbox_email (tipo, ordem_id, destinatario_email, assunto, corpo_texto, corpo_html, chave_dedupe, max_tentativas, req_id, anexo_id)
    VALUES (${e.tipo}, ${e.ordemId ?? null}, ${e.para}, ${limpaAssunto(e.assunto) || '(sem assunto)'}, ${e.texto}, ${e.html},
            ${e.chaveDedupe ?? null}, ${config.OUTBOX_EMAIL_MAX_TENTATIVAS}::smallint, ${e.reqId ?? null}, ${e.anexoId ?? null})
    ON CONFLICT (chave_dedupe) WHERE chave_dedupe IS NOT NULL DO NOTHING`;
  return n > 0;
}

// ---------- política de falha / backoff (puro, testável) ----------

/** Backoff por tentativas já feitas: 5 s, 30 s, 2 min, 10 min, 1 h, 6 h. */
export const ESPERAS_MS = [5_000, 30_000, 120_000, 600_000, 3_600_000, 21_600_000] as const;

/** Espera antes da próxima tentativa, com jitter ±20 % (`aleatorio` em [0,1) injetável nos testes). */
export function backoffMs(tentativasFeitas: number, aleatorio: () => number = Math.random): number {
  const base = ESPERAS_MS[Math.min(Math.max(tentativasFeitas, 0), ESPERAS_MS.length - 1)]!;
  return Math.round(base * (0.8 + aleatorio() * 0.4));
}

export type Decisao =
  | { acao: 'SUSPENSO'; esperaMs: number } // EAUTH_SUSPENSO: não consome tentativa
  | { acao: 'MORTO'; permanente: boolean }
  | { acao: 'RETENTAR'; esperaMs: number };

/** Classifica a falha do envio (§3.1). `tentativasFeitas` ainda NÃO inclui a tentativa que acabou de falhar. */
export function classificarFalha(
  e: unknown, tentativasFeitas: number, maxTentativas: number, suspensoMs = 0, aleatorio: () => number = Math.random,
): Decisao {
  const x = e as { code?: string; responseCode?: number };
  if (x.code === 'EAUTH_SUSPENSO') return { acao: 'SUSPENSO', esperaMs: Math.max(suspensoMs, 5_000) };
  // Fase 35 (§3.4): snapshot inválido/ausente e PDF acima do limite não se resolvem retentando. EPDF_RENDER segue o backoff normal.
  if (x.code === 'ESNAPSHOT_INVALIDO' || x.code === 'EANEXO_GRANDE' || x.code === 'EANEXO_NOME_INVALIDO') return { acao: 'MORTO', permanente: true };
  if (x.code === 'EAUTH' || x.code === 'EREJECT' || (x.responseCode !== undefined && x.responseCode >= 500)) {
    return { acao: 'MORTO', permanente: true };
  }
  if (tentativasFeitas + 1 >= maxTentativas) return { acao: 'MORTO', permanente: false };
  return { acao: 'RETENTAR', esperaMs: backoffMs(tentativasFeitas, aleatorio) };
}

// ---------- worker ----------

interface Linha {
  id: bigint; tipo: string; ordem_id: bigint | null; destinatario_email: string; assunto: string;
  corpo_texto: string; corpo_html: string; tentativas: number; max_tentativas: number; req_id: string | null; anexo_id: bigint | null;
}

export interface OutboxWorker {
  /** Força uma drenagem (coalescida). */
  drenar(): Promise<void>;
  /** Para de reivindicar, fecha o LISTEN e aguarda os envios em curso até OUTBOX_EMAIL_SHUTDOWN_SEG. */
  parar(): Promise<void>;
  readonly instancia: string;
}

export function iniciarOutbox(log: FastifyBaseLogger): OutboxWorker {
  const instancia = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  let parando = false;
  let cliente: pg.Client | null = null;
  let reconexaoMs = 1_000;
  let timerReconexao: NodeJS.Timeout | null = null;
  let timerRetentativa: NodeJS.Timeout | null = null;
  let drenagem: Promise<void> | null = null;
  let nova = false; // chegou NOTIFY durante uma drenagem em curso
  const emCurso = new Set<Promise<void>>();

  const recuperarLeases = async () => {
    const n = await prisma.$executeRaw`
      UPDATE outbox_email
         SET status = 'PENDENTE', bloqueado_por = NULL, bloqueado_ate = NULL, proxima_tentativa_em = now()
       WHERE status = 'PROCESSANDO' AND bloqueado_ate < now()`;
    if (n > 0) log.warn({ evento: 'outbox_lease_recuperado', quantidade: n });
  };

  const reivindicar = (): Promise<Linha[]> => prisma.$queryRaw<Linha[]>`
    WITH alvo AS (
      SELECT id FROM outbox_email
       WHERE status = 'PENDENTE' AND proxima_tentativa_em <= now()
       ORDER BY proxima_tentativa_em, id
       LIMIT ${config.OUTBOX_EMAIL_LOTE}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_email o
       SET status = 'PROCESSANDO', bloqueado_por = ${instancia},
           bloqueado_ate = now() + make_interval(secs => ${config.OUTBOX_EMAIL_LEASE_SEG}::int)
      FROM alvo
     WHERE o.id = alvo.id
    RETURNING o.id, o.tipo, o.ordem_id, o.destinatario_email, o.assunto, o.corpo_texto, o.corpo_html,
              o.tentativas, o.max_tentativas, o.req_id, o.anexo_id`;

  /** Toda saída de PROCESSANDO exige ser o dono do lease (fencing). 0 linhas = lease perdido: não sobrescreve. */
  const lease = (id: bigint, n: number) => {
    if (n === 0) log.warn({ evento: 'outbox_lease_perdido', outboxId: id.toString() });
  };

  // Cache do ciclo (§3.4-2): um PDF por anexo_id, reaproveitado pelos N destinatários do evento. Descartado ao fim da drenagem.
  const cachePdf = new Map<string, Promise<Anexo>>();
  const MAX_CACHE = 20;

  const gerarAnexo = async (anexoId: bigint): Promise<Anexo> => {
    const [a] = await prisma.$queryRaw<{ tipo_documento: string; snapshot: unknown }[]>`
      SELECT tipo_documento, snapshot FROM outbox_anexo WHERE id = ${anexoId}`;
    const parsed = a ? fichaSnapshotV1.safeParse(a.snapshot) : null;
    if (!a || !parsed?.success) {
      registrarAnexoFalha('snapshot_invalido');
      throw Object.assign(new Error('snapshot da ficha ausente ou inválido'), { code: 'ESNAPSHOT_INVALIDO' });
    }
    const t0 = process.hrtime.bigint();
    let timer: NodeJS.Timeout | undefined;
    let conteudo: Buffer;
    try {
      conteudo = await Promise.race([
        renderFichaPdf(parsed.data, { tz: config.TZ_RELATORIOS }),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout ao renderizar o PDF')), config.FICHA_PDF_TIMEOUT_MS); }),
      ]);
    } catch (err) {
      registrarAnexoFalha('render');
      throw Object.assign(new Error(`falha ao renderizar o PDF: ${erroSeguro(err)}`), { code: 'EPDF_RENDER' });
    } finally {
      if (timer) clearTimeout(timer);
    }
    const duracao = Number(process.hrtime.bigint() - t0) / 1_000_000_000;
    if (conteudo.length > config.OUTBOX_EMAIL_ANEXO_MAX_KB * 1024) {
      registrarAnexoFalha('tamanho');
      throw Object.assign(new Error(`PDF com ${conteudo.length} bytes excede o limite de ${config.OUTBOX_EMAIL_ANEXO_MAX_KB} KB`), { code: 'EANEXO_GRANDE' });
    }
    registrarAnexoRender(duracao);
    const nome = `ficha_${parsed.data.om.numeroFormatado}${parsed.data.tipoDocumento === 'FICHA_FINAL' ? '_final' : ''}.pdf`.replace(/[^A-Za-z0-9_.-]/g, '_');
    log.info({ evento: 'ficha_pdf_renderizado', anexoId: anexoId.toString(), bytes: conteudo.length, duracaoMs: Math.round(duracao * 1000) });
    return { nome, conteudo, tipo: 'application/pdf' };
  };

  const obterAnexo = (anexoId: bigint): Promise<Anexo> => {
    const k = anexoId.toString();
    let p = cachePdf.get(k);
    if (!p) {
      if (cachePdf.size >= MAX_CACHE) cachePdf.delete(cachePdf.keys().next().value as string);
      p = gerarAnexo(anexoId);
      cachePdf.set(k, p);
    }
    return p;
  };

  const processar = async (l: Linha): Promise<void> => {
    const ctx = { outboxId: l.id.toString(), tipo: l.tipo, ordemId: l.ordem_id?.toString(), ...(l.req_id && { reqId: l.req_id }) };
    const inicio = process.hrtime.bigint();
    try {
      const smtp = await lerSmtp();
      if (!smtp || !smtp.ativo) {
        lease(l.id, await prisma.$executeRaw`
          UPDATE outbox_email SET status = 'CANCELADO', ultimo_erro = 'smtp_desativado', bloqueado_por = NULL, bloqueado_ate = NULL
           WHERE id = ${l.id} AND status = 'PROCESSANDO' AND bloqueado_por = ${instancia}`);
        log.info({ evento: 'email_ignorado', motivo: smtp ? 'desativado' : 'smtp_nao_configurado', ...ctx });
        return;
      }
      // RN-79: abertura e conclusão NUNCA saem sem o PDF; os demais tipos nunca levam anexo.
      let anexos: Anexo[] | undefined;
      if (l.anexo_id !== null) {
        anexos = [await obterAnexo(l.anexo_id)];
      } else if (ANEXO_POR_TIPO[l.tipo as keyof typeof ANEXO_POR_TIPO]) {
        registrarAnexoFalha('snapshot_invalido');
        throw Object.assign(new Error('e-mail com ficha sem anexo_id'), { code: 'ESNAPSHOT_INVALIDO' });
      }
      const r = await enviarAgora({ para: l.destinatario_email, assunto: l.assunto, texto: l.corpo_texto, html: l.corpo_html, ...(anexos && { anexos }) });
      lease(l.id, await prisma.$executeRaw`
        UPDATE outbox_email
           SET status = 'ENVIADO', enviado_em = now(), message_id = ${r.messageId}, resposta_smtp = ${r.resposta.slice(0, 200)},
               ultimo_erro = NULL, tentativas = LEAST(tentativas + 1, max_tentativas), bloqueado_por = NULL, bloqueado_ate = NULL
         WHERE id = ${l.id} AND status = 'PROCESSANDO' AND bloqueado_por = ${instancia}`);
      if (r.fromDominio !== r.envelopeDominio) log.warn({ evento: 'smtp_remetente_desalinhado', ...ctx, fromDominio: r.fromDominio, envelopeDominio: r.envelopeDominio });
      const duracaoSegundos = Number(process.hrtime.bigint() - inicio) / 1_000_000_000;
      registrarEnvioOutboxSucesso(duracaoSegundos);
      log.info({
        evento: 'email_enviado', ...ctx, aceitos: r.aceitos.length, rejeitados: r.rejeitados.length, resposta: r.resposta,
        messageId: r.messageId, filaId: r.filaId, anexos: r.anexos,
        fromDominio: r.fromDominio, envelopeDominio: r.envelopeDominio, paraDominio: r.paraDominio,
        duracaoMs: Number((process.hrtime.bigint() - inicio) / 1_000_000n),
      });
    } catch (e) {
      const erro = erroSeguro(e).slice(0, 300);
      if ((e as { code?: string }).code === 'EPDF_RENDER' || (e as { code?: string }).code === 'ESNAPSHOT_INVALIDO' || (e as { code?: string }).code === 'EANEXO_GRANDE') {
        log.error({ evento: 'ficha_pdf_falhou', ...ctx, anexoId: l.anexo_id?.toString(), erro });
      }
      const d = classificarFalha(e, l.tentativas, l.max_tentativas, authBloqueadoMs());
      if (d.acao === 'SUSPENSO') {
        registrarEnvioOutboxFalha(false);
        lease(l.id, await prisma.$executeRaw`
          UPDATE outbox_email
             SET status = 'PENDENTE', ultimo_erro = ${erro}, bloqueado_por = NULL, bloqueado_ate = NULL,
                 proxima_tentativa_em = now() + make_interval(secs => ${d.esperaMs / 1000}::double precision)
           WHERE id = ${l.id} AND status = 'PROCESSANDO' AND bloqueado_por = ${instancia}`);
        log.warn({ evento: 'email_retentativa', ...ctx, suspenso: true, emMs: d.esperaMs, erro });
      } else if (d.acao === 'MORTO') {
        registrarEnvioOutboxFalha(true);
        lease(l.id, await prisma.$executeRaw`
          UPDATE outbox_email
             SET status = 'MORTO', ultimo_erro = ${erro}, tentativas = LEAST(tentativas + 1, max_tentativas), bloqueado_por = NULL, bloqueado_ate = NULL
           WHERE id = ${l.id} AND status = 'PROCESSANDO' AND bloqueado_por = ${instancia}`);
        log.error({ evento: 'outbox_morto', ...ctx, permanente: d.permanente, tentativas: l.tentativas + 1, erro });
      } else {
        registrarEnvioOutboxFalha(false);
        lease(l.id, await prisma.$executeRaw`
          UPDATE outbox_email
             SET status = 'PENDENTE', ultimo_erro = ${erro}, tentativas = tentativas + 1, bloqueado_por = NULL, bloqueado_ate = NULL,
                 proxima_tentativa_em = now() + make_interval(secs => ${d.esperaMs / 1000}::double precision)
           WHERE id = ${l.id} AND status = 'PROCESSANDO' AND bloqueado_por = ${instancia}`);
        log.warn({ evento: 'email_retentativa', ...ctx, tentativa: l.tentativas + 1, emMs: d.esperaMs, erro });
      }
    }
  };

  /** Processa o lote com no máximo CONCORRENCIA envios simultâneos. */
  const processarLote = async (lote: Linha[]) => {
    const fila = [...lote];
    const operario = async () => {
      for (let l = fila.shift(); l; l = fila.shift()) {
        const p = processar(l).catch((err) => log.error({ evento: 'outbox_erro_processar', outboxId: l!.id.toString(), erro: erroSeguro(err) }));
        emCurso.add(p);
        try { await p; } finally { emCurso.delete(p); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(config.OUTBOX_EMAIL_CONCORRENCIA, lote.length) }, operario));
  };

  /** Arma um timer para a próxima retentativa (retentativas não geram NOTIFY), limitado ao polling. */
  const armarRetentativa = async () => {
    if (parando) return;
    const [r] = await prisma.$queryRaw<{ ms: number | null }[]>`
      SELECT (EXTRACT(EPOCH FROM (min(proxima_tentativa_em) - now())) * 1000)::float8 AS ms FROM outbox_email WHERE status = 'PENDENTE'`;
    if (timerRetentativa) clearTimeout(timerRetentativa);
    timerRetentativa = null;
    if (r?.ms === null || r?.ms === undefined) return;
    const espera = Math.min(Math.max(r.ms, 250), config.OUTBOX_EMAIL_POLL_SEG * 1000);
    timerRetentativa = setTimeout(() => void drenar(), espera);
    timerRetentativa.unref();
  };

  const ciclo = async () => {
    do {
      nova = false;
      for (;;) {
        if (parando) return;
        const lote = await reivindicar();
        if (lote.length === 0) break;
        log.debug({ evento: 'outbox_claim', quantidade: lote.length });
        await processarLote(lote);
      }
    } while (nova && !parando);
    cachePdf.clear();
    await armarRetentativa();
  };

  /** Coalescido: no máximo uma drenagem em curso por réplica; NOTIFY durante a drenagem agenda mais uma volta. */
  const drenar = (): Promise<void> => {
    if (drenagem) { nova = true; return drenagem; }
    drenagem = ciclo()
      .catch((err) => log.error({ evento: 'outbox_drenar_falhou', erro: erroSeguro(err) }))
      .finally(() => { drenagem = null; });
    return drenagem;
  };

  // ---- LISTEN (conexão dedicada; erro nunca derruba a API) ----
  const agendarReconexao = () => {
    if (parando || timerReconexao) return;
    const espera = reconexaoMs;
    reconexaoMs = Math.min(reconexaoMs * 2, 30_000);
    timerReconexao = setTimeout(() => { timerReconexao = null; void conectar(); }, espera);
    timerReconexao.unref();
  };

  const conectar = async () => {
    if (parando) return;
    const c = new pg.Client({ connectionString: config.DATABASE_URL_DIRECT ?? config.DATABASE_URL, options: '-c timezone=UTC' });
    let caiu = false;
    const cair = (motivo: string) => {
      if (caiu) return;
      caiu = true;
      if (cliente === c) cliente = null;
      if (!parando) log.warn({ evento: 'outbox_listener_desconectado', motivo, tentativaEmMs: reconexaoMs });
      c.removeAllListeners();
      c.on('error', () => undefined);
      void c.end().catch(() => undefined);
      agendarReconexao();
    };
    c.on('error', (err) => cair(erroSeguro(err)));
    c.on('end', () => cair('end'));
    c.on('notification', (m) => { if (m.channel === CANAL) void drenar(); });
    try {
      await c.connect();
      await c.query(`LISTEN ${CANAL}`);
      if (parando) { void c.end().catch(() => undefined); return; }
      cliente = c;
      reconexaoMs = 1_000;
      log.info({ evento: 'outbox_listener_reconectado', canal: CANAL });
      await recuperarLeases().catch(() => undefined);
      void drenar(); // NOTIFY enquanto desconectado é perdido: sempre drena ao (re)conectar
    } catch (err) {
      cair(erroSeguro(err));
    }
  };

  void recuperarLeases().catch((err) => log.error({ evento: 'outbox_recuperar_falhou', erro: erroSeguro(err) }));
  void conectar();
  void drenar();
  // Polling de segurança: cobre NOTIFY perdido e lease expirado de outra réplica.
  const poll = setInterval(() => {
    void recuperarLeases().catch((err) => log.error({ evento: 'outbox_recuperar_falhou', erro: erroSeguro(err) })).then(() => drenar());
  }, config.OUTBOX_EMAIL_POLL_SEG * 1000);
  poll.unref();

  return {
    instancia,
    drenar,
    async parar() {
      if (parando) return;
      parando = true;
      clearInterval(poll);
      if (timerReconexao) clearTimeout(timerReconexao);
      if (timerRetentativa) clearTimeout(timerRetentativa);
      const c = cliente;
      cliente = null;
      if (c) { c.removeAllListeners(); c.on('error', () => undefined); await c.end().catch(() => undefined); }
      const limite = new Promise<void>((r) => setTimeout(r, config.OUTBOX_EMAIL_SHUTDOWN_SEG * 1000).unref());
      await Promise.race([Promise.allSettled([...emCurso, ...(drenagem ? [drenagem] : [])]).then(() => undefined), limite]);
      // O que não terminou fica PROCESSANDO e é recuperado pelo lease.
    },
  };
}
