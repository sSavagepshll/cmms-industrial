import { afterEach, describe, expect, it, vi } from 'vitest';
import { chaveQuery, comCache, limparCacheMetricas, parseFiltros, pct, r1, variacaoPct, variacaoPp } from '../../src/metricas/filtros.js';

const DIA = 86_400_000;

describe('parseFiltros', () => {
  it('padrões: últimos 30 dias, CORRETIVA, sem comparação', () => {
    const f = parseFiltros({});
    expect(f.tipo).toBe('CORRETIVA');
    expect(f.comparar).toBe(false);
    expect(f.anterior).toBeNull();
    expect(f.tecnicoIds).toEqual([]);
    expect(f.prioridades).toEqual([]);
    expect(Math.round((f.ate.getTime() - f.de.getTime()) / DIA)).toBe(30);
  });
  it('comparar=true: período anterior de mesma duração, imediatamente antes', () => {
    const f = parseFiltros({ de: '2026-10-01T00:00:00Z', ate: '2026-10-11T00:00:00Z', comparar: 'true' });
    expect(f.anterior).toEqual({ de: new Date('2026-09-21T00:00:00Z'), ate: new Date('2026-10-01T00:00:00Z') });
  });
  it('CSV de ids e prioridades: remove vazios e duplicados', () => {
    const f = parseFiltros({ tecnicoIds: '3, 3,4,,5', prioridade: 'CRITICA,ALTA,CRITICA' });
    expect(f.tecnicoIds).toEqual([3n, 4n, 5n]);
    expect(f.prioridades).toEqual(['CRITICA', 'ALTA']);
  });
  it('rejeita: de >= ate, período > 366 dias, id/prioridade/tipo inválidos, mais de 50 ids', () => {
    expect(() => parseFiltros({ de: '2026-02-01', ate: '2026-01-01' })).toThrow();
    expect(() => parseFiltros({ de: '2026-01-01', ate: '2026-01-01' })).toThrow();
    expect(() => parseFiltros({ de: '2024-01-01', ate: '2026-01-01' })).toThrow(/366/);
    expect(() => parseFiltros({ tecnicoIds: 'abc' })).toThrow();
    expect(() => parseFiltros({ tecnicoIds: '1,-2' })).toThrow();
    expect(() => parseFiltros({ tecnicoIds: Array.from({ length: 51 }, (_, i) => i + 1).join(',') })).toThrow();
    expect(() => parseFiltros({ prioridade: 'FOO' })).toThrow();
    expect(() => parseFiltros({ tipo: 'OUTRA' })).toThrow();
    expect(() => parseFiltros({ comparar: 'talvez' })).toThrow();
  });
  it('aceita exatamente 366 dias', () => {
    expect(() => parseFiltros({ de: '2025-01-01T00:00:00Z', ate: '2026-01-02T00:00:00Z' })).not.toThrow();
  });
});

describe('cálculos de variação e taxa', () => {
  it('variacaoPct: relativa, 1 casa, null sem base', () => {
    expect(variacaoPct(8, 3)).toBe(166.7);
    expect(variacaoPct(3000, 3600)).toBe(-16.7);
    expect(variacaoPct(5, 0)).toBeNull();
    expect(variacaoPct(null, 4)).toBeNull();
    expect(variacaoPct(4, null)).toBeNull();
  });
  it('variacaoPp: diferença em pontos percentuais', () => {
    expect(variacaoPp(18.2, 0)).toBe(18.2);
    expect(variacaoPp(10, 12.5)).toBe(-2.5);
    expect(variacaoPp(null, 1)).toBeNull();
  });
  it('pct e r1 arredondam em 1 casa e tratam base zero', () => {
    expect(pct(2, 11)).toBe(18.2);
    expect(pct(19, 20)).toBe(95);
    expect(pct(0, 20)).toBe(0);
    expect(pct(1, 0)).toBeNull();
    expect(r1(2437.54)).toBe(2437.5);
    expect(r1(null)).toBeNull();
    expect(r1(undefined)).toBeNull();
  });
});

describe('cache de 30 s', () => {
  afterEach(() => { vi.useRealTimers(); limparCacheMetricas(); });
  it('reutiliza dentro de 30 s e recalcula depois', async () => {
    vi.useFakeTimers();
    let n = 0;
    const calc = async () => ++n;
    expect(await comCache('k', calc)).toBe(1);
    expect(await comCache('k', calc)).toBe(1);
    vi.advanceTimersByTime(29_000);
    expect(await comCache('k', calc)).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect(await comCache('k', calc)).toBe(2);
  });
  it('limparCacheMetricas (evento de OM) força recálculo imediato', async () => {
    let n = 0;
    await comCache('k2', async () => ++n);
    limparCacheMetricas();
    expect(await comCache('k2', async () => ++n)).toBe(2);
  });
  it('chaves diferentes não se misturam; chaveQuery ignora a ordem dos parâmetros', async () => {
    expect(chaveQuery('kpis', { b: '2', a: '1' })).toBe(chaveQuery('kpis', { a: '1', b: '2' }));
    expect(chaveQuery('kpis', { a: '1' })).not.toBe(chaveQuery('meta', { a: '1' }));
    expect(await comCache('x1', async () => 'a')).toBe('a');
    expect(await comCache('x2', async () => 'b')).toBe('b');
  });
});
