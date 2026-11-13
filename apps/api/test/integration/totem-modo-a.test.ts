import { createRequire } from 'node:module';
import { describe, it } from 'vitest';
import { criarOk, URL_TESTE } from '../helpers/soft.js';

// Convertido do roteiro e2e (verificações "moles": o teste mostra todas as falhas de uma vez).
describe('Sessão do totem (modo A: sem allowlist)', () => {
  it('roteiro completo', async () => {
    process.env.DATABASE_URL = URL_TESTE;
    process.env.JWT_SECRET ??= 'integration-test-secret-integration-test-secret-0123456789';

    const ok = criarOk();
    let _cfg: any[] = [];
    try {
      const MODO = 'A';
      if (MODO === 'B') {
        process.env.TOTENS_AUTORIZADOS = 'TOTEM-01, TOTEM-02';
        process.env.TOTEM_OBRIGATORIO_PERFIS = 'OPERADOR,LIDER_PRODUCAO';
      }
      const { buildApp } = await import('../../src/app.js');
      const { prisma } = await import('../../src/db.js');
      _cfg = await prisma.configuracaoGlobal.findMany();
      const { hashPin } = await import('../../src/auth/password.js');
      const { consumirTicket } = await import('../../src/events.js');
      const { config } = await import('../../src/config.js');
      const app = buildApp(); await app.ready();

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const decode = (t: string) => JSON.parse(Buffer.from(t.split('.')[1]!, 'base64url').toString());

      await prisma.usuario.deleteMany({ where: { matricula: { startsWith: 'k' } } });
      const pin = await hashPin('1234');
      const mk = (nome: string, perfil: any, matricula: string) => prisma.usuario.create({ data: { nome, perfil, matricula, pinHash: pin } });
      const oper = await mk('Oper K', 'OPERADOR', 'k1');
      const tec = await mk('Tec K', 'TECNICO', 'k2');
      await mk('Admin K (sessão de totem; TECNICO não entra no totem desde a Fase 32)', 'ADMIN', 'k5');
      const lider = await mk('Lider K', 'LIDER_PRODUCAO', 'k3');
      const ger = await mk('Gerente K', 'GERENTE', 'k4');
      let nIp = 0; // IP distinto por chamada: o limite por IP (10/min) não é o que está sendo testado aqui
      const post = async (url: string, payload: any, headers: Record<string, string> = {}) => {
        nIp++;
        const r = await app.inject({ method: 'POST', url, payload, headers, remoteAddress: `10.9.${nIp >> 8}.${nIp & 255}` });
        let b: any = null; try { b = r.body ? JSON.parse(r.body) : null; } catch { b = r.body; }
        return { s: r.statusCode, b };
      };
      const get = async (url: string, token: string, headers: Record<string, string> = {}) => {
        const r = await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer ' + token, ...headers } });
        let b: any = null; try { b = r.body ? JSON.parse(r.body) : null; } catch { b = r.body; }
        return { s: r.statusCode, b };
      };
      console.log(`=== MODO ${MODO}: TTL kiosk=${config.KIOSK_TOKEN_TTL_S}s, autorizados=[${config.TOTENS_AUTORIZADOS}], obrigatório=[${config.TOTEM_OBRIGATORIO_PERFIS}] ===`);

      if (MODO === 'A') {
        console.log('--- login do totem ---');
        let r = await post('/auth/pin', { matricula: 'k5', pin: '1234', totemId: 'TOTEM-01' });
        const tk = r.b.token as string;
        const p = decode(tk);
        ok('login com Device ID (corpo): sessão TOTEM com TTL configurado', r.s === 200 && r.b.sessao === 'TOTEM' && r.b.expiraEmSegundos === config.KIOSK_TOKEN_TTL_S && r.b.totemId === 'TOTEM-01', JSON.stringify({ s: r.b.sessao, e: r.b.expiraEmSegundos }));
        ok('JWT: exp - iat = TTL exato e claim tid', p.exp - p.iat === config.KIOSK_TOKEN_TTL_S && p.tid === 'TOTEM-01', `exp-iat=${p.exp - p.iat} tid=${p.tid}`);
        ok('JWT: continua com iss/aud e HS256', p.iss === 'om-api' && p.aud === 'om-kiosk');
        r = await post('/auth/pin', { matricula: 'k5', pin: '1234' }, { 'X-Totem-Id': 'TOTEM-02' });
        ok('Device ID também aceito no header X-Totem-Id', r.s === 200 && r.b.sessao === 'TOTEM' && r.b.totemId === 'TOTEM-02');
        r = await post('/auth/pin', { matricula: 'k5', pin: '1234', totemId: 'TOTEM-01' }, { 'X-Totem-Id': 'TOTEM-02' });
        ok('corpo ≠ header -> 400 TOTEM_ID_DIVERGENTE', r.s === 400 && r.b.error === 'TOTEM_ID_DIVERGENTE');
        r = await post('/auth/pin', { matricula: 'k5', pin: '1234', totemId: 'tot em;01' });
        ok('Device ID com caracteres inválidos -> 400', r.s === 400);
        r = await post('/auth/pin', { matricula: 'k2', pin: '1234' });
        const pp = decode(r.b.token);
        ok('login sem Device ID continua sessão PADRAO (sem tid)', r.s === 200 && r.b.sessao === 'PADRAO' && pp.tid === undefined && pp.exp - pp.iat === 300, `exp-iat=${pp.exp - pp.iat}`);

        console.log('--- vínculo ao dispositivo em toda requisição ---');
        let m = await get('/auth/me', tk, { 'X-Totem-Id': 'TOTEM-01' });
        ok('mesmo Device ID -> 200 com totemId e expiraEm', m.s === 200 && m.b.totemId === 'TOTEM-01' && new Date(m.b.expiraEm).getTime() === p.exp * 1000);
        m = await get('/auth/me', tk, { 'X-TOTEM-ID': 'TOTEM-01' });
        ok('nome do header não diferencia maiúsculas', m.s === 200);
        m = await get('/auth/me', tk);
        ok('sem header X-Totem-Id -> 401 SESSAO_TOTEM_INVALIDA', m.s === 401 && m.b.error === 'SESSAO_TOTEM_INVALIDA');
        m = await get('/auth/me', tk, { 'X-Totem-Id': 'TOTEM-02' });
        ok('Device ID diferente (token usado em outro aparelho) -> 401', m.s === 401 && m.b.error === 'SESSAO_TOTEM_INVALIDA');
        m = await get('/auth/me', tk, { 'X-Totem-Id': 'totem-01' });
        ok('Device ID é sensível a maiúsculas -> 401', m.s === 401);
        m = await get('/ordens/fila', tk, { 'X-Totem-Id': 'TOTEM-01' });
        ok('rota de negócio com vínculo correto funciona (200)', m.s === 200);
        m = await get('/ordens/fila', tk);
        ok('rota de negócio sem o vínculo -> 401', m.s === 401 && m.b.error === 'SESSAO_TOTEM_INVALIDA');
        const m2 = await get('/auth/me', tk, { 'X-Totem-Id': 'TOTEM-01' });
        ok('expiração é absoluta: usar o token não estende o exp', m2.b.expiraEm === m.b?.expiraEm || new Date(m2.b.expiraEm).getTime() === p.exp * 1000);

        console.log('--- expiração estrita ---');
        const forjadoLongo = app.jwt.sign({ sub: String(tec.id), perfil: 'TECNICO', nome: 'x', tid: 'TOTEM-01' }, { expiresIn: `${config.KIOSK_TOKEN_TTL_S + 60}s` });
        m = await get('/auth/me', forjadoLongo, { 'X-Totem-Id': 'TOTEM-01' });
        ok('token de totem com duração > TTL é rejeitado (defesa em profundidade)', m.s === 401 && m.b.error === 'SESSAO_TOTEM_INVALIDA');
        const curto = app.jwt.sign({ sub: String(tec.id), perfil: 'TECNICO', nome: 'x', tid: 'TOTEM-01' }, { expiresIn: '2s' });
        m = await get('/auth/me', curto, { 'X-Totem-Id': 'TOTEM-01' });
        ok('token de 2 s vale agora', m.s === 200);
        await sleep(3200);
        m = await get('/auth/me', curto, { 'X-Totem-Id': 'TOTEM-01' });
        ok('e expira de verdade -> 401 NAO_AUTENTICADO', m.s === 401 && m.b.error === 'NAO_AUTENTICADO');

        console.log('--- SSE herda o vínculo e o fim da sessão ---');
        const sse1 = app.jwt.sign({ sub: String(tec.id), perfil: 'TECNICO', nome: 'x', tid: 'TOTEM-01' }, { expiresIn: '4s' });
        let tr = await post('/eventos/ticket', {}, { authorization: 'Bearer ' + sse1, 'x-totem-id': 'TOTEM-01' });
        ok('ticket emitido na sessão de totem', tr.s === 200 && typeof tr.b.ticket === 'string');
        let rr = await app.inject({ method: 'GET', url: `/eventos?ticket=${tr.b.ticket}` });
        ok('stream sem ?totem= -> 401 SESSAO_TOTEM_INVALIDA', rr.statusCode === 401);
        tr = await post('/eventos/ticket', {}, { authorization: 'Bearer ' + sse1, 'x-totem-id': 'TOTEM-01' });
        rr = await app.inject({ method: 'GET', url: `/eventos?ticket=${tr.b.ticket}&totem=TOTEM-02` });
        ok('stream com outro Device ID -> 401', rr.statusCode === 401);
        tr = await post('/eventos/ticket', {}, { authorization: 'Bearer ' + sse1, 'x-totem-id': 'TOTEM-01' });
        const vinc = consumirTicket(tr.b.ticket);
        ok('ticket carrega tid e o fim absoluto da sessão (exp do JWT)', vinc?.tid === 'TOTEM-01' && vinc.sessaoExp === decode(sse1).exp);
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        tr = await post('/eventos/ticket', {}, { authorization: 'Bearer ' + sse1, 'x-totem-id': 'TOTEM-01' });
        await app.listen({ port: 0, host: '127.0.0.1' });
        const porta = (app.server.address() as any).port;
        const proto = 'setSecureContext' in app.server ? 'https' : 'http';
        const t0 = Date.now();
        const res = await fetch(`${proto}://127.0.0.1:${porta}/eventos?ticket=${tr.b.ticket}&totem=TOTEM-01`);
        const reader = res.body!.getReader();
        let primeiro = '';
        while (!primeiro.includes('conectado')) { const x = await reader.read(); if (x.done) break; primeiro += new TextDecoder().decode(x.value); }
        ok('stream abre no dispositivo certo (evento conectado)', res.status === 200 && primeiro.includes('conectado'));
        let fim = false;
        while (true) { const { done } = await reader.read(); if (done) { fim = true; break; } }
        const dur = Date.now() - t0;
        ok('stream é ENCERRADO no fim da sessão (~4 s), não fica aberto', fim && dur < 6500 && dur > 1500, `${dur} ms`);

        console.log('--- força bruta continua limitada ---');
        for (let i = 0; i < 5; i++) await post('/auth/pin', { matricula: 'k1', pin: '0000', totemId: 'TOTEM-01' });
        r = await post('/auth/pin', { matricula: 'k1', pin: '1234', totemId: 'TOTEM-01' });
        ok('5 PINs errados bloqueiam a matrícula mesmo com Device ID (429)', r.s === 429 && r.b.error === 'CONTA_BLOQUEADA_TEMPORARIAMENTE');
        r = await post('/auth/pin', { matricula: 'k3', pin: '9999', totemId: 'TOTEM-01' });
        ok('PIN errado no totem: mesma mensagem genérica (401)', r.s === 401 && r.b.error === 'CREDENCIAIS_INVALIDAS');
      }

      if (MODO === 'B') {
        console.log('--- lista de totens autorizados ---');
        let r = await post('/auth/pin', { matricula: 'k5', pin: '1234', totemId: 'TOTEM-99' });
        ok('totem fora da lista -> 403 TOTEM_NAO_AUTORIZADO (mesmo com PIN certo)', r.s === 403 && r.b.error === 'TOTEM_NAO_AUTORIZADO');
        for (let i = 0; i < 7; i++) await post('/auth/pin', { matricula: 'k5', pin: '0000', totemId: 'TOTEM-99' });
        r = await post('/auth/pin', { matricula: 'k5', pin: '1234', totemId: 'TOTEM-01' });
        ok('tentativas de totem não autorizado NÃO bloqueiam o usuário (não consomem PIN)', r.s === 200 && r.b.sessao === 'TOTEM');
        const tk = r.b.token as string;
        const forjado = app.jwt.sign({ sub: String(tec.id), perfil: 'TECNICO', nome: 'x', tid: 'TOTEM-77' }, { expiresIn: '60s' });
        let m = await get('/auth/me', forjado, { 'X-Totem-Id': 'TOTEM-77' });
        ok('token de totem que deixou de ser autorizado -> 401', m.s === 401 && m.b.error === 'SESSAO_TOTEM_INVALIDA');
        m = await get('/auth/me', tk, { 'X-Totem-Id': 'TOTEM-01' });
        ok('totem autorizado segue funcionando (200)', m.s === 200);

        console.log('--- perfis que só entram por totem ---');
        r = await post('/auth/pin', { matricula: 'k1', pin: '1234' });
        ok('OPERADOR sem Device ID -> 403 TOTEM_OBRIGATORIO', r.s === 403 && r.b.error === 'TOTEM_OBRIGATORIO');
        r = await post('/auth/pin', { matricula: 'k3', pin: '1234' });
        ok('LIDER_PRODUCAO sem Device ID -> 403', r.s === 403 && r.b.error === 'TOTEM_OBRIGATORIO');
        r = await post('/auth/pin', { matricula: 'k1', pin: '1234', totemId: 'TOTEM-02' });
        ok('OPERADOR com totem autorizado -> 200 (120 s)', r.s === 200 && r.b.expiraEmSegundos === 120);
        r = await post('/auth/pin', { matricula: 'k2', pin: '1234' });
        ok('TECNICO sem Device ID continua permitido (fora da lista)', r.s === 200 && r.b.sessao === 'PADRAO');
        r = await post('/auth/pin', { matricula: 'k4', pin: '1234' });
        ok('GERENTE sem Device ID continua permitido (painel no PC)', r.s === 200 && r.b.sessao === 'PADRAO');
        r = await post('/auth/pin', { matricula: 'k1', pin: '0000' });
        ok('PIN errado sem Device ID: 401 genérico (não revela o perfil)', r.s === 401 && r.b.error === 'CREDENCIAIS_INVALIDAS');
      }

      await prisma.usuario.deleteMany({ where: { matricula: { startsWith: 'k' } } });

    } finally {
      // restaura a tabela de configurações (alguns roteiros a esvaziam) e libera conexões
      const { prisma: p } = await import('../../src/db.js');
      if (_cfg.length > 0) { await p.configuracaoGlobal.deleteMany({}); await p.configuracaoGlobal.createMany({ data: _cfg }); }
      await p.$disconnect();
    }
  }, 280_000);
});
