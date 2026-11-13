import { createHash } from 'node:crypto';
import { authBloqueadoMs, lerSmtp, obterTransporte, registrarFalhaAuth } from './smtp.js';

export interface Anexo {
  nome: string; // só [A-Za-z0-9_.-]
  conteudo: Buffer;
  tipo: 'application/pdf';
}

export interface Mensagem {
  para: string;
  assunto: string;
  texto: string;
  html: string;
  anexos?: Anexo[]; // Fase 35: PDF da ficha (abertura e conclusão)
}

// Assunto vai em header: remove quebras de linha/controle (header injection) e limita o tamanho.
export const limpaAssunto = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);

/** Erro sem credenciais: só código e resumo curto da resposta do servidor. */
export function erroSeguro(e: unknown): string {
  const x = e as { code?: string; responseCode?: number; message?: string };
  return [x.code, x.responseCode, (x.message ?? '').split('\n')[0]?.slice(0, 160)].filter(Boolean).join(' ');
}

/** Envio direto (uma tentativa). Lança em falha. Usado pelo teste de configuração. */
export interface ResultadoEnvio {
  messageId: string;
  aceitos: string[]; // destinatários aceitos pelo servidor SMTP (isso NÃO garante entrega na caixa de entrada)
  rejeitados: string[];
  resposta: string; // última resposta do servidor (inclui o id de fila do provedor, útil para rastrear)
  filaId?: string; // id de fila extraído de "queued as <id>" (rastreio no provedor)
  anexos: { bytes: number; sha256: string }[];
  fromDominio: string;
  envelopeDominio: string;
  paraDominio: string; // só o domínio: sem endereço completo nos logs
}

const NOME_ANEXO_RE = /^[A-Za-z0-9._-]{1,80}$/;
const dominio = (e: string) => e.slice(e.lastIndexOf('@') + 1).toLowerCase();

export async function enviarAgora(m: Mensagem): Promise<ResultadoEnvio> {
  // RN-84: nome de arquivo vai em header MIME; inválido é falha permanente (não retenta).
  for (const a of m.anexos ?? []) {
    if (!NOME_ANEXO_RE.test(a.nome)) throw Object.assign(new Error('nome de anexo inválido'), { code: 'EANEXO_NOME_INVALIDO' });
  }
  const smtp = await lerSmtp();
  if (!smtp) throw new Error('SMTP não configurado (SMTP_HOST/PORT/USER/PASS).');
  const espera = authBloqueadoMs();
  if (espera > 0) {
    throw Object.assign(new Error(`envio suspenso por falha de autenticação SMTP (retoma em ${Math.ceil(espera / 60_000)} min ou ao corrigir a configuração)`), { code: 'EAUTH_SUSPENSO' });
  }
  try {
    const info = await obterTransporte(smtp).sendMail({
      // Objeto {name,address}: o nodemailer codifica o nome (RFC 2047) e impede injeção de cabeçalho.
      from: { name: smtp.fromNome, address: smtp.from },
      to: m.para, subject: limpaAssunto(m.assunto), text: m.texto, html: m.html,
      envelope: { from: smtp.envelopeFrom, to: m.para }, // MAIL FROM = conta autenticada
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' }, // RFC 3834
      ...(m.anexos?.length && {
        attachments: m.anexos.map((a) => ({
          filename: a.nome, content: a.conteudo, contentType: 'application/pdf',
          contentDisposition: 'attachment' as const, contentTransferEncoding: 'base64' as const,
        })),
      }),
    });
    const aceitos = (info.accepted ?? []).map(String);
    const rejeitados = (info.rejected ?? []).map(String);
    // Sem destinatário aceito não houve envio: trata como falha em vez de "sucesso silencioso".
    if (aceitos.length === 0) {
      throw Object.assign(new Error(`servidor rejeitou todos os destinatários (${info.response})`), { code: 'EREJECT', responseCode: 550 });
    }
    const resposta = String(info.response).slice(0, 200);
    return {
      messageId: info.messageId, aceitos, rejeitados, resposta,
      filaId: /queued as ([^\s>]+)/i.exec(resposta)?.[1],
      anexos: (m.anexos ?? []).map((a) => ({ bytes: a.conteudo.length, sha256: createHash('sha256').update(a.conteudo).digest('hex') })),
      fromDominio: dominio(smtp.from), envelopeDominio: dominio(smtp.envelopeFrom), paraDominio: dominio(m.para),
    };
  } catch (e) {
    if ((e as { code?: string }).code === 'EAUTH') registrarFalhaAuth();
    throw e;
  }
}
