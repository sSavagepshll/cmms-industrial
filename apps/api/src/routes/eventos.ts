import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { assinar, consumirTicket, emitirTicket } from '../events.js';
import { painelManutencao } from '../plugins/rbac.js';

const HEARTBEAT_MS = 25_000;
const MAX_CONEXOES_POR_USUARIO = 3;
const conexoes = new Map<string, number>();

/** Rotas protegidas por JWT: emissão do ticket. */
export const eventosTicketRoutes: FastifyPluginAsync = async (app) => {
  // EventSource não envia Authorization: o cliente troca o JWT por um ticket de 30 s, uso único.
  app.post('/eventos/ticket', { preHandler: painelManutencao, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    // Sessão de totem: o ticket herda o Device ID e o fim absoluto do JWT (o stream não pode viver mais que a sessão).
    return emitirTicket(req.user.sub, { ...(req.user.tid !== undefined && { tid: req.user.tid }), ...(req.user.exp !== undefined && req.user.tid !== undefined && { sessaoExp: req.user.exp }) });
  });
};

/** Stream SSE (autenticado pelo ticket, fora do bloco JWT). */
export const eventosStreamRoutes: FastifyPluginAsync = async (app) => {
  const abertas = new Set<{ end: () => void }>();
  app.addHook('onClose', async () => { for (const r of abertas) r.end(); });

  app.get('/eventos', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { ticket, totem } = z.object({ ticket: z.string().min(10).max(100), totem: z.string().max(50).optional() }).parse(req.query);
    const t = consumirTicket(ticket);
    if (!t) {
      return reply.code(401).send({ error: 'TICKET_INVALIDO', message: 'Ticket inválido ou expirado.' });
    }
    // Ticket emitido a uma sessão de totem: só abre o stream no mesmo dispositivo (EventSource não envia headers: vai em ?totem=).
    if (t.tid !== undefined && totem !== t.tid) {
      req.log.warn({ evento: 'sessao_totem_rejeitada', motivo: 'device_diferente_sse', totemToken: t.tid, ip: req.ip });
      return reply.code(401).send({ error: 'SESSAO_TOTEM_INVALIDA', message: 'Sessão do totem inválida para este dispositivo. Faça login novamente no totem.' });
    }
    const sub = t.sub;
    // Reconfere perfil/atividade no momento da conexão.
    const u = await prisma.usuario.findUnique({ where: { id: BigInt(sub) }, select: { ativo: true, perfil: true } });
    if (!u?.ativo || !['TECNICO', 'GERENTE', 'ADMIN'].includes(u.perfil)) {
      return reply.code(403).send({ error: 'ACESSO_NEGADO', message: 'Seu perfil não tem permissão para esta ação.' });
    }
    if ((conexoes.get(sub) ?? 0) >= MAX_CONEXOES_POR_USUARIO) {
      return reply.code(429).send({ error: 'MUITAS_CONEXOES', message: 'Limite de conexões de eventos atingido.' });
    }
    conexoes.set(sub, (conexoes.get(sub) ?? 0) + 1);

    // hijack: escrevemos direto no socket; por isso os headers do CORS (já definidos no reply) são repassados.
    reply.hijack();
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string | number | string[]>),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // desliga buffer em nginx
    });
    reply.raw.write('retry: 3000\n');
    reply.raw.write(`event: conectado\ndata: {}\n\n`);

    const desassinar = assinar((e) => reply.raw.write(`event: om\ndata: ${JSON.stringify(e)}\n\n`));
    const hb = setInterval(() => reply.raw.write(': ping\n\n'), HEARTBEAT_MS);

    // Sessão de totem tem fim ABSOLUTO: o stream é encerrado junto com o JWT.
    const fimSessao = t.sessaoExp !== undefined
      ? setTimeout(() => reply.raw.end(), Math.max(0, t.sessaoExp * 1000 - Date.now()))
      : null;
    fimSessao?.unref();
    const encerrar = () => {
      if (fimSessao) clearTimeout(fimSessao);
      clearInterval(hb);
      desassinar();
      const n = (conexoes.get(sub) ?? 1) - 1;
      if (n <= 0) conexoes.delete(sub);
      else conexoes.set(sub, n);
    };
    abertas.add(reply.raw);
    req.raw.on('close', () => {
      abertas.delete(reply.raw);
      encerrar();
    });
  });
};
