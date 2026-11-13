import { describe, expect, it } from 'vitest';
import { ERRO_PORTAL, mensagemTotem, perfilPermitido, portalDe, type Perfil, type Portal } from '../../src/politicaAcesso.js';

const TOTEM: Perfil[] = ['OPERADOR', 'LIDER_PRODUCAO', 'ADMIN'];

describe('politicaAcesso', () => {
  it('portalDe: totemId vence; portal declarado; senão PADRAO', () => {
    expect(portalDe('TOTEM-01', undefined)).toBe('TOTEM');
    expect(portalDe(undefined, 'TECNICO')).toBe('TECNICO');
    expect(portalDe(undefined, undefined)).toBe('PADRAO');
  });

  // matriz do contrato §2: [perfil, TOTEM, TECNICO, PADRAO]
  const matriz: [Perfil, boolean, boolean, boolean][] = [
    ['OPERADOR', true, false, true],
    ['LIDER_PRODUCAO', true, false, true],
    ['TECNICO', false, true, true],
    ['GERENTE', false, false, true],
    ['ADMIN', true, true, true],
  ];
  it.each(matriz)('%s: totem=%s tecnico=%s padrao=%s', (perfil, totem, tecnico, padrao) => {
    const r: Record<Portal, boolean> = { TOTEM: totem, TECNICO: tecnico, PADRAO: padrao };
    for (const p of ['TOTEM', 'TECNICO', 'PADRAO'] as const) expect(perfilPermitido(p, perfil, TOTEM)).toBe(r[p]);
  });

  it('ADMIN entra mesmo que a lista do totem o omita (RN-54)', () => {
    expect(perfilPermitido('TOTEM', 'ADMIN', [])).toBe(true);
  });
  it('GERENTE no totem só se estiver na lista configurada', () => {
    expect(perfilPermitido('TOTEM', 'GERENTE', [...TOTEM, 'GERENTE'])).toBe(true);
  });
  it('mensagens exatas', () => {
    expect(mensagemTotem('TECNICO')).toBe('Acesso restrito. Técnicos de manutenção devem utilizar o portal exclusivo (/tecnico).');
    expect(mensagemTotem('GERENTE')).toBe('Acesso restrito. Utilize o painel de gestão (/admin).');
    expect(ERRO_PORTAL.TECNICO.message).toBe('Acesso exclusivo para técnicos de manutenção e administradores.');
  });
});
