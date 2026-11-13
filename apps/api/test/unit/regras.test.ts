import { describe, expect, it } from 'vitest';
import {
  podeAprovar, podeAssumir, situacaoAtribuicao, validarValorConfig, zonaMta, zonaMttr, type OmAtribuicao,
} from '../../src/regras.js';

const om = (o: Partial<OmAtribuicao> = {}): OmAtribuicao => ({
  status: 'ABERTA', prioridade: 'MEDIA', responsavelId: null, devolvida: false, segundosAteFallback: 600, ...o,
});
const TEC = 10n, OUTRO = 11n, GER = 20n;

describe('situacaoAtribuicao (US-11)', () => {
  it('RESERVADA tem prioridade sobre qualquer outra situação', () => {
    expect(situacaoAtribuicao(om({ status: 'RESERVADA', responsavelId: TEC, prioridade: 'CRITICA', segundosAteFallback: -1 }))).toBe('RESERVADA');
  });
  it('não urgente sem reserva = PARA_PUXAR (ALTA não é urgente)', () => {
    expect(situacaoAtribuicao(om())).toBe('PARA_PUXAR');
    expect(situacaoAtribuicao(om({ prioridade: 'ALTA' }))).toBe('PARA_PUXAR');
  });
  it('urgente (CRITICA) aguarda o gerente até o fallback e depois fica LIBERADA', () => {
    expect(situacaoAtribuicao(om({ prioridade: 'CRITICA', segundosAteFallback: 1 }))).toBe('URGENTE_AGUARDA_GERENTE');
    expect(situacaoAtribuicao(om({ prioridade: 'CRITICA', segundosAteFallback: 0 }))).toBe('LIBERADA'); // limite inclusivo
    expect(situacaoAtribuicao(om({ prioridade: 'CRITICA', segundosAteFallback: -30 }))).toBe('LIBERADA');
  });
  it('devolvida pela recusa fica com o gerente (não vai ao pull), exceto urgente já liberada', () => {
    expect(situacaoAtribuicao(om({ devolvida: true }))).toBe('DEVOLVIDA');
    expect(situacaoAtribuicao(om({ devolvida: true, prioridade: 'CRITICA', segundosAteFallback: 5 }))).toBe('DEVOLVIDA');
    expect(situacaoAtribuicao(om({ devolvida: true, prioridade: 'CRITICA', segundosAteFallback: -5 }))).toBe('LIBERADA');
  });
});

describe('podeAssumir (D2, RN-22, RN-23, RN-27)', () => {
  it('TECNICO puxa não urgente e ALTA', () => {
    expect(podeAssumir(om(), TEC, 'TECNICO').permitido).toBe(true);
    expect(podeAssumir(om({ prioridade: 'ALTA' }), TEC, 'TECNICO').permitido).toBe(true);
  });
  it('TECNICO NÃO puxa urgente dentro do prazo: 403 URGENTE_REQUER_GERENTE com contagem', () => {
    const r = podeAssumir(om({ prioridade: 'CRITICA', segundosAteFallback: 421.2 }), TEC, 'TECNICO');
    expect(r).toMatchObject({ permitido: false, status: 403, codigo: 'URGENTE_REQUER_GERENTE', liberaEmSegundos: 422 });
  });
  it('TECNICO puxa urgente depois do fallback', () => {
    expect(podeAssumir(om({ prioridade: 'CRITICA', segundosAteFallback: 0 }), TEC, 'TECNICO').permitido).toBe(true);
  });
  it('OM devolvida não vai ao pull do técnico, mas o gerente assume', () => {
    expect(podeAssumir(om({ devolvida: true }), TEC, 'TECNICO')).toMatchObject({ permitido: false, codigo: 'OM_DEVOLVIDA', status: 403 });
    expect(podeAssumir(om({ devolvida: true }), GER, 'GERENTE').permitido).toBe(true);
  });
  it('GERENTE e ADMIN assumem qualquer OM aberta (inclusive urgente no prazo)', () => {
    const urgente = om({ prioridade: 'CRITICA', segundosAteFallback: 900 });
    expect(podeAssumir(urgente, GER, 'GERENTE').permitido).toBe(true);
    expect(podeAssumir(urgente, GER, 'ADMIN').permitido).toBe(true);
  });
  it('RESERVADA: só o técnico reservado; os demais (inclusive gerente) recebem 409 OM_RESERVADA', () => {
    const reservada = om({ status: 'RESERVADA', responsavelId: TEC });
    expect(podeAssumir(reservada, TEC, 'TECNICO').permitido).toBe(true);
    expect(podeAssumir(reservada, OUTRO, 'TECNICO')).toMatchObject({ permitido: false, status: 409, codigo: 'OM_RESERVADA' });
    expect(podeAssumir(reservada, GER, 'GERENTE')).toMatchObject({ permitido: false, status: 409, codigo: 'OM_RESERVADA' });
  });
  it('OPERADOR e LIDER_PRODUCAO não atendem OM', () => {
    expect(podeAssumir(om(), TEC, 'OPERADOR')).toMatchObject({ permitido: false, status: 403, codigo: 'ACESSO_NEGADO' });
    expect(podeAssumir(om(), TEC, 'LIDER_PRODUCAO').permitido).toBe(false);
  });
});

describe('podeAprovar (RN-21b, RN-24, US-11.1/11.2)', () => {
  const base = { solicitanteId: 1n, responsavelId: TEC, executouPeloUsuario: false, segundosAteLider: 900 };
  it('RN-24: quem executou nunca decide (responsável ou com apontamento), seja qual for o perfil', () => {
    expect(podeAprovar(base, TEC, 'GERENTE')).toMatchObject({ permitido: false, codigo: 'AUTOAPROVACAO_PROIBIDA' });
    expect(podeAprovar({ ...base, executouPeloUsuario: true }, GER, 'GERENTE')).toMatchObject({ permitido: false, codigo: 'AUTOAPROVACAO_PROIBIDA' });
    expect(podeAprovar({ ...base, executouPeloUsuario: true }, 99n, 'ADMIN').permitido).toBe(false);
  });
  it('OPERADOR só decide as próprias OMs', () => {
    expect(podeAprovar(base, 1n, 'OPERADOR')).toMatchObject({ permitido: true, emNomeDe: false });
    expect(podeAprovar(base, 2n, 'OPERADOR')).toMatchObject({ permitido: false, status: 403, codigo: 'ACESSO_NEGADO' });
  });
  it('LIDER: as próprias sempre; as de outros só após o prazo (limite inclusivo), em nome do operador', () => {
    expect(podeAprovar(base, 1n, 'LIDER_PRODUCAO')).toMatchObject({ permitido: true, emNomeDe: false });
    expect(podeAprovar(base, 5n, 'LIDER_PRODUCAO')).toMatchObject({ permitido: false, codigo: 'AGUARDE_OPERADOR', liberaEmSegundos: 900, status: 403 });
    expect(podeAprovar({ ...base, segundosAteLider: 0.4 }, 5n, 'LIDER_PRODUCAO')).toMatchObject({ permitido: false, liberaEmSegundos: 1 });
    expect(podeAprovar({ ...base, segundosAteLider: 0 }, 5n, 'LIDER_PRODUCAO')).toMatchObject({ permitido: true, emNomeDe: true });
    expect(podeAprovar({ ...base, segundosAteLider: -600 }, 5n, 'LIDER_PRODUCAO')).toMatchObject({ permitido: true, emNomeDe: true });
  });
  it('GERENTE não aprova (Fase 21: conclui em /encerrar); ADMIN (coringa) decide qualquer OM; TECNICO nunca', () => {
    expect(podeAprovar(base, GER, 'GERENTE')).toMatchObject({ permitido: false, codigo: 'ACESSO_NEGADO' });
    expect(podeAprovar(base, 1n, 'GERENTE')).toMatchObject({ permitido: false, codigo: 'ACESSO_NEGADO' });
    expect(podeAprovar(base, 99n, 'ADMIN').permitido).toBe(true);
    expect(podeAprovar(base, 99n, 'TECNICO')).toMatchObject({ permitido: false, codigo: 'ACESSO_NEGADO' });
  });
});

describe('zonas do dashboard (US-12 §3)', () => {
  const zMta = { metaOkPct: 95, metaAtencaoPct: 85 };
  it('MTTA: >= 95 OK; 85–94,9 ATENÇÃO; abaixo CRÍTICA (limites inclusivos)', () => {
    expect(zonaMta(100, zMta)).toBe('OK');
    expect(zonaMta(95, zMta)).toBe('OK');
    expect(zonaMta(94.9, zMta)).toBe('ATENCAO');
    expect(zonaMta(85, zMta)).toBe('ATENCAO');
    expect(zonaMta(84.9, zMta)).toBe('CRITICA');
    expect(zonaMta(0, zMta)).toBe('CRITICA');
  });
  it('MTTR (menor = melhor): <= 100% OK; até 120% ATENÇÃO; acima CRÍTICA (limites inclusivos)', () => {
    const z = { mttrAtencaoPct: 120 };
    expect(zonaMttr(50, z)).toBe('OK');
    expect(zonaMttr(100, z)).toBe('OK');
    expect(zonaMttr(100.1, z)).toBe('ATENCAO');
    expect(zonaMttr(120, z)).toBe('ATENCAO');
    expect(zonaMttr(120.1, z)).toBe('CRITICA');
  });
  it('sem dado ou sem limiar = sem zona (nunca inventa cor)', () => {
    expect(zonaMta(null, zMta)).toBeNull();
    expect(zonaMta(90, { metaOkPct: null, metaAtencaoPct: 85 })).toBeNull();
    expect(zonaMta(90, { metaOkPct: 95, metaAtencaoPct: null })).toBeNull();
    expect(zonaMttr(null, { mttrAtencaoPct: 120 })).toBeNull();
    expect(zonaMttr(90, { mttrAtencaoPct: null })).toBeNull();
  });
});

describe('validarValorConfig', () => {
  it('chave sem regra conhecida passa', () => expect(validarValorConfig('QUALQUER_COISA', 'x')).toBeNull());
  it('numéricos: inteiro dentro da faixa', () => {
    expect(validarValorConfig('OM_FALLBACK_URGENTE_MIN', '10')).toBeNull();
    expect(validarValorConfig('OM_FALLBACK_URGENTE_MIN', '1')).toBeNull();
    expect(validarValorConfig('OM_FALLBACK_URGENTE_MIN', '1440')).toBeNull();
    for (const ruim of ['0', '1441', '-3', '1.5', 'abc', '', null]) expect(validarValorConfig('OM_FALLBACK_URGENTE_MIN', ruim as string | null)).toMatch(/inteiro entre 1 e 1440/);
  });
  it('limiar de MTTR: 100 a 1000', () => {
    expect(validarValorConfig('ZONA_MTTR_ATENCAO_PCT', '120')).toBeNull();
    expect(validarValorConfig('ZONA_MTTR_ATENCAO_PCT', '99')).not.toBeNull();
    expect(validarValorConfig('ZONA_MTTR_ATENCAO_PCT', '1001')).not.toBeNull();
  });
  it('metas são opcionais: vazio/nulo limpa, mas valor presente é validado', () => {
    expect(validarValorConfig('META_MTTA_MIN_ALTA', null)).toBeNull();
    expect(validarValorConfig('META_MTTA_MIN_ALTA', '')).toBeNull();
    expect(validarValorConfig('META_MTTA_MIN_ALTA', '  ')).toBeNull();
    expect(validarValorConfig('META_MTTA_MIN_ALTA', '30')).toBeNull();
    expect(validarValorConfig('META_MTTA_MIN_ALTA', '0')).not.toBeNull();
    expect(validarValorConfig('META_MTTA_MIN_ALTA', 'x')).not.toBeNull();
  });
  it('tema: enum e HH:mm', () => {
    for (const m of ['AUTO', 'CLARO', 'ESCURO', 'HORARIO']) expect(validarValorConfig('TEMA_TOTEM_MODO', m)).toBeNull();
    expect(validarValorConfig('TEMA_TOTEM_MODO', 'ROXO')).toMatch(/AUTO, CLARO, ESCURO, HORARIO/);
    expect(validarValorConfig('TEMA_TOTEM_MODO', 'auto')).not.toBeNull(); // diferencia maiúsculas
    for (const h of ['00:00', '06:00', '18:30', '23:59']) expect(validarValorConfig('TEMA_TOTEM_ESCURO_INICIO', h)).toBeNull();
    for (const h of ['24:00', '6:00', '12:60', '12h', '', null]) expect(validarValorConfig('TEMA_TOTEM_ESCURO_FIM', h as string | null)).toMatch(/HH:mm/);
  });
  it('aviso e prazo da reserva têm faixa própria', () => {
    expect(validarValorConfig('OM_RESERVA_AVISO_MIN', '10')).toBeNull();
    expect(validarValorConfig('OM_RESERVA_ACEITE_MIN', '15')).toBeNull();
    expect(validarValorConfig('OM_RESERVA_AVISO_MIN', '0')).not.toBeNull();
  });
});
