import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { prisma } from '../db.js';

// Criptografia de segredos guardados em configuracoes_globais (tipo SECRETO), p.ex. SMTP_PASS.
// AES-256-GCM (autenticado: adulteração do valor no banco falha na leitura).
// Formato em `valor`: enc:v1:<iv b64>:<tag b64>:<ciphertext b64>
const PREFIXO = 'enc:v1:';
export const MASCARA = '********';

const material = config.CONFIG_ENCRYPTION_KEY ?? config.JWT_SECRET;
export const chaveDerivadaDoJwt = config.CONFIG_ENCRYPTION_KEY === undefined;
const chave = Buffer.from(hkdfSync('sha256', material, 'om-api', 'config-secrets-v1', 32));

export const estaCifrado = (v: string): boolean => v.startsWith(PREFIXO);

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave, iv);
  const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return `${PREFIXO}${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

/** Decifra; valor sem prefixo é segredo legado em texto puro (migrado no boot) e é devolvido como está. */
export function decifrar(valor: string): string {
  if (!estaCifrado(valor)) return valor;
  const [iv, tag, ct] = valor.slice(PREFIXO.length).split(':');
  if (!iv || !tag || !ct) throw new Error('segredo cifrado malformado');
  const d = createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

/** Criptografa no lugar todo segredo que ainda esteja em texto puro. Idempotente. Retorna quantos migrou. */
export async function migrarSegredosLegados(): Promise<number> {
  const pend = await prisma.configuracaoGlobal.findMany({
    where: { tipo: 'SECRETO', valor: { not: null } },
    select: { chave: true, valor: true },
  });
  let n = 0;
  for (const c of pend) {
    if (!c.valor || estaCifrado(c.valor)) continue;
    await prisma.configuracaoGlobal.update({ where: { chave: c.chave }, data: { valor: cifrar(c.valor) } });
    n++;
  }
  return n;
}
