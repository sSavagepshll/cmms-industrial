import { defineConfig } from 'vitest/config';

// Dois projetos:
//  - unit:        regras puras, criptografia, filtros... (sem banco; roda em qualquer lugar)  -> npm test
//  - integration: API real (Fastify + Prisma) contra um Postgres DE TESTE                       -> npm run test:int
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
          // config.ts exige estas variáveis ao ser importado; valores falsos bastam (nada conecta no banco).
          env: { DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/x_test', JWT_SECRET: 'unit-test-secret-unit-test-secret-0123456789' },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['test/helpers/global-setup.ts'],
          fileParallelism: false, // os arquivos compartilham (e truncam) o mesmo banco de teste
          testTimeout: 300_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
