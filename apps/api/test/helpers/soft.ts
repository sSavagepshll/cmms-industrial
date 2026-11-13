import { expect } from 'vitest';

/** Banco de teste (as migrations V001+ devem estar aplicadas). Sobrescreva com TEST_DATABASE_URL. */
export const URL_TESTE = process.env.TEST_DATABASE_URL ?? 'postgresql://om_user:troque_esta_senha@127.0.0.1:5432/om_test';

/**
 * Verificação "mole": registra a falha e CONTINUA o roteiro (expect.soft), para um único teste de roteiro longo
 * mostrar todas as falhas de uma vez, cada uma com o nome do passo.
 */
export function criarOk() {
  return (nome: string, condicao: unknown, extra = ''): void => {
    expect.soft(Boolean(condicao), extra ? `${nome} -> ${extra}` : nome).toBe(true);
  };
}
