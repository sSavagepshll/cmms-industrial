import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { soAdmin } from '../plugins/rbac.js';
import { toJSON } from '../serialize.js';
import { cifrar, MASCARA } from '../crypto/segredo.js';
import { invalidarCacheSmtp } from '../mail/smtp.js';
import { enviarAgora, erroSeguro } from '../mail/mailer.js';
import { invalidarPoliticas, METADADOS_CONFIG, validarValorConfig } from '../regras.js';
import { auditar } from '../auditoria.js';
import { limparCacheMetricas } from '../metricas/filtros.js';
import { invalidarConfigPublica } from './publico.js';

const mascarar = <T extends { tipo: string; valor: string | null }>(c: T): T =>
  c.tipo === 'SECRETO' && c.valor ? { ...c, valor: MASCARA } : c;

/** Metadados para a tela (unidade e faixa), quando a chave os tem. */
const comMeta = <T extends { chave: string }>(c: T) => ({ ...c, ...(METADADOS_CONFIG[c.chave] ?? {}) });

export async function configuracoesRoutes(app: FastifyInstance) {
  // Apenas ADMIN pode acessar e alterar configurações globais
  app.addHook('preHandler', soAdmin);

  app.get('/configuracoes', async () => {
    const configs = await prisma.configuracaoGlobal.findMany({ orderBy: { grupo: 'asc' } });
    return toJSON(configs.map(mascarar).map(comMeta));
  });

  const putBody = z.object({ valor: z.string().nullable() }).strict();

  app.put('/configuracoes/:chave', async (req, reply) => {
    const params = z.object({ chave: z.string().trim().min(1).max(100) }).strict().parse(req.params);
    const body = putBody.parse(req.body);

    const existe = await prisma.configuracaoGlobal.findUnique({ where: { chave: params.chave } });
    if (!existe) {
      return reply.code(404).send({ error: 'NAO_ENCONTRADO', message: 'Configuracao nao encontrada.' });
    }

    // Parâmetros com faixa conhecida (unidade/min/max): valida antes de gravar.
    const invalido = validarValorConfig(params.chave, body.valor);
    if (invalido) return reply.code(400).send({ error: 'VALOR_INVALIDO', message: invalido });

    // Tema do totem: início e fim do período escuro não podem coincidir (período vazio/ambíguo).
    if (params.chave === 'TEMA_TOTEM_ESCURO_INICIO' || params.chave === 'TEMA_TOTEM_ESCURO_FIM') {
      const outraChave = params.chave === 'TEMA_TOTEM_ESCURO_INICIO' ? 'TEMA_TOTEM_ESCURO_FIM' : 'TEMA_TOTEM_ESCURO_INICIO';
      const outra = await prisma.configuracaoGlobal.findUnique({ where: { chave: outraChave }, select: { valor: true } });
      if (outra?.valor === body.valor) {
        return reply.code(400).send({ error: 'VALOR_INVALIDO', message: 'O início e o fim do período escuro não podem ser iguais.' });
      }
    }

    // Limiares de zona: "atenção" tem de ser MENOR que "ok" (senão a zona de atenção some).
    if ((params.chave === 'ZONA_META_OK_PCT' || params.chave === 'ZONA_META_ATENCAO_PCT') && body.valor && body.valor.trim() !== '') {
      const outra = await prisma.configuracaoGlobal.findUnique({
        where: { chave: params.chave === 'ZONA_META_OK_PCT' ? 'ZONA_META_ATENCAO_PCT' : 'ZONA_META_OK_PCT' }, select: { valor: true },
      });
      const ok = Number(params.chave === 'ZONA_META_OK_PCT' ? body.valor : outra?.valor);
      const atencao = Number(params.chave === 'ZONA_META_ATENCAO_PCT' ? body.valor : outra?.valor);
      if (outra?.valor && Number.isFinite(ok) && Number.isFinite(atencao) && atencao >= ok) {
        return reply.code(400).send({ error: 'VALOR_INVALIDO', message: 'O limiar de ATENÇÃO deve ser menor que o limiar de OK.' });
      }
    }

    // Reserva (US-12 §4): o AVISO tem de ser menor que o PRAZO de aceite (senão a reserva expira sem avisar).
    if ((params.chave === 'OM_RESERVA_AVISO_MIN' || params.chave === 'OM_RESERVA_ACEITE_MIN') && body.valor && body.valor.trim() !== '') {
      const outra = await prisma.configuracaoGlobal.findUnique({
        where: { chave: params.chave === 'OM_RESERVA_AVISO_MIN' ? 'OM_RESERVA_ACEITE_MIN' : 'OM_RESERVA_AVISO_MIN' }, select: { valor: true },
      });
      const aviso = Number(params.chave === 'OM_RESERVA_AVISO_MIN' ? body.valor : outra?.valor);
      const aceite = Number(params.chave === 'OM_RESERVA_ACEITE_MIN' ? body.valor : outra?.valor);
      if (outra?.valor && Number.isFinite(aviso) && Number.isFinite(aceite) && aviso >= aceite) {
        return reply.code(400).send({ error: 'VALOR_INVALIDO', message: 'O aviso da reserva deve ser menor que o prazo de aceite.' });
      }
    }

    // Segredo: a tela devolve a máscara quando o campo não foi alterado -> mantém o valor atual (não sobrescreve
    // a senha com "********"). Valor novo é gravado SEMPRE cifrado; vazio limpa o segredo.
    if (existe.tipo === 'SECRETO' && body.valor === MASCARA) return toJSON(mascarar(existe));
    // Parâmetro opcional (metas): campo vazio limpa o valor (NULL).
    const vazioOk = METADADOS_CONFIG[params.chave]?.opcional && (body.valor === null || body.valor.trim() === '');
    const valor = vazioOk ? null : existe.tipo === 'SECRETO' && body.valor ? cifrar(body.valor) : body.valor;
    const anterior = existe.valor;

    const config = await prisma.configuracaoGlobal.update({
      where: { chave: params.chave },
      data: { valor, atualizadoPor: BigInt(req.user.sub), atualizadoEm: new Date() },
    });
    if (params.chave.startsWith('SMTP_') || params.chave === 'EMAIL_ATIVO') invalidarCacheSmtp();
    if (params.chave.startsWith('OM_') || params.chave.startsWith('META_') || params.chave.startsWith('ZONA_')) {
      invalidarPoliticas();
      limparCacheMetricas(); // meta/prazo alterado vale na hora nos painéis (não espera os 30 s do cache)
    }
    if (params.chave.startsWith('TEMA_TOTEM_')) invalidarConfigPublica();
    // Auditoria: valores só para parâmetros OM_* (numéricos, não sensíveis). Demais (SMTP, segredos): apenas "alterado".
    const mostraValor = params.chave.startsWith('OM_') || params.chave.startsWith('META_') || params.chave.startsWith('ZONA_'); // numéricos, não sensíveis
    await auditar(prisma, {
      atorId: BigInt(req.user.sub), atorPerfil: req.user.perfil, acao: 'PARAMETRO_ALTERADO', alvoTipo: 'PARAMETRO', alvoId: params.chave,
      detalhe: mostraValor ? { de: anterior, para: body.valor } : { valorExibido: false },
    });
    req.log.info({ evento: 'configuracao_atualizada', chave: params.chave, por: req.user.sub }); // sem o valor

    return toJSON(mascarar(config));
  });

  // Envia um e-mail de teste (SMTP configurado de verdade, uma tentativa, resposta síncrona).
  app.post('/configuracoes/email/teste', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { para } = z.object({ para: z.email() }).strict().parse(req.body);
    try {
      const r = await enviarAgora({
        para,
        assunto: 'Teste de e-mail - Sistema de Ordens de Manutenção',
        texto: 'Se você recebeu esta mensagem, o envio de e-mails do sistema está funcionando.',
        html: '<p>Se você recebeu esta mensagem, o envio de e-mails do sistema está funcionando.</p>',
      });
      req.log.info({ evento: 'email_teste_enviado', por: req.user.sub, aceitos: r.aceitos.length, resposta: r.resposta });
      // "enviado" = aceito pelo servidor SMTP. Entrega final (caixa de entrada/spam) depende do provedor do destinatário.
      return { enviado: true, aceitos: r.aceitos, rejeitados: r.rejeitados, resposta: r.resposta, messageId: r.messageId };
    } catch (e) {
      req.log.warn({ evento: 'email_teste_falhou', erro: erroSeguro(e) });
      return reply.code(502).send({ error: 'FALHA_ENVIO', message: `Não foi possível enviar: ${erroSeguro(e)}` });
    }
  });
}
