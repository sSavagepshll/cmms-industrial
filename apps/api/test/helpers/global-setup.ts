import net from 'node:net';
import { URL_TESTE } from './soft.js';

// Segurança: os testes de integração dão TRUNCATE em tabelas. Só rodam contra um banco cujo NOME contém "test".
export default async function setup() {
  const u = new URL(URL_TESTE);
  const banco = u.pathname.replace(/^\//, '');
  if (!/test/i.test(banco)) {
    throw new Error(`TEST_DATABASE_URL aponta para "${banco}". Por segurança só é aceito um banco de teste (nome com "test", ex.: om_test).`);
  }
  await new Promise<void>((resolve, reject) => {
    const s = net.connect({ host: u.hostname, port: Number(u.port || 5432), timeout: 3000 }, () => { s.end(); resolve(); });
    s.on('error', () => reject(new Error(
      `Postgres de teste inacessível em ${u.hostname}:${u.port || 5432}. Suba o banco e aplique as migrations:\n` +
      `  docker compose up -d db && docker exec om-db psql -U om_user -d postgres -c "CREATE DATABASE om_test"\n` +
      `  docker compose run --rm -e PGDATABASE=om_test migrate`,
    )));
    s.on('timeout', () => { s.destroy(); reject(new Error('Timeout ao conectar no Postgres de teste.')); });
  });
}
