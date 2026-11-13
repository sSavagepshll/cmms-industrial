import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import type { TokenPayload } from './auth.js';

type Perfil = TokenPayload['perfil'];

export function exigirPerfil(...permitidos: Perfil[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const negar = () =>
      reply.code(403).send({ error: 'ACESSO_NEGADO', message: 'Seu perfil nao tem permissao para esta acao.' });

    if (!permitidos.includes(req.user.perfil)) return negar();

    const u = await prisma.usuario.findUnique({
      where: { id: BigInt(req.user.sub) },
      select: { ativo: true, perfil: true },
    });
    if (!u?.ativo || !permitidos.includes(u.perfil)) return negar();
  };
}

// Executores de OM (assumir, play/pause, concluir, materiais, apontamentos, recusar): TECNICO e, como o GERENTE também atende OM, GERENTE e ADMIN.
export const soTecnico = exigirPerfil('TECNICO', 'GERENTE', 'ADMIN');
export const painelManutencao = exigirPerfil('TECNICO', 'GERENTE', 'ADMIN');
// Fase 21: o GERENTE não aprova nem reprova; o ADMIN é o coringa.
export const perfilAprovador = exigirPerfil('OPERADOR', 'LIDER_PRODUCAO', 'ADMIN');
// Fase 21: conclusão final da OM (AGUARDANDO_BAIXA -> CONCLUIDA).
export const perfilConcluidor = exigirPerfil('GERENTE', 'ADMIN');
export const painelAdmin = exigirPerfil('GERENTE', 'ADMIN');
// Administração de usuários e configurações: somente ADMIN (reconfere perfil/ativo no banco a cada chamada).
export const soAdmin = exigirPerfil('ADMIN');
// Atribuição de OM a um técnico: GERENTE (e ADMIN).
export const soGerente = exigirPerfil('GERENTE', 'ADMIN');
