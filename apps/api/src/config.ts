import 'dotenv/config';
import { z } from 'zod';

const csv = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const PERFIS = ['ADMIN', 'GERENTE', 'TECNICO', 'OPERADOR', 'LIDER_PRODUCAO'] as const;

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Sem default de propósito: a API não sobe sem segredo forte.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter ao menos 32 caracteres'),
  // Fuso usado para agrupar métricas por dia/semana/mês.
  TZ_RELATORIOS: z.string().default('America/Sao_Paulo'),
  // Janela máxima para lançamentos retroativos de horas (dias).
  RETROATIVO_MAX_DIAS: z.coerce.number().int().min(1).max(365).default(30),
  // Chave que criptografa segredos em configuracoes_globais (ex.: SMTP_PASS). Vazio = deriva do JWT_SECRET
  // (funciona, mas trocar o JWT_SECRET passaria a invalidar os segredos salvos: defina uma chave própria em produção).
  CONFIG_ENCRYPTION_KEY: z.string().optional().transform((v) => (v && v.length > 0 ? v : undefined)).pipe(z.string().min(32, 'CONFIG_ENCRYPTION_KEY deve ter ao menos 32 caracteres').optional()),
  // URL do front usada nos links dos e-mails (padrão: primeira origem do CORS).
  FRONTEND_URL: z.string().optional().transform((v) => (v && v.length > 0 ? v : undefined)).pipe(z.url().optional()),
  // STARTTLS obrigatório no SMTP (não aceita enviar em texto puro). Só desligue em ambiente de teste local.
  SMTP_REQUIRE_TLS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Sessão curta do TOTEM (login por PIN com Device ID): expiração ABSOLUTA, sem renovação. Padrão 900 s (homologado pela Segurança, Fase 19); mín. 60 s, teto 1800 s.
  // Fase 37 (RN-87): sessão do painel (GERENTE/ADMIN, login sem totem e sem portal). Absoluta, sem renovação. Teto 12 h.
  ADMIN_SESSAO_TTL_S: z.coerce.number().int().min(900).max(43200).default(43200),
  KIOSK_TOKEN_TTL_S: z.coerce.number().int().min(60).max(1800).default(900),
  // Lista de Device IDs de totens autorizados (CSV). Vazia = qualquer ID é aceito (apenas registrado em log).
  TOTENS_AUTORIZADOS: z.string().optional().transform(csv),
  // Perfis que SÓ podem entrar por um totem (login sem Device ID é recusado). Vazio = nenhum. Ex.: OPERADOR,LIDER_PRODUCAO
  TOTEM_OBRIGATORIO_PERFIS: z.string().optional().transform(csv).pipe(z.array(z.enum(PERFIS))),
  // Fase 32 (US-17): perfis que podem abrir sessão de TOTEM (matriz de acesso por portal). ADMIN é sempre incluído (RN-54).
  // Default OPERADOR,LIDER_PRODUCAO,ADMIN; incluir GERENTE aqui reverte a decisão C3 sem alterar código.
  TOTEM_PERFIS_PERMITIDOS: z.string().optional()
    .transform((v) => (v === undefined || v.trim() === '' ? ['OPERADOR', 'LIDER_PRODUCAO', 'ADMIN'] : csv(v)))
    .pipe(z.array(z.enum(PERFIS)))
    .transform((l) => [...new Set([...l, 'ADMIN' as const])]),
  JWT_EXPIRES_IN: z.string().default('5m'),
  // HTTPS (certificado autoassinado na intranet): caminhos do PEM da chave e do certificado. Só habilita com os DOIS definidos
  // e existentes; vazio = HTTP (padrão dos testes automatizados).
  SSL_KEY_PATH: z.string().optional().transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  SSL_CERT_PATH: z.string().optional().transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Fase 34: outbox transacional de e-mail (docs/arch/outbox-resiliencia.md). Fase 35: o modo em memória e OUTBOX_EMAIL_ATIVO foram removidos (a variável é ignorada).
  OUTBOX_EMAIL_MAX_TENTATIVAS: z.coerce.number().int().min(1).max(20).default(6),
  OUTBOX_EMAIL_LOTE: z.coerce.number().int().min(1).max(100).default(10),
  OUTBOX_EMAIL_LEASE_SEG: z.coerce.number().int().min(10).max(3600).default(120),
  OUTBOX_EMAIL_POLL_SEG: z.coerce.number().int().min(1).max(3600).default(30),
  OUTBOX_EMAIL_CONCORRENCIA: z.coerce.number().int().min(1).max(10).default(2),
  // Fase 35: anexo PDF da ficha (gerado no worker a partir do snapshot)
  FICHA_PDF_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(10_000),
  // Fase 36 (RN-84c): teto 200 KB (a ficha real tem ~5 KB).
  OUTBOX_EMAIL_ANEXO_MAX_KB: z.coerce.number().int().min(16).max(10_240).default(200),
  // Fase 36 (RN-84): nome de exibição do remetente (RFC 5322 display-name). Sem <, >, ", controle; ≤ 80.
  EMAIL_REMETENTE_NOME: z.string().trim().max(80).regex(/^[^<>"\u0000-\u001f\u007f]*$/, 'sem <, >, aspas ou controle')
    .default('Apex Industrial Technologies · CMMS'),
  OUTBOX_EMAIL_SHUTDOWN_SEG: z.coerce.number().int().min(1).max(120).default(20),
  // Conexão DIRETA (sem PgBouncer em modo transaction) usada só pelo LISTEN. Vazio = DATABASE_URL.
  DATABASE_URL_DIRECT: z.string().optional().transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
}).superRefine((c, ctx) => {
  // Configuração contraditória: perfil exigido SÓ no totem, mas proibido de entrar no totem.
  const fora = c.TOTEM_OBRIGATORIO_PERFIS.filter((p) => !c.TOTEM_PERFIS_PERMITIDOS.includes(p));
  if (fora.length > 0) {
    ctx.addIssue({ code: 'custom', path: ['TOTEM_OBRIGATORIO_PERFIS'], message: `perfis ${fora.join(',')} estão em TOTEM_OBRIGATORIO_PERFIS mas não em TOTEM_PERFIS_PERMITIDOS` });
  }
});

export const config = configSchema.parse(process.env);
