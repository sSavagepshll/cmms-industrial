import { describe, expect, it } from 'vitest';

const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'x'.repeat(32) };
const carregar = async () => (await import('../../src/config.js')).configSchema;

describe('config TOTEM_PERFIS_PERMITIDOS', () => {
  it('default e ADMIN sempre incluído', async () => {
    const s = await carregar();
    expect(s.parse(base).TOTEM_PERFIS_PERMITIDOS).toEqual(['OPERADOR', 'LIDER_PRODUCAO', 'ADMIN']);
    expect(s.parse({ ...base, TOTEM_PERFIS_PERMITIDOS: 'OPERADOR' }).TOTEM_PERFIS_PERMITIDOS).toEqual(['OPERADOR', 'ADMIN']);
    expect(s.parse({ ...base, TOTEM_PERFIS_PERMITIDOS: 'OPERADOR,GERENTE' }).TOTEM_PERFIS_PERMITIDOS).toContain('GERENTE');
  });
  it('perfil inválido falha', async () => {
    expect((await carregar()).safeParse({ ...base, TOTEM_PERFIS_PERMITIDOS: 'XYZ' }).success).toBe(false);
  });
  it('TOTEM_OBRIGATORIO_PERFIS fora dos permitidos falha o boot', async () => {
    const s = await carregar();
    expect(s.safeParse({ ...base, TOTEM_OBRIGATORIO_PERFIS: 'TECNICO' }).success).toBe(false);
    expect(s.safeParse({ ...base, TOTEM_OBRIGATORIO_PERFIS: 'OPERADOR' }).success).toBe(true);
  });
});
