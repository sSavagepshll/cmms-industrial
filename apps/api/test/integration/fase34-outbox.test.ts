import { createRequire } from 'node:module';
import { describe, it } from 'vitest';
import { criarOk } from '../helpers/soft.js';
import { criarAmbiente } from '../helpers/ambiente.js';

// Fase 34 (Etapa 3): outbox transacional de e-mail (LISTEN/NOTIFY + polling), advisory lock nos jobs, paginação por cursor e reqId.
describe('Fase 34: outbox, advisory lock, cursor e reqId', () => {
  it('roteiro completo', async () => {
    process.env.SMTP_REQUIRE_TLS = 'false';
    const ok = criarOk();
    const amb = await criarAmbiente();
    const { app, prisma, call, mk, limparBanco } = amb;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const esperar = async (cond: () => boolean | Promise<boolean>, ms = 15_000) => {
      const fim = Date.now() + ms;
      while (Date.now() < fim) { if (await cond()) return true; await sleep(100); }
      return false;
    };
    const CHAVES = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'EMAIL_ATIVO'];
    const cfgAntes = await prisma.configuracaoGlobal.findMany({ where: { chave: { in: CHAVES } } });
    const workers: { parar(): Promise<void> }[] = [];

    const req = createRequire(import.meta.url);
    const { SMTPServer } = req('smtp-server');
    const { simpleParser } = req('mailparser');
    const caixa: any[] = [];
    let falhar = false;
    let senhaCerta = 'senha-ok';
    const srv = new SMTPServer({
      authOptional: false, disabledCommands: ['STARTTLS'], allowInsecureAuth: true,
      onAuth(a: any, _s: any, cb: any) { a.username === 'ti@fabrica.test' && a.password === senhaCerta ? cb(null, { user: 1 }) : cb(new Error('Invalid login')); },
      onData(stream: any, _s: any, cb: any) {
        simpleParser(stream).then((m: any) => { if (falhar) return cb(new Error('451 temporario')); caixa.push(m); cb(); }).catch(cb);
      },
    });
    await new Promise<void>((r) => srv.listen(2526, '127.0.0.1', r));

    try {
      const { migrarSegredosLegados } = await import('../../src/crypto/segredo.js');
      const { invalidarCacheSmtp } = await import('../../src/mail/smtp.js');
      const { enfileirarEmail, iniciarOutbox } = await import('../../src/mail/outbox.js');
      const { expirarReservas } = await import('../../src/jobs/fallback.js');
      const outbox = (where = '') => prisma.$queryRawUnsafe<any[]>(`SELECT * FROM outbox_email ${where} ORDER BY id`);

      await limparBanco();
      // Sobras de outros roteiros (usuários com e-mail) contaminariam os destinatários esperados.
      await prisma.usuario.deleteMany({ where: { email: { not: 'admin@om.com.br' }, NOT: { matricula: { startsWith: 'u' } } } });
      await prisma.$executeRaw`TRUNCATE outbox_email RESTART IDENTITY`;
      await prisma.configuracaoGlobal.deleteMany({ where: { chave: { in: CHAVES } } });
      for (const [chave, valor, tipo] of [['SMTP_HOST', '127.0.0.1', 'TEXTO'], ['SMTP_PORT', '2526', 'TEXTO'], ['SMTP_USER', 'ti@fabrica.test', 'TEXTO'], ['SMTP_PASS', 'senha-ok', 'SECRETO']]) {
        await prisma.configuracaoGlobal.create({ data: { chave: chave!, valor: valor!, tipo: tipo!, grupo: 'EMAIL' } });
      }
      await migrarSegredosLegados();
      invalidarCacheSmtp();

      const usr = (nome: string, perfil: any, matricula: string, email: string | null) =>
        mk(nome, perfil, matricula).then((u: any) => (email ? prisma.usuario.update({ where: { id: u.id }, data: { email } }) : u));
      const oper = await usr('Oper', 'OPERADOR', 'u34o', null);
      const ger = await usr('Gerente', 'GERENTE', 'u34g', 'ger34@fabrica.test');
      const tec = await usr('Tecnico', 'TECNICO', 'u34t', 'tec34@fabrica.test');
      const adm = await usr('Admin', 'ADMIN', 'u34a', null);
      const eq = await prisma.equipamento.create({ data: { codigo: 'F34-01', nome: 'Prensa 34', setor: 'Prensa' } });
      const omBody = (extra: object = {}) => ({ equipamentoId: String(eq.id), maquinaParada: false, categoria: 'MECANICO', sintomas: ['Ruído'], tipoAtivo: 'MAQUINA', confirmarDuplicidade: true, ...extra });

      // ---------- 1. produtor transacional ----------
      const msg = (extra: object = {}) => ({ tipo: 'OM_FINALIZADA_TECNICO', para: 'dest@fabrica.test', assunto: 'Assunto\r\nBcc: x@y.com', texto: 't', html: '<b>h</b>', ...extra });
      await prisma.$transaction(async (tx) => { await enfileirarEmail(tx, msg()); });
      const aposCommit = await outbox();
      ok('1. commit grava PENDENTE', aposCommit.length === 1 && aposCommit[0].status === 'PENDENTE' && aposCommit[0].max_tentativas === 6, JSON.stringify(aposCommit.map((r) => r.status)));
      ok('1. assunto sem CR/LF (header injection)', !/[\r\n]/.test(aposCommit[0].assunto), aposCommit[0].assunto);
      await prisma.$executeRaw`TRUNCATE outbox_email RESTART IDENTITY`;

      await prisma.$transaction(async (tx) => { await enfileirarEmail(tx, msg()); throw new Error('rollback'); }).catch(() => undefined);
      ok('1. rollback da ação não deixa e-mail', (await outbox()).length === 0);

      const dup = await prisma.$transaction(async (tx) => [
        await enfileirarEmail(tx, msg({ chaveDedupe: 'OM_FINALIZADA_TECNICO:1:dest@fabrica.test:a' })),
        await enfileirarEmail(tx, msg({ chaveDedupe: 'OM_FINALIZADA_TECNICO:1:dest@fabrica.test:a' })),
        await enfileirarEmail(tx, msg({ para: 'invalido com espaco' })),
      ]);
      ok('1. chaveDedupe repetida não duplica; destinatário inválido é descartado', JSON.stringify(dup) === '[true,false,false]' && (await outbox()).length === 1, JSON.stringify(dup));
      let tipoRuim = false;
      await prisma.$transaction(async (tx) => { await enfileirarEmail(tx, msg({ tipo: 'tipo ruim' })); }).catch(() => { tipoRuim = true; });
      ok('1. tipo inválido propaga (a transação falha)', tipoRuim);
      let antigo = false;
      await prisma.$transaction(async (tx) => { await enfileirarEmail(tx, msg({ tipo: 'OM_CRIADA' })); }).catch((e) => { antigo = e?.name === 'EmailTipoNaoPermitido'; });
      ok('1. Fase 35: tipo fora do catálogo vital (OM_CRIADA) -> EmailTipoNaoPermitido', antigo);
      let semAnexo = false;
      await prisma.$transaction(async (tx) => { await enfileirarEmail(tx, msg({ tipo: 'OM_ABERTURA' })); }).catch(() => { semAnexo = true; });
      ok('1. Fase 35: OM_ABERTURA sem anexo é recusada (RN-79)', semAnexo);
      let banco = false;
      await prisma.$executeRaw`INSERT INTO outbox_email (tipo, destinatario_email, assunto, corpo_texto, corpo_html) VALUES ('OM_CRIADA', 'x@y.com', 'a', 't', 'h')`.catch(() => { banco = true; });
      ok('1. Fase 35: o banco também recusa tipo fora do catálogo (V027)', banco);

      // ---------- 2. worker: drena o que já existe + LISTEN/NOTIFY ----------
      await prisma.$executeRaw`UPDATE outbox_email SET status = 'PROCESSANDO', bloqueado_por = 'morto:1', bloqueado_ate = now() - interval '1 minute'`;
      const w1 = iniciarOutbox(app.log); workers.push(w1);
      ok('2. lease expirado é recuperado e a linha é enviada', await esperar(async () => (await outbox("WHERE status = 'ENVIADO'")).length === 1) && caixa.length === 1);
      const env = (await outbox())[0];
      ok('2. ENVIADO guarda message_id, resposta e enviado_em', !!env.message_id && !!env.resposta_smtp && !!env.enviado_em && env.bloqueado_por === null, JSON.stringify({ m: env.message_id }));
      let imut = false;
      await prisma.$executeRaw`UPDATE outbox_email SET status = 'PENDENTE', bloqueado_por = NULL, bloqueado_ate = NULL, enviado_em = NULL`.catch(() => { imut = true; });
      ok('2. ENVIADO é terminal no banco (V024)', imut);

      // ---------- 3. rota -> outbox -> e-mail, com reqId ----------
      caixa.length = 0; await prisma.$executeRaw`TRUNCATE outbox_email RESTART IDENTITY`;
      let r = await app.inject({ method: 'POST', url: '/ordens', headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: String(oper.id), perfil: 'OPERADOR', nome: oper.nome }), 'x-request-id': 'req-teste-34-abc' }, payload: omBody({ maquinaParada: true }) });
      ok('3. POST /ordens 201 e X-Request-Id ecoado', r.statusCode === 201 && r.headers['x-request-id'] === 'req-teste-34-abc', String(r.headers['x-request-id']));
      const omId = JSON.parse(r.body).id;
      const linhas = await outbox('WHERE ordem_id IS NOT NULL');
      ok('3. outbox recebe 1 linha por destinatário (todos os ativos com e-mail, B-38-01)', linhas.length === 3 && linhas.map((l) => l.destinatario_email).sort().join() === 'admin@om.com.br,ger34@fabrica.test,tec34@fabrica.test', linhas.map((l) => l.destinatario_email).join());
      ok('3. linha carrega tipo, ordem e reqId de origem', linhas.every((l) => l.tipo === 'OM_ABERTURA' && l.anexo_id !== null && String(l.ordem_id) === String(omId) && l.req_id === 'req-teste-34-abc'));
      ok('3. NOTIFY acorda o worker (envio sem esperar o polling de 30 s)', await esperar(() => caixa.length === 3, 8_000), String(caixa.length));
      ok('3. e-mails entregues aos 3 destinatários', caixa.map((m) => m.to.text).sort().join() === 'admin@om.com.br,ger34@fabrica.test,tec34@fabrica.test');
      const rId = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'x\r\ny' } });
      ok('3. X-Request-Id inválido é substituído por UUID', /^[0-9a-f-]{36}$/.test(String(rId.headers['x-request-id'])), String(rId.headers['x-request-id']));

      // ---------- 4. dois workers não duplicam (SKIP LOCKED) ----------
      caixa.length = 0; await prisma.$executeRaw`TRUNCATE outbox_email RESTART IDENTITY`;
      const w2 = iniciarOutbox(app.log); workers.push(w2);
      await sleep(500);
      await prisma.$transaction(async (tx) => { for (let i = 0; i < 12; i++) await enfileirarEmail(tx, msg({ para: `lote${i}@fabrica.test`, assunto: `Lote ${i}` })); });
      await esperar(async () => (await outbox("WHERE status = 'ENVIADO'")).length === 12);
      await sleep(500);
      const assuntos = caixa.map((m) => m.subject);
      ok('4. 12 linhas, 12 envios (nenhum duplicado com 2 workers)', caixa.length === 12 && new Set(assuntos).size === 12, `${caixa.length}/${new Set(assuntos).size}`);
      ok('4. instâncias distintas', w1.instancia !== w2.instancia);

      // ---------- 5. falha temporária => backoff, recuperação sem reiniciar ----------
      caixa.length = 0; await prisma.$executeRaw`TRUNCATE outbox_email RESTART IDENTITY`;
      falhar = true;
      await prisma.$transaction(async (tx) => { await enfileirarEmail(tx, msg({ para: 'retry@fabrica.test', assunto: 'Retry' })); });
      ok('5. 451 => PENDENTE com tentativas=1 e próxima tentativa futura', await esperar(async () => { const l = (await outbox())[0]; return l?.status === 'PENDENTE' && l.tentativas === 1; }, 8_000));
      const l5 = (await outbox())[0];
      ok('5. backoff ~5 s e erro sem credenciais', l5.proxima_tentativa_em.getTime() > Date.now() - 1000 && !!l5.ultimo_erro && !l5.ultimo_erro.includes('senha'), String(l5.ultimo_erro));
      falhar = false;
      ok('5. timer de retentativa entrega sem NOTIFY', await esperar(async () => (await outbox())[0]?.status === 'ENVIADO', 15_000) && caixa.length === 1);

      // ---------- 6. permanente (EAUTH) => MORTO; reprocesso volta à fila ----------
      caixa.length = 0; await prisma.$executeRaw`TRUNCATE outbox_email RESTART IDENTITY`;
      senhaCerta = 'outra-senha';
      invalidarCacheSmtp();
      await prisma.$transaction(async (tx) => { await enfileirarEmail(tx, msg({ para: 'morto@fabrica.test', assunto: 'Morto' })); });
      ok('6. EAUTH => MORTO imediato', await esperar(async () => (await outbox())[0]?.status === 'MORTO', 8_000));
      const l6 = (await outbox())[0];
      ok('6. MORTO registra erro e conta a tentativa', l6.tentativas === 1 && !!l6.ultimo_erro, JSON.stringify({ t: l6.tentativas }));
      senhaCerta = 'senha-ok';
      invalidarCacheSmtp();
      await prisma.$executeRaw`UPDATE outbox_email SET status = 'PENDENTE', tentativas = 0, proxima_tentativa_em = now()`; // reprocesso: trigger notifica
      ok('6. reprocesso MORTO -> PENDENTE é enviado (NOTIFY do reprocesso)', await esperar(async () => (await outbox())[0]?.status === 'ENVIADO', 8_000) && caixa.length === 1);

      // ---------- 7. SMTP desativado => CANCELADO ----------
      await prisma.$executeRaw`TRUNCATE outbox_email RESTART IDENTITY`;
      await prisma.configuracaoGlobal.create({ data: { chave: 'EMAIL_ATIVO', valor: 'false', tipo: 'BOOLEANO', grupo: 'EMAIL' } });
      invalidarCacheSmtp();
      await prisma.$transaction(async (tx) => { await enfileirarEmail(tx, msg({ para: 'off@fabrica.test' })); });
      ok('7. EMAIL_ATIVO=false => CANCELADO (smtp_desativado)', await esperar(async () => { const l = (await outbox())[0]; return l?.status === 'CANCELADO' && l.ultimo_erro === 'smtp_desativado'; }, 8_000));
      await prisma.configuracaoGlobal.delete({ where: { chave: 'EMAIL_ATIVO' } });
      invalidarCacheSmtp();

      // ---------- 8. parar() é gracioso e idempotente ----------
      const t0 = Date.now();
      await w1.parar(); await w2.parar(); await w1.parar();
      ok('8. parar() retorna rápido sem trabalho em curso', Date.now() - t0 < 3_000, `${Date.now() - t0} ms`);

      // ---------- 9. advisory lock no job de expiração ----------
      await prisma.$executeRaw`TRUNCATE outbox_email RESTART IDENTITY`;
      r = await app.inject({ method: 'POST', url: '/ordens', headers: { authorization: 'Bearer ' + app.jwt.sign({ sub: String(oper.id), perfil: 'OPERADOR', nome: oper.nome }) }, payload: omBody() });
      const id9 = JSON.parse(r.body).id;
      const at = await call('POST', `/ordens/${id9}/atribuir`, ger, { tecnicoId: String(tec.id) });
      ok('9. delegação cria OM RESERVADA e NÃO gera e-mail (catálogo vital)', at.s === 200 && (await outbox("WHERE tipo <> 'OM_ABERTURA'")).length === 0);
      await prisma.$executeRaw`UPDATE ordens_manutencao SET delegado_em = now() - interval '30 minutes' WHERE id = ${BigInt(id9)}`;
      await prisma.$executeRaw`TRUNCATE outbox_email RESTART IDENTITY`;

      let encerrou = false;
      let pLock!: Promise<number>;
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('om:job:expirar_reservas'))`;
        pLock = expirarReservas(app.log).then((n) => { encerrou = true; return n; });
        await sleep(800);
      });
      ok('9. com o lock ocupado o ciclo espera (não roda em paralelo)', encerrou === false);
      const nLock = await pLock;
      ok('9. liberado o lock, o ciclo expira a reserva (1)', nLock === 1, String(nLock));

      // duas réplicas simultâneas: só uma expira, sem e-mail/auditoria em dobro
      await prisma.$executeRaw`UPDATE ordens_manutencao SET status = 'RESERVADA', responsavel_id = ${tec.id}, delegado_por = ${ger.id}, delegado_em = now() - interval '30 minutes', prazo_atendimento = NULL WHERE id = ${BigInt(id9)}`;
      await prisma.$executeRaw`TRUNCATE outbox_email RESTART IDENTITY`;
      const antesAud = await prisma.auditoria.count({ where: { acao: 'OM_RESERVA_EXPIRADA' } });
      const [a, b] = await Promise.all([expirarReservas(app.log), expirarReservas(app.log)]);
      ok('9. duas execuções concorrentes: exatamente uma expira', a + b === 1, `${a}+${b}`);
      const emails9 = await outbox();
      ok('9. Fase 35: expiração de reserva não gera e-mail', emails9.length === 0, String(emails9.length));
      ok('9. auditoria SISTEMA gravada uma vez, na mesma transação', (await prisma.auditoria.count({ where: { acao: 'OM_RESERVA_EXPIRADA' } })) - antesAud === 1);

      // ---------- 10. paginação por cursor ----------
      await limparBanco();
      const oper2 = await usr('Oper2', 'OPERADOR', 'u34p', null);
      const adm2 = await usr('Admin2', 'ADMIN', 'u34b', null);
      const eq2 = await prisma.equipamento.create({ data: { codigo: 'F34-02', nome: 'Prensa 2', setor: 'Prensa' } });
      for (let i = 0; i < 5; i++) {
        const c = await call('POST', '/ordens', oper2, { equipamentoId: String(eq2.id), maquinaParada: false, categoria: 'MECANICO', sintomas: [`s${i}`], tipoAtivo: 'MAQUINA', confirmarDuplicidade: true });
        if (c.s !== 201) ok(`10. criar OM ${i}`, false, JSON.stringify(c.b));
      }
      const todas = await call('GET', '/ordens?limit=50', adm2);
      ok('10. offset continua: X-Total-Count presente', todas.s === 200 && todas.h['x-total-count'] === '5' && !todas.h['x-next-cursor']);
      const vistos: string[] = [];
      let cursor: string | undefined;
      let paginas = 0;
      do {
        const p = await call('GET', `/ordens?limit=2${cursor ? `&cursor=${cursor}` : ''}`, adm2);
        if (p.s !== 200) { ok('10. página', false, JSON.stringify(p.b)); break; }
        if (cursor) ok('10. com cursor não há COUNT', p.h['x-total-count'] === undefined);
        vistos.push(...p.b.map((o: any) => String(o.id)));
        cursor = p.h['x-next-cursor'] as string | undefined;
        paginas++;
      } while (cursor && paginas < 10);
      ok('10. cursor percorre as 5 OMs em 3 páginas, na mesma ordem do offset, sem repetir', paginas === 3 && vistos.join() === todas.b.map((o: any) => String(o.id)).join() && new Set(vistos).size === 5, `${paginas} ${vistos.join()}`);
      ok('10. cursor + offset => 400', (await call('GET', '/ordens?cursor=eyJpIjoiMSJ9&offset=2', adm2)).s === 400);
      ok('10. cursor adulterado => 400', (await call('GET', '/ordens?cursor=lixo!!', adm2)).s === 400);
      ok('10. cursor de id inexistente => 200 vazio (sem 500)', (await call('GET', `/ordens?cursor=${Buffer.from('{"i":"999999"}').toString('base64url')}`, adm2)).s !== 500);

      const audCompleta = await call('GET', '/auditoria?limit=500', adm2);
      const audIds: string[] = [];
      let c2: string | undefined; let n2 = 0;
      do {
        const p = await call('GET', `/auditoria?limit=3${c2 ? `&cursor=${c2}` : ''}`, adm2);
        audIds.push(...p.b.map((x: any) => String(x.id)));
        c2 = p.h['x-next-cursor'] as string | undefined; n2++;
      } while (c2 && n2 < 50);
      ok('10. /auditoria por cursor == lista completa', audIds.length === audCompleta.b.length && audIds.join() === audCompleta.b.map((x: any) => String(x.id)).join(), `${audIds.length}/${audCompleta.b.length}`);
      void adm; void tec;
    } finally {
      for (const w of workers) await w.parar().catch(() => undefined);
      await new Promise<void>((r) => srv.close(() => r()));
      await prisma.configuracaoGlobal.deleteMany({ where: { chave: { in: CHAVES } } });
      if (cfgAntes.length > 0) await prisma.configuracaoGlobal.createMany({ data: cfgAntes });
      await prisma.$executeRaw`TRUNCATE outbox_email RESTART IDENTITY`;
      await amb.fechar();
    }
  }, 280_000);
});
