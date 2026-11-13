import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { validarValorConfig, METADADOS_CONFIG } from '../regras.js';

// Configuração pública e MÍNIMA para o totem em repouso (sem login). Nunca incluir segredos nem dados de usuário.
// Só lê chaves de tema + um contador de setores; valores inválidos no banco caem no padrão.
export interface ConfigPublica {
  temaModo: 'AUTO' | 'CLARO' | 'ESCURO' | 'HORARIO';
  escuroInicio: string; // HH:mm
  escuroFim: string; // HH:mm
  setoresCount: number;
  fuso: string; // fuso do servidor, usado no modo HORARIO
}

const TTL_MS = 10_000;
let cache: { em: number; valor: ConfigPublica } | null = null;
export const invalidarConfigPublica = () => { cache = null; };

export async function lerConfigPublica(): Promise<ConfigPublica> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.valor;
  const [rows, setores] = await Promise.all([
    prisma.configuracaoGlobal.findMany({
      where: { chave: { in: ['TEMA_TOTEM_MODO', 'TEMA_TOTEM_ESCURO_INICIO', 'TEMA_TOTEM_ESCURO_FIM'] } },
      select: { chave: true, valor: true },
    }),
    prisma.equipamento.groupBy({ by: ['setorId'], where: { status: 'ATIVO', predial: false, setorRef: { ativo: true } } }) // Fase 22: só setores de produção ATIVOS,
  ]);
  const m = new Map(rows.map((r) => [r.chave, r.valor]));
  const val = (k: string): string => {
    const v = m.get(k) ?? null;
    return v !== null && validarValorConfig(k, v) === null ? v : String(METADADOS_CONFIG[k]!.padrao);
  };
  const valor: ConfigPublica = {
    temaModo: val('TEMA_TOTEM_MODO') as ConfigPublica['temaModo'],
    escuroInicio: val('TEMA_TOTEM_ESCURO_INICIO'),
    escuroFim: val('TEMA_TOTEM_ESCURO_FIM'),
    setoresCount: setores.length,
    fuso: config.TZ_RELATORIOS,
  };
  cache = { em: Date.now(), valor };
  return valor;
}

export const publicoRoutes: FastifyPluginAsync = async (app) => {
  // Sem autenticação (registrado fora do bloco JWT). Limite próprio por IP.
  app.get('/config/publica', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return lerConfigPublica();
  });
};
