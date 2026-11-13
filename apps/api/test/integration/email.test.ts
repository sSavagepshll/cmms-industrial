import { createRequire } from 'node:module';
import { describe, it } from 'vitest';
import { criarOk, URL_TESTE } from '../helpers/soft.js';

// Convertido do roteiro e2e (verificações "moles": o teste mostra todas as falhas de uma vez).
describe('Motor de e-mail (SMTP simulado)', () => {
  it('roteiro completo', async () => {
    process.env.DATABASE_URL = URL_TESTE;
    process.env.JWT_SECRET ??= 'integration-test-secret-integration-test-secret-0123456789';
    process.env.SMTP_REQUIRE_TLS = 'false';

    const ok = criarOk();
    const CHAVES = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'EMAIL_ATIVO'];
    let _cfg: any[] = [];
    let worker: { parar(): Promise<void> } | null = null;
    let srv: any = null;
    let invalidarCacheSmtp: () => void = () => undefined;
    try {
      const { invalidarCacheSmtp: inv } = await import('../../src/mail/smtp.js');
      invalidarCacheSmtp = inv;
      const req = createRequire(import.meta.url);
      const { SMTPServer } = req('smtp-server');
      const { simpleParser } = req('mailparser');
      const caixa: any[] = [];
      let falhar = false;
      srv = new SMTPServer({
        authOptional: false, disabledCommands: ['STARTTLS'], allowInsecureAuth: true,
        onAuth(a: any, _s: any, cb: any) { a.username === 'ti@fabrica.test' && a.password === 'legacy-pass' ? cb(null, { user: 1 }) : cb(new Error('Invalid login')); },
        onData(stream: any, _s: any, cb: any) {
          simpleParser(stream).then((m: any) => { if (falhar) return cb(new Error('451 temporario')); caixa.push(m); cb(); }).catch(cb);
        },
      });
      await new Promise<void>((r) => srv.listen(2525, '127.0.0.1', r));
      const { config } = await import('../../src/config.js');
      config.SMTP_REQUIRE_TLS = false;
      const { buildApp } = await import('../../src/app.js');
      const { prisma } = await import('../../src/db.js');
      _cfg = await prisma.configuracaoGlobal.findMany({ where: { chave: { in: CHAVES } } });
      const { migrarSegredosLegados, decifrar, estaCifrado } = await import('../../src/crypto/segredo.js');
      const { hashPin } = await import('../../src/auth/password.js');
      invalidarCacheSmtp();
      const app = buildApp(); await app.ready();
      // Fase 34: o e-mail vai ao outbox (mesma transação da ação); o worker (LISTEN/NOTIFY) é quem envia.
      const { iniciarOutbox } = await import('../../src/mail/outbox.js');
      worker = iniciarOutbox(app.log);
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const esperarCaixa = async (qtd: number, maxMs = 10_000) => {
        const ini = Date.now();
        while (caixa.length < qtd && Date.now() - ini < maxMs) {
          await sleep(100);
        }
      };

      // --- limpa dados do teste anterior; config SMTP legada em texto puro + usuários
      await prisma.$executeRaw`TRUNCATE ordens_manutencao, equipamentos, auditoria RESTART IDENTITY CASCADE`;
      await prisma.configuracaoGlobal.deleteMany({ where: { chave: { in: CHAVES } } });
      await prisma.usuario.deleteMany({ where: { email: { not: 'admin@om.com.br' } } });
      await prisma.usuario.deleteMany({ where: { email: null } });
      for (const [chave, valor, tipo] of [['SMTP_HOST', '127.0.0.1', 'TEXTO'], ['SMTP_PORT', '2525', 'TEXTO'], ['SMTP_USER', 'ti@fabrica.test', 'TEXTO'], ['SMTP_PASS', 'legacy-pass', 'SECRETO']])
        await prisma.configuracaoGlobal.create({ data: { chave: chave!, valor: valor!, tipo: tipo!, grupo: 'EMAIL' } });
      const n1 = await migrarSegredosLegados();
      invalidarCacheSmtp();
      const raw = (await prisma.configuracaoGlobal.findUnique({ where: { chave: 'SMTP_PASS' } }))!.valor!;
      ok('migracao cifra SMTP_PASS legada', n1 === 1 && estaCifrado(raw) && !raw.includes('legacy-pass'), raw.slice(0, 22) + '...');
      ok('decifra devolve o original', decifrar(raw) === 'legacy-pass');
      ok('migracao e idempotente', (await migrarSegredosLegados()) === 0);
      let falhou = false;
      try { decifrar(raw.slice(0, -4) + 'AAAA'); } catch { falhou = true; }
      ok('valor adulterado no banco e rejeitado (GCM)', falhou);

      const pin = await hashPin('1234');
      const mk = (nome: string, perfil: any, matricula: string, email: string | null) => prisma.usuario.create({ data: { nome, perfil, matricula, email, pinHash: pin } });
      const gerente = await mk('Gerente Ge', 'GERENTE', 'g1', 'gerente@fabrica.test');
      const tec1 = await mk('Tec Um', 'TECNICO', 't1', 'tec1@fabrica.test');
      await mk('Tec Sem Email', 'TECNICO', 't2', null);
      const oper = await mk('Operador <b>Op</b>', 'OPERADOR', 'o1', 'oper@fabrica.test'); // Fase 35: o solicitante também recebe (RN-80)
      const inativo = await mk('Gerente Inativo', 'GERENTE', 'g2', 'inativo@fabrica.test');
      await prisma.usuario.update({ where: { id: inativo.id }, data: { ativo: false } });
      const eq = await prisma.equipamento.create({ data: { codigo: 'INJ-01', nome: 'Prensa <script>x</script>', setor: 'Prensa' } });
      const tok = (u: any) => ({ authorization: 'Bearer ' + app.jwt.sign({ sub: String(u.id), perfil: u.perfil, nome: u.nome }) });
      const call = async (m: any, url: string, u: any, payload?: any) => { const r = await app.inject({ method: m, url, headers: tok(u), payload }); return { s: r.statusCode, b: r.body ? JSON.parse(r.body) : null }; };
      const omBody = (extra: object = {}) => ({ equipamentoId: String(eq.id), maquinaParada: true, categoria: 'MECANICO', sintomas: ['Vazamento <img src=x onerror=alert(1)>'], tipoAtivo: 'MAQUINA', custoTipo: 'INTERNO', confirmarDuplicidade: true, ...extra });

      // --- E1: abertura -> solicitante + GERENTE/TECNICO ativos com e-mail, COM a ficha inicial em PDF (Fase 35)
      const t0 = Date.now();
      let r = await call('POST', '/ordens', oper, omBody());
      ok('POST /ordens responde rapido sem esperar e-mail', r.s === 201 && Date.now() - t0 < 1500, (Date.now() - t0) + 'ms');
      await esperarCaixa(4);
      const para = caixa.map((m) => m.to.text).sort();
      ok('abertura: todos os ativos com e-mail (B-38-01) (sem inativo, sem quem nao tem e-mail)',
        JSON.stringify(para) === JSON.stringify(['admin@om.com.br', 'gerente@fabrica.test', 'oper@fabrica.test', 'tec1@fabrica.test']), para.join(', '));
      const m0 = caixa.find((m) => m.to.text === 'tec1@fabrica.test');
      ok('remetente = usuario SMTP', m0.from.value[0].address === 'ti@fabrica.test', m0.from.text);
      ok('assunto com prioridade, evento, numero e equipamento', /\[CRITICA\] Nova OM aberta · OM-\d{4}-\d{6} · Prensa/.test(m0.subject), m0.subject);
      ok('HTML escapa conteudo do usuario', !m0.html.includes('<script>') && !m0.html.includes('<img') && !m0.html.includes('<b>Op</b>'));
      ok('link por perfil: tecnico -> /tecnico; gerente -> /admin; solicitante sem link',
        /https?:\/\/localhost:3000\/tecnico/.test(m0.html)
        && /https?:\/\/localhost:3000\/admin/.test(caixa.find((m) => m.to.text === 'gerente@fabrica.test').html)
        && !/localhost:3000\/(tecnico|admin)/.test(caixa.find((m) => m.to.text === 'oper@fabrica.test').html));
      ok('texto alternativo presente', m0.text.includes('Sintomas:'));
      ok('E1: todos com 1 anexo PDF ficha_<OM>.pdf', caixa.every((m) => m.attachments.length === 1 && m.attachments[0].contentType === 'application/pdf'
        && /^ficha_OM-\d{4}-\d{6}\.pdf$/.test(m.attachments[0].filename) && m.attachments[0].content.subarray(0, 5).toString() === '%PDF-'));
      ok('Fase 36 MIME: attachment + base64 + From com nome RFC 5322 + Auto-Submitted',
        caixa.every((m) => m.attachments[0].contentDisposition === 'attachment'
          && String(m.attachments[0].headers.get('content-transfer-encoding')) === 'base64'
          && m.from.value[0].name === 'Apex Industrial Technologies · CMMS'
          && String(m.headers.get('auto-submitted')) === 'auto-generated'));
      const omId = r.b.id;

      // --- atribuicao/reserva/assumir NAO geram e-mail (catalogo fechado de 4)
      caixa.length = 0;
      ok('TECNICO nao pode atribuir (403)', (await call('POST', `/ordens/${omId}/atribuir`, tec1, { tecnicoId: String(tec1.id) })).s === 403);
      ok('atribuir a operador e recusado (422)', (await call('POST', `/ordens/${omId}/atribuir`, gerente, { tecnicoId: String(oper.id) })).s === 422);
      r = await call('POST', `/ordens/${omId}/atribuir`, gerente, { tecnicoId: String(tec1.id) });
      await sleep(1500);
      ok('GERENTE atribui (200); nenhum e-mail', r.s === 200 && caixa.length === 0, caixa.map((m) => m.subject).join(' | '));
      r = await call('POST', '/ordens', oper, omBody({ maquinaParada: false, categoria: 'ELETRICO', sintomas: ['Nao liga'] }));
      const om2 = r.b.id;
      await esperarCaixa(4);
      caixa.length = 0;
      r = await call('POST', `/ordens/${om2}/assumir`, tec1, { pin: '1234' });
      await sleep(1500);
      ok('autoatribuicao (assumir): 200 e nenhum e-mail', r.s === 200 && caixa.length === 0, caixa.map((m) => m.to.text).join(','));

      // --- E2: tecnico finaliza -> solicitante + manutencao, SEM PDF
      r = await call('POST', `/ordens/${om2}/concluir`, tec1, { causaRaiz: 'Fusivel', acaoExecutada: 'Troca do fusivel' });
      await esperarCaixa(4);
      ok('E2: 4 destinatarios (todos os ativos com e-mail), assunto do evento e sem anexo', r.s === 200 && caixa.length === 4 && caixa.every((m) => /Serviço finalizado pelo técnico/.test(m.subject) && m.attachments.length === 0),
        caixa.map((m) => m.subject).join(' | '));
      // --- E3: solicitante aprova -> solicitante + manutencao, SEM PDF
      caixa.length = 0;
      r = await call('POST', `/ordens/${om2}/aprovar`, oper, { pin: '1234' });
      await esperarCaixa(4);
      ok('E3: aprovacao pelo solicitante, sem anexo', r.s === 200 && caixa.length === 4 && caixa.every((m) => /OM aprovada pelo solicitante/.test(m.subject) && m.attachments.length === 0),
        caixa.map((m) => m.subject).join(' | '));
      // --- E4: gerente encerra -> solicitante + manutencao, COM a ficha final (_final)
      caixa.length = 0;
      r = await call('POST', `/ordens/${om2}/encerrar`, gerente, { pin: '1234', custoTipo: 'INTERNO' });
      await esperarCaixa(4);
      ok('E4: conclusao, anexo ficha_<OM>_final.pdf e tempo/custo no corpo', r.s === 200 && caixa.length === 4
        && caixa.every((m) => /OM concluída/.test(m.subject) && m.attachments.length === 1 && /^ficha_OM-\d{4}-\d{6}_final\.pdf$/.test(m.attachments[0].filename) && m.text.includes('Tempo líquido total')),
        caixa.map((m) => m.subject + ' ' + (m.attachments[0]?.filename ?? '-')).join(' | ') + ' ' + JSON.stringify(r.b));
      const tiposBanco = (await prisma.$queryRaw<{ tipo: string; n: number }[]>`SELECT tipo, count(*)::int AS n FROM outbox_email GROUP BY tipo ORDER BY tipo`).map((x) => `${x.tipo}:${x.n}`).join();
      ok('outbox so contem os 4 tipos vitais', /^OM_ABERTURA:\d+,OM_APROVADA_SOLICITANTE:4,OM_CONCLUIDA_GESTOR:4,OM_FINALIZADA_TECNICO:4$/.test(tiposBanco), tiposBanco);

      // --- configuracao: mascara nao sobrescreve; novo valor e cifrado; teste de envio
      const admin = await prisma.usuario.findFirstOrThrow({ where: { email: 'admin@om.com.br' } });
      const antes = (await prisma.configuracaoGlobal.findUnique({ where: { chave: 'SMTP_PASS' } }))!.valor;
      const g = await call('GET', '/configuracoes', admin);
      ok('GET mascara o segredo', g.b.find((c: any) => c.chave === 'SMTP_PASS').valor === '********');
      await call('PUT', '/configuracoes/SMTP_PASS', admin, { valor: '********' });
      ok('PUT com mascara mantem o valor', (await prisma.configuracaoGlobal.findUnique({ where: { chave: 'SMTP_PASS' } }))!.valor === antes);
      caixa.length = 0;
      r = await call('POST', '/configuracoes/email/teste', admin, { para: 'qualquer@fabrica.test' });
      await sleep(500);
      ok('teste de envio (ADMIN)', r.s === 200 && caixa.length === 1, JSON.stringify(r.b));
      ok('teste de envio negado a GERENTE', (await call('POST', '/configuracoes/email/teste', gerente, { para: 'x@y.com' })).s === 403);
      await call('PUT', '/configuracoes/SMTP_PASS', admin, { valor: 'senha-errada' });
      r = await call('POST', '/configuracoes/email/teste', admin, { para: 'qualquer@fabrica.test' });
      ok('senha errada: 502 sem vazar a senha', r.s === 502 && !JSON.stringify(r.b).includes('senha-errada'), r.b.message);
      const novoRaw = (await prisma.configuracaoGlobal.findUnique({ where: { chave: 'SMTP_PASS' } }))!.valor!;
      ok('PUT grava cifrado', estaCifrado(novoRaw) && decifrar(novoRaw) === 'senha-errada');
      await call('PUT', '/configuracoes/SMTP_PASS', admin, { valor: 'legacy-pass' });

      // --- falha do SMTP nao derruba a rota
      falhar = true;
      r = await call('POST', '/ordens', oper, omBody({ maquinaParada: false, sintomas: ['x'] }));
      ok('SMTP com erro 451: rota segue 201', r.s === 201);
      await sleep(1200);
      falhar = false;
      await prisma.$executeRaw`UPDATE outbox_email SET status = 'CANCELADO' WHERE status IN ('PENDENTE', 'PROCESSANDO')`; // não reenviar o 451 depois do teste
      // --- EMAIL_ATIVO=false
      await prisma.configuracaoGlobal.create({ data: { chave: 'EMAIL_ATIVO', valor: 'false', tipo: 'BOOLEANO', grupo: 'EMAIL' } });
      invalidarCacheSmtp();
      caixa.length = 0;
      r = await call('POST', '/ordens', oper, omBody({ maquinaParada: false, sintomas: ['y'] }));
      await sleep(1500);
      ok('EMAIL_ATIVO=false: nenhum e-mail', r.s === 201 && caixa.length === 0);

    } finally {
      await worker?.parar();
      if (srv) await new Promise<void>((res) => srv.close(() => res()));
      invalidarCacheSmtp();
      // restaura a tabela de configurações (alguns roteiros a esvaziam) e libera conexões
      const { prisma: p } = await import('../../src/db.js');
      await p.configuracaoGlobal.deleteMany({ where: { chave: { in: CHAVES } } });
      if (_cfg.length > 0) { await p.configuracaoGlobal.createMany({ data: _cfg }); }
      await p.$disconnect();
    }
  }, 280_000);
});
