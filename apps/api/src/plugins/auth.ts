import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

export interface TokenPayload {
  sub: string; // usuarios.id (BigInt como string)
  perfil: 'ADMIN' | 'GERENTE' | 'TECNICO' | 'OPERADOR' | 'LIDER_PRODUCAO';
  nome: string;
  /** Device ID do totem (sessão curta do kiosk). Presente => o token só vale em requisições com o mesmo X-Totem-Id. */
  tid?: string;
  iat?: number;
  exp?: number;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    autenticar: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const ISS = 'om-api';
const AUD = 'om-kiosk';

export const authPlugin = fp(async (app) => {
  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: { algorithm: 'HS256', expiresIn: config.JWT_EXPIRES_IN, iss: ISS, aud: AUD },
    verify: { algorithms: ['HS256'], allowedIss: ISS, allowedAud: AUD },
  });

  app.decorate('autenticar', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer')
        .send({ error: 'NAO_AUTENTICADO', message: 'Sessão ausente, inválida ou expirada.' });
    }
    // Sessão de totem (kiosk): vínculo ao dispositivo + duração absoluta.
    const tid = req.user.tid;
    if (tid !== undefined) {
      const hdr = req.headers['x-totem-id'];
      const duracao = (req.user.exp ?? 0) - (req.user.iat ?? 0);
      const autorizado = config.TOTENS_AUTORIZADOS.length === 0 || config.TOTENS_AUTORIZADOS.includes(tid);
      // Mesma resposta para todos os motivos (sem dica ao atacante); o motivo real vai só para o log.
      const motivo = typeof hdr !== 'string' ? 'sem_header' : hdr !== tid ? 'device_diferente'
        : duracao <= 0 || duracao > config.KIOSK_TOKEN_TTL_S ? 'duracao_invalida' : !autorizado ? 'totem_revogado' : null;
      if (motivo) {
        req.log.warn({ evento: 'sessao_totem_rejeitada', motivo, totemToken: tid, ip: req.ip, usuarioId: req.user.sub });
        return reply
          .code(401)
          .header('WWW-Authenticate', 'Bearer')
          .send({ error: 'SESSAO_TOTEM_INVALIDA', message: 'Sessão do totem inválida para este dispositivo. Faça login novamente no totem.' });
      }
    }
  });
});

export const perfilRequerido = (perfis: string[]) => async (req: FastifyRequest, reply: FastifyReply) => {
  if (!perfis.includes(req.user.perfil)) {
    return reply.code(403).send({ error: 'ACESSO_NEGADO', message: 'Voc nao tem permissao.' });
  }
};
