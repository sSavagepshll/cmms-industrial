import nodemailer, { type Transporter } from 'nodemailer';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { decifrar } from '../crypto/segredo.js';

// Parâmetros SMTP vêm de configuracoes_globais (editáveis no painel; SMTP_PASS cifrada).
// Cache curto: mudança no painel vale sem reiniciar (e a rota de PUT invalida na hora).
const TTL_MS = 30_000;

export interface Smtp {
  ativo: boolean;
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string; // endereço do cabeçalho From (SMTP_FROM, senão o usuário SMTP)
  fromNome: string; // display-name (config.EMAIL_REMETENTE_NOME); o nodemailer aplica RFC 2047
  envelopeFrom: string; // MAIL FROM = conta autenticada (smtp.user) quando for e-mail válido
}

const EMAIL_RE = /^[^\s<>"@\u0000-\u001f\u007f]+@[^\s<>"@\u0000-\u001f\u007f]+\.[^\s<>"@\u0000-\u001f\u007f]+$/;
/** Aceita "a@b.c" ou "Nome <a@b.c>" (legado) e devolve só o endereço; inválido → null. */
export const extrairEndereco = (v: string): string | null => {
  const a = (/<([^<>]+)>\s*$/.exec(v)?.[1] ?? v).trim();
  return EMAIL_RE.test(a) ? a : null;
};

let cache: { em: number; valor: Smtp | null } | null = null;
let transporte: { sig: string; t: Transporter } | null = null;

// Disjuntor de autenticação: após "535 login inválido" não insiste (várias tentativas erradas seguidas podem
// bloquear a conta SMTP do provedor). Reabre sozinho em 10 min ou assim que a configuração SMTP for alterada.
const PAUSA_AUTH_MS = 10 * 60_000;
let authBloqueadoAte = 0;
export const authBloqueadoMs = (): number => Math.max(0, authBloqueadoAte - Date.now());
export const registrarFalhaAuth = (): void => { authBloqueadoAte = Date.now() + PAUSA_AUTH_MS; };

export function invalidarCacheSmtp(): void {
  authBloqueadoAte = 0;
  cache = null;
  transporte?.t.close();
  transporte = null;
}

/** null = SMTP não configurado por completo. */
export async function lerSmtp(): Promise<Smtp | null> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.valor;
  const rows = await prisma.configuracaoGlobal.findMany({
    where: { chave: { in: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'EMAIL_ATIVO'] } },
    select: { chave: true, valor: true },
  });
  const m = new Map(rows.map((r) => [r.chave, r.valor?.trim() ?? '']));
  const host = m.get('SMTP_HOST');
  const user = m.get('SMTP_USER');
  const passRaw = m.get('SMTP_PASS');
  const port = Number(m.get('SMTP_PORT'));
  let valor: Smtp | null = null;
  if (host && user && passRaw && Number.isInteger(port) && port > 0) {
    const from = extrairEndereco(m.get('SMTP_FROM') ?? '') ?? user;
    valor = {
      ativo: (m.get('EMAIL_ATIVO') ?? 'true').toLowerCase() !== 'false',
      host, port, user,
      pass: decifrar(passRaw),
      from,
      fromNome: config.EMAIL_REMETENTE_NOME,
      envelopeFrom: extrairEndereco(user) ?? from, // alinhado à conta autenticada
    };
  }
  cache = { em: Date.now(), valor };
  return valor;
}

export function obterTransporte(s: Smtp): Transporter {
  const sig = `${s.host}|${s.port}|${s.user}|${s.pass.length}`;
  if (transporte?.sig === sig) return transporte.t;
  transporte?.t.close();
  const t = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.port === 465, // 465 = TLS direto; demais (587) = STARTTLS
    requireTLS: config.SMTP_REQUIRE_TLS && s.port !== 465, // nunca autentica/envia em texto puro
    auth: { user: s.user, pass: s.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    pool: true,
    maxConnections: 2,
  });
  transporte = { sig, t };
  return t;
}
