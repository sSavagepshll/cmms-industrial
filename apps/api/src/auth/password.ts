import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import bcrypt from 'bcryptjs';

// Hash de PIN com scrypt (parâmetros OWASP: N=2^17 seria o ideal; N=2^15,r=8,p=1 mantém login < ~100ms).
// Formato armazenado em usuarios.pin_hash: scrypt$N$r$p$saltB64$hashB64
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 128 * N * R * 2;

function derive(secret: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const opts: ScryptOptions = { N: n, r, p, maxmem: MAXMEM };
  return new Promise((resolve, reject) =>
    scrypt(secret, salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(pin, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(pin, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Hash descartável usado quando o usuário não existe/não tem PIN, para igualar o tempo de resposta
// e não permitir enumeração de matrículas por timing.
export const DUMMY_HASH = await hashPin(randomBytes(8).toString('hex'));

// ---- Senha (usuarios.senha_hash) com bcrypt ----
// bcrypt só considera os primeiros 72 BYTES: a API rejeita senhas maiores em vez de truncar em silêncio.
export const SENHA_MAX_BYTES = 72;
const BCRYPT_COST = 12;

export const hashSenha = (senha: string): Promise<string> => bcrypt.hash(senha, BCRYPT_COST);
export const verifySenha = (senha: string, hash: string): Promise<boolean> => bcrypt.compare(senha, hash);
