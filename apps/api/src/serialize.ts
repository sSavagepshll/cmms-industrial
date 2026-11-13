// BigInt (ids do PostgreSQL) não é serializável em JSON: converte para string.
export function toJSON<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}
