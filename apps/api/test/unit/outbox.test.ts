import { describe, expect, it } from 'vitest';
import { backoffMs, classificarFalha, destinatarioValido, ESPERAS_MS } from '../../src/mail/outbox.js';
import { codificarCursor, cursorSchema, recortarPagina } from '../../src/cursor.js';

describe('outbox: backoff', () => {
  it('segue 5 s, 30 s, 2 min, 10 min, 1 h, 6 h (sem jitter = aleatório 0,5)', () => {
    ESPERAS_MS.forEach((base, i) => expect(backoffMs(i, () => 0.5)).toBe(base));
  });
  it('jitter fica em ±20 %', () => {
    expect(backoffMs(0, () => 0)).toBe(4_000);
    expect(backoffMs(0, () => 0.999999)).toBeLessThanOrEqual(6_000);
  });
  it('além da tabela repete o último degrau; negativo vira o primeiro', () => {
    expect(backoffMs(99, () => 0.5)).toBe(21_600_000);
    expect(backoffMs(-3, () => 0.5)).toBe(5_000);
  });
});

describe('outbox: classificação de falhas (§3.1)', () => {
  it('EAUTH_SUSPENSO: não consome tentativa e respeita a suspensão (mín. 5 s)', () => {
    expect(classificarFalha({ code: 'EAUTH_SUSPENSO' }, 2, 6, 120_000)).toEqual({ acao: 'SUSPENSO', esperaMs: 120_000 });
    expect(classificarFalha({ code: 'EAUTH_SUSPENSO' }, 2, 6, 0)).toEqual({ acao: 'SUSPENSO', esperaMs: 5_000 });
  });
  it.each([[{ code: 'EAUTH' }], [{ code: 'EREJECT' }], [{ responseCode: 550 }], [{ responseCode: 500 }]])('permanente %j => MORTO', (e) => {
    expect(classificarFalha(e, 0, 6)).toEqual({ acao: 'MORTO', permanente: true });
  });
  it('temporária (rede, timeout, 4xx) => RETENTAR com backoff', () => {
    expect(classificarFalha({ code: 'ETIMEDOUT' }, 0, 6, 0, () => 0.5)).toEqual({ acao: 'RETENTAR', esperaMs: 5_000 });
    expect(classificarFalha({ responseCode: 451 }, 1, 6, 0, () => 0.5)).toEqual({ acao: 'RETENTAR', esperaMs: 30_000 });
  });
  it('esgotou max_tentativas => MORTO não permanente', () => {
    expect(classificarFalha({ code: 'ETIMEDOUT' }, 5, 6)).toEqual({ acao: 'MORTO', permanente: false });
    expect(classificarFalha({ code: 'ETIMEDOUT' }, 0, 1)).toEqual({ acao: 'MORTO', permanente: false });
  });
});

describe('outbox: destinatário (espelha ck_outbox_email_dest)', () => {
  it('aceita e-mail comum', () => expect(destinatarioValido('a@b.co')).toBe(true));
  it.each(['a b@c.com', 'a@b.com\r\nBcc: x@y.com', 'ab', 'a@b.com\t', `${'a'.repeat(250)}@b.co`])('rejeita %j', (e) => {
    expect(destinatarioValido(e)).toBe(false);
  });
});

describe('cursor de paginação', () => {
  it('ida e volta preserva o id', () => {
    expect(cursorSchema.parse(codificarCursor(123456789012345678n))).toBe(123456789012345678n);
  });
  it.each(['', '%%%', 'abc', Buffer.from('{"i":"x"}').toString('base64url'), Buffer.from('{"i":"-1"}').toString('base64url'), Buffer.from('[]').toString('base64url')])(
    'cursor adulterado %j => erro de validação', (c) => {
      expect(cursorSchema.safeParse(c).success).toBe(false);
    },
  );
  it('recortarPagina: sobra de 1 linha gera o próximo cursor a partir da última devolvida', () => {
    const r = recortarPagina([{ id: 5n }, { id: 4n }, { id: 3n }], 2);
    expect(r.itens.map((i) => i.id)).toEqual([5n, 4n]);
    expect(cursorSchema.parse(r.proximo)).toBe(4n);
  });
  it('última página não tem cursor', () => {
    expect(recortarPagina([{ id: 2n }, { id: 1n }], 2).proximo).toBeNull();
    expect(recortarPagina([], 2)).toEqual({ itens: [], proximo: null });
  });
});
