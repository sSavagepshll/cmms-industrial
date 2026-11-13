import { describe, expect, it } from 'vitest';
import { derivarTipoAtivo, tipoAtivoRotulo } from '../../src/tipoAtivo.js';

describe('derivarTipoAtivo (contrato Fase 30 §3.3)', () => {
  const casos: [boolean, string | null | undefined, string, string | null][] = [
    [false, 'PRODUTIVOS', 'MAQUINA', null],
    [false, 'IMPRODUTIVOS', 'MAQUINA', null],
    [false, 'MOLDES', 'MOLDE', null],
    [false, 'PREDIAL_OUTROS', 'OUTRO', 'Outros'],
    [true, 'MOLDES', 'OUTRO', 'Predial'],
    [true, 'PRODUTIVOS', 'OUTRO', 'Predial'], // predial vence o grupo
    [true, null, 'OUTRO', 'Predial'],
    [false, null, 'MAQUINA', null], // legado sem grupo
    [false, undefined, 'MAQUINA', null],
    [false, 'DESCONHECIDO', 'MAQUINA', null],
  ];
  it.each(casos)('predial=%s grupo=%s -> %s / %s', (predial, grupo, tipo, outro) => {
    expect(derivarTipoAtivo({ predial }, grupo)).toEqual({ tipoAtivo: tipo, tipoAtivoOutro: outro });
  });
  it('nunca deriva ROBO', () => {
    for (const g of ['PRODUTIVOS', 'IMPRODUTIVOS', 'MOLDES', 'PREDIAL_OUTROS', null]) {
      for (const predial of [true, false]) expect(derivarTipoAtivo({ predial }, g).tipoAtivo).not.toBe('ROBO');
    }
  });
  it('é compatível com o rótulo da ficha', () => {
    const d = derivarTipoAtivo({ predial: false }, 'PREDIAL_OUTROS');
    expect(tipoAtivoRotulo(d.tipoAtivo, d.tipoAtivoOutro)).toBe('Outros');
    expect(tipoAtivoRotulo(derivarTipoAtivo({ predial: false }, 'MOLDES').tipoAtivo, null)).toBe('Molde');
  });
});
