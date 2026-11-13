import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';
import { toJSON } from '../serialize.js';
import { painelAdmin } from '../plugins/rbac.js';

// Lista de técnicos com carga para o diálogo "Atribuir técnico" / Despacho. Acessível a GERENTE e ADMIN
// (diferente de /usuarios, que é só ADMIN). Só ativos; sem e-mail, PIN ou qualquer dado sensível.
export const despachoRoutes: FastifyPluginAsync = async (app) => {
  app.get('/usuarios/tecnicos', { preHandler: painelAdmin }, async () => {
    const tecnicos = await prisma.usuario.findMany({
      where: { ativo: true, perfil: 'TECNICO' },
      select: { id: true, nome: true, matricula: true, perfil: true },
      orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    });
    const ids = tecnicos.map((t) => t.id);
    const [ordens, abertos] = ids.length === 0 ? [[], []] : await Promise.all([
      prisma.ordem.groupBy({
        by: ['responsavelId', 'status'],
        where: { responsavelId: { in: ids }, status: { in: ['RESERVADA', 'EM_ANDAMENTO', 'PAUSADA', 'AGUARDANDO_PECA'] } },
        _count: { _all: true },
      }),
      prisma.omApontamentoTempo.findMany({ where: { tecnicoId: { in: ids }, fim: null, deletadoEm: null }, select: { tecnicoId: true }, distinct: ['tecnicoId'] }),
    ]);
    const cron = new Set(abertos.map((a) => a.tecnicoId.toString()));
    return toJSON(tecnicos.map((t) => {
      const doTec = ordens.filter((o) => o.responsavelId === t.id);
      const reservadas = doTec.filter((o) => o.status === 'RESERVADA').reduce((n, o) => n + o._count._all, 0);
      const emAtendimento = doTec.filter((o) => o.status !== 'RESERVADA').reduce((n, o) => n + o._count._all, 0);
      return { ...t, emAtendimento, reservadas, cronometroAtivo: cron.has(t.id.toString()), situacao: emAtendimento > 0 ? 'EM_ATENDIMENTO' : 'DISPONIVEL' };
    }));
  });
};
