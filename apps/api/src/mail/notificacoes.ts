import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import type { Tx } from '../db.js';
import { gravarAnexo, montarFichaSnapshot } from '../ficha/snapshot.js';
import { setorExibicao } from '../setorExibicao.js';
import { tipoAtivoRotulo } from '../tipoAtivo.js';
import { ANEXO_POR_TIPO, type EmailTipoVital } from './catalogo.js';
import { enfileirarEmail } from './outbox.js';

/**
 * Fase 35 (D1): os 4 e-mails vitais. Cada emissor roda NA transação do evento (`db` = tx) e qualquer falha propaga (a ação de
 * negócio inteira falha: é o objetivo do outbox). Atribuição, reserva, recusa, aviso/expiração e fallback NÃO geram e-mail
 * (continuam SSE, painel e auditoria). Este é o ÚNICO módulo fora de `mail/` autorizado a enfileirar (teste de contrato do QA).
 */
const BASE_URL = (config.FRONTEND_URL ?? config.CORS_ORIGIN.split(',')[0] ?? 'http://localhost:3000').trim().replace(/\/+$/, '');
const MAX_DESTINATARIOS = 50;

// Todo texto vindo do usuário (equipamento, sintomas, nomes...) é escapado: o e-mail é HTML e fica persistido.
const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const COR: Record<string, string> = { CRITICA: '#b91c1c', ALTA: '#c2410c', MEDIA: '#a16207', BAIXA: '#475569' };

const ROTULO: Record<EmailTipoVital, string> = {
  OM_ABERTURA: 'Nova OM aberta',
  OM_FINALIZADA_TECNICO: 'Serviço finalizado pelo técnico',
  OM_APROVADA_SOLICITANTE: 'OM aprovada pelo solicitante',
  OM_CONCLUIDA_GESTOR: 'OM concluída',
};
const INTRO: Record<EmailTipoVital, string> = {
  OM_ABERTURA: 'Uma nova ordem de manutenção foi aberta e aguarda atendimento. A ficha com os dados da abertura segue em anexo (PDF).',
  OM_FINALIZADA_TECNICO: 'O técnico finalizou o serviço desta ordem de manutenção. Ela aguarda a aprovação do solicitante.',
  OM_APROVADA_SOLICITANTE: 'O solicitante aprovou o serviço desta ordem de manutenção. Ela aguarda a conclusão pelo gerente.',
  OM_CONCLUIDA_GESTOR: 'Esta ordem de manutenção foi concluída pelo gerente. A ficha final segue em anexo (PDF).',
};

interface OmMail {
  numeroFormatado: string;
  prioridade: string;
  categoria: string;
  sintomas: string | null;
  tipoAtivo: string | null;
  tipoAtivoOutro: string | null;
  localDescricao: string | null;
  custoTipo: string | null;
  centroCusto: string | null;
  dataAbertura: Date;
  equipamento: { codigo: string; nome: string; setor: string; predial: boolean; itemLivre: boolean };
  solicitante: { id: bigint; nome: string };
  concluidor: { nome: string } | null;
}

async function carregarOm(db: Tx, ordemId: bigint): Promise<OmMail | null> {
  return db.ordem.findUnique({
    where: { id: ordemId },
    select: {
      numeroFormatado: true, prioridade: true, categoria: true, sintomas: true, tipoAtivo: true, tipoAtivoOutro: true,
      localDescricao: true, custoTipo: true, centroCusto: true, dataAbertura: true,
      equipamento: { select: { codigo: true, nome: true, setor: true, predial: true, itemLivre: true } },
      solicitante: { select: { id: true, nome: true } },
      concluidor: { select: { nome: true } },
    },
  });
}

type Perfil = 'TECNICO' | 'GERENTE' | 'ADMIN' | 'LIDER_PRODUCAO' | string;
interface Destino { nome: string; email: string; perfil: Perfil }

/**
 * B-38-01: o solicitante (se ativo e com e-mail) MAIS TODOS os usuários ativos com e-mail (LIDER_PRODUCAO, GERENTE, TECNICO, ADMIN,
 * OPERADOR), dos mais recentemente atualizados/cadastrados aos mais antigos, para que cadastros novos nunca fiquem fora do teto.
 * Sem e-mail nunca consome vaga (filtro no banco). Deduplica por e-mail em minúsculas. Quem executou a ação também recebe.
 */
async function destinatarios(db: Tx, solicitanteId: bigint, log: FastifyBaseLogger): Promise<Destino[]> {
  const sel = { id: true, nome: true, email: true, perfil: true } as const;
  const [solicitante, equipe] = await Promise.all([
    db.usuario.findFirst({ where: { id: solicitanteId, ativo: true }, select: sel }),
    db.usuario.findMany({ where: { ativo: true, email: { not: '' } }, select: sel, orderBy: [{ atualizadoEm: 'desc' }, { id: 'desc' }], take: MAX_DESTINATARIOS }),
  ]);
  const usuarios = [...(solicitante ? [solicitante] : []), ...equipe]; // solicitante primeiro: sempre dentro do teto
  const sem = usuarios.filter((u) => !u.email).length;
  if (sem > 0) log.info({ evento: 'email_destinatarios_sem_email', quantidade: sem });
  const vistos = new Set<string>();
  const out: Destino[] = [];
  for (const u of usuarios) {
    const email = u.email?.trim();
    if (!email || vistos.has(email.toLowerCase())) continue;
    vistos.add(email.toLowerCase());
    out.push({ nome: u.nome, email, perfil: u.perfil });
    if (out.length >= MAX_DESTINATARIOS) break;
  }
  return out;
}

/** Link por perfil (o portal /tecnico é exclusivo de técnico): TECNICO → /tecnico; GERENTE e ADMIN → /admin; LIDER_PRODUCAO e solicitante comum → sem link (sem acesso ao painel). */
const linkPara = (perfil: Perfil): string | null =>
  perfil === 'TECNICO' ? `${BASE_URL}/tecnico` : perfil === 'GERENTE' || perfil === 'ADMIN' ? `${BASE_URL}/admin` : null;

function corpo(om: OmMail, titulo: string, intro: string, extras: [string, string][], link: string | null): { texto: string; html: string } {
  const linhas: [string, string][] = [
    ['OM', om.numeroFormatado],
    ['Equipamento', `${om.equipamento.codigo} · ${om.equipamento.nome}`],
    ['Setor', setorExibicao({ equipamento: om.equipamento, localDescricao: om.localDescricao })],
    ['Prioridade', om.prioridade + (om.prioridade === 'CRITICA' ? ' (máquina parada)' : '')],
    ['Categoria', om.categoria.replaceAll('_', '/')],
    ['Sintomas', om.sintomas ?? '—'],
    ['Solicitante', om.solicitante.nome],
    ['Aberta em', om.dataAbertura.toLocaleString('pt-BR', { timeZone: config.TZ_RELATORIOS })],
    ...(om.tipoAtivo ? [['Tipo de ativo', tipoAtivoRotulo(om.tipoAtivo, om.tipoAtivoOutro) ?? om.tipoAtivo] as [string, string]] : []),
    ...extras,
  ];
  const texto = [titulo, '', intro, '', ...linhas.map(([k, v]) => `${k}: ${v}`), ...(link ? ['', `Abrir o painel: ${link}`] : [])].join('\n');
  const cor = COR[om.prioridade] ?? '#475569';
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;border-top:6px solid ${cor}">
<tr><td style="padding:24px">
<h2 style="margin:0 0 8px">${esc(titulo)}</h2>
<p style="margin:0 0 16px;color:#334155">${esc(intro)}</p>
<table role="presentation" width="100%" cellpadding="6" cellspacing="0" style="font-size:14px">
${linhas.map(([k, v]) => `<tr><td style="color:#64748b;width:140px;vertical-align:top">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('\n')}
</table>
${link ? `<p style="margin:24px 0 0"><a href="${esc(link)}" style="background:#0f4c81;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">Abrir o painel</a></p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
  return { texto, html };
}

/** reqId do log da requisição (correlação do e-mail com o Pino); ausente nos jobs. */
const reqIdDe = (log: FastifyBaseLogger): string | undefined => {
  const id = (log as { bindings?: () => Record<string, unknown> }).bindings?.().reqId;
  return typeof id === 'string' && id.length <= 64 ? id : undefined;
};

const fmtTempo = (seg: number): string => {
  const m = Math.round(seg / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};

/**
 * Fluxo comum dos 4 emissores. `discriminador` é a data do evento (a OM pode ser reprovada e refeita: cada ciclo gera e-mail novo,
 * mas o retry da mesma transição não duplica). Os ids/datas vêm do RETURNING do UPDATE guardado, nunca de uma releitura.
 */
async function emitirEvento(db: Tx, log: FastifyBaseLogger, tipo: EmailTipoVital, ordemId: bigint, discriminador: string): Promise<void> {
  const om = await carregarOm(db, ordemId);
  if (!om) return;
  const para = await destinatarios(db, om.solicitante.id, log);
  if (para.length === 0) return;

  // PDF (RN-79): snapshot atômico, uma vez por evento e compartilhado por todos os destinatários. Sem destinatário, nada a anexar.
  const docTipo = ANEXO_POR_TIPO[tipo];
  const anexoId = docTipo ? await gravarAnexo(db, ordemId, await montarFichaSnapshot(db, ordemId, docTipo, log)) : undefined;

  const extras: [string, string][] = [];
  if (tipo === 'OM_CONCLUIDA_GESTOR') {
    const [t] = await db.$queryRaw<{ s: number }[]>`
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(fim, now()) - inicio))), 0)::float8 AS s
        FROM om_apontamentos_tempo WHERE ordem_id = ${ordemId} AND deletado_em IS NULL`;
    extras.push(['Tempo líquido total', fmtTempo(t?.s ?? 0)]);
    if (om.custoTipo) extras.push(['Custo', om.custoTipo === 'INTERNO' ? 'Interno' : 'Cliente']);
    if (om.centroCusto) extras.push(['Centro de custo', om.centroCusto]);
    if (om.concluidor) extras.push(['Concluída por', om.concluidor.nome]);
  }

  const titulo = `${om.prioridade === 'CRITICA' ? '🔴 ' : ''}${ROTULO[tipo]} · ${om.numeroFormatado} · ${om.equipamento.nome}`;
  const assunto = `[${om.prioridade}] ${ROTULO[tipo]} · ${om.numeroFormatado} · ${om.equipamento.nome}`;
  const variantes = new Map<string, { texto: string; html: string }>(); // no máximo 3: tecnico, admin, sem link
  const reqId = reqIdDe(log);
  let gravados = 0;
  for (const d of para) {
    const link = linkPara(d.perfil);
    const chave = link ?? '';
    let v = variantes.get(chave);
    if (!v) { v = corpo(om, titulo, INTRO[tipo], extras, link); variantes.set(chave, v); }
    const ok = await enfileirarEmail(db, {
      tipo, ordemId, para: d.email, assunto, texto: v.texto, html: v.html,
      chaveDedupe: `${tipo}:${ordemId}:${d.email.toLowerCase()}:${discriminador}`,
      ...(anexoId !== undefined && { anexoId }),
      ...(reqId && { reqId }),
    });
    if (ok) gravados++;
  }
  log.info({ evento: 'outbox_enfileirado', tipo, ordemId: ordemId.toString(), destinatarios: gravados });
}

const iso = (d: Date) => d.toISOString();

/** E1 — OM criada. Chamar DENTRO da transação que criou a OM. Anexo: ficha inicial. */
export const notificarOmAberta = (db: Tx, ordemId: bigint, log: FastifyBaseLogger): Promise<void> =>
  emitirEvento(db, log, 'OM_ABERTURA', ordemId, 'ABERTURA');

/** E2 — técnico finalizou o serviço (AGUARDANDO_APROVACAO). `dataConclusao` vem do RETURNING do UPDATE. Sem anexo. */
export const notificarFinalizadaTecnico = (db: Tx, ordemId: bigint, dataConclusao: Date, log: FastifyBaseLogger): Promise<void> =>
  emitirEvento(db, log, 'OM_FINALIZADA_TECNICO', ordemId, iso(dataConclusao));

/** E3 — solicitante/líder aprovou (AGUARDANDO_BAIXA). `dataAprovacao` vem do RETURNING do UPDATE. Sem anexo. */
export const notificarAprovadaSolicitante = (db: Tx, ordemId: bigint, dataAprovacao: Date, log: FastifyBaseLogger): Promise<void> =>
  emitirEvento(db, log, 'OM_APROVADA_SOLICITANTE', ordemId, iso(dataAprovacao));

/** E4 — gerente encerrou (CONCLUIDA). `concluidoEm` vem do RETURNING do UPDATE. Anexo: ficha final. */
export const notificarConcluidaGestor = (db: Tx, ordemId: bigint, concluidoEm: Date, log: FastifyBaseLogger): Promise<void> =>
  emitirEvento(db, log, 'OM_CONCLUIDA_GESTOR', ordemId, iso(concluidoEm));
