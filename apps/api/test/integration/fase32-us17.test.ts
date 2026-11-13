import { describe, it } from 'vitest';
import { criarOk } from '../helpers/soft.js';
import { criarAmbiente } from '../helpers/ambiente.js';

const MSG_TOTEM_TEC = 'Acesso restrito. Técnicos de manutenção devem utilizar o portal exclusivo (/tecnico).';
const MSG_TOTEM_OUTRO = 'Acesso restrito. Utilize o painel de gestão (/admin).';
const MSG_PORTAL = 'Acesso exclusivo para técnicos de manutenção e administradores.';

describe('Fase 32 — US-17 (acesso por portal)', () => {
  it('política de login por portal (contrato §3.2 e §6)', async () => {
    const ok = criarOk();
    const A = await criarAmbiente();
    const { prisma, mk, app } = A;
    const { config } = await import('../../src/config.js');
    const permitidosOriginais = [...config.TOTEM_PERFIS_PERMITIDOS];
    let n = 0; // IP distinto por chamada: o limite por IP (10/min) não é o objeto aqui
    const login = async (matricula: string, pin: string, extra: object = {}, headers: Record<string, string> = {}) => {
      n++;
      const r = await app.inject({ method: 'POST', url: '/auth/pin', payload: { matricula, pin, ...extra }, headers, remoteAddress: `10.32.${n >> 8}.${n & 255}` });
      let b: any = null; try { b = JSON.parse(r.body); } catch { b = r.body; }
      return { s: r.statusCode, b, h: r.headers };
    };
    try {
      await A.limparBanco();
      await mk('Oper', 'OPERADOR', 'u32_op');
      await mk('Lider', 'LIDER_PRODUCAO', 'u32_li');
      await mk('Tec', 'TECNICO', 'u32_te');
      await mk('Ger', 'GERENTE', 'u32_ge');
      const adm = await mk('Adm', 'ADMIN', 'u32_ad');
      const PIN = '1234'; const TID = { totemId: 'TOTEM-32' };

      // 1. TECNICO no totem
      let r = await login('u32_te', PIN, TID);
      ok('1. TECNICO + PIN certo + totemId -> 403 PERFIL_NAO_PERMITIDO_NO_TOTEM com mensagem exata',
        r.s === 403 && r.b.error === 'PERFIL_NAO_PERMITIDO_NO_TOTEM' && r.b.message === MSG_TOTEM_TEC, JSON.stringify(r.b));
      ok('1. sem token no corpo e sem Set-Cookie', r.b.token === undefined && r.h['set-cookie'] === undefined);
      r = await login('u32_te', PIN, {}, { 'X-Totem-Id': 'TOTEM-32' });
      ok('1. totem via header X-Totem-Id também bloqueia', r.s === 403 && r.b.error === 'PERFIL_NAO_PERMITIDO_NO_TOTEM');

      // 2. sem oráculo de perfil e sem consumir tentativas
      r = await login('u32_te', '9999', TID);
      ok('2. TECNICO + PIN errado + totemId -> 401 genérico', r.s === 401 && r.b.error === 'CREDENCIAIS_INVALIDAS');
      for (let i = 0; i < 6; i++) await login('u32_te', PIN, TID);
      r = await login('u32_te', PIN, {});
      ok('2. bloqueios de política não contam como falha (sem 429; TECNICO sem totem segue 200)', r.s === 200 && r.b.sessao === 'PADRAO', `${r.s}`);

      // 3. perfis permitidos no totem
      for (const m of ['u32_op', 'u32_li', 'u32_ad']) {
        r = await login(m, PIN, TID);
        ok(`3. ${m} + totemId -> 200 sessão TOTEM`, r.s === 200 && r.b.sessao === 'TOTEM' && r.b.totemId === 'TOTEM-32' && typeof r.b.token === 'string');
      }

      // 4. GERENTE (matriz C3) e reversão por config
      r = await login('u32_ge', PIN, TID);
      ok('4. GERENTE + totemId -> 403 com mensagem do painel de gestão', r.s === 403 && r.b.error === 'PERFIL_NAO_PERMITIDO_NO_TOTEM' && r.b.message === MSG_TOTEM_OUTRO);
      (config as any).TOTEM_PERFIS_PERMITIDOS = [...permitidosOriginais, 'GERENTE'];
      r = await login('u32_ge', PIN, TID);
      ok('4. com GERENTE em TOTEM_PERFIS_PERMITIDOS -> 200', r.s === 200 && r.b.sessao === 'TOTEM');
      (config as any).TOTEM_PERFIS_PERMITIDOS = permitidosOriginais;

      // 5. portal TECNICO
      const P = { portal: 'TECNICO' };
      for (const m of ['u32_te', 'u32_ad']) {
        r = await login(m, PIN, P);
        ok(`5. ${m} + portal TECNICO -> 200 sessão PADRAO`, r.s === 200 && r.b.sessao === 'PADRAO');
      }
      for (const m of ['u32_op', 'u32_li', 'u32_ge']) {
        r = await login(m, PIN, P);
        ok(`5. ${m} + portal TECNICO -> 403 PERFIL_NAO_PERMITIDO_NO_PORTAL_TECNICO`, r.s === 403 && r.b.error === 'PERFIL_NAO_PERMITIDO_NO_PORTAL_TECNICO' && r.b.message === MSG_PORTAL && r.b.token === undefined);
      }

      // 6. PADRAO sem restrição
      r = await login('u32_te', PIN);
      ok('6. TECNICO sem totemId/portal -> 200 PADRAO', r.s === 200 && r.b.sessao === 'PADRAO');
      r = await login('u32_ge', PIN);
      ok('6. GERENTE sem totemId/portal -> 200 PADRAO (/admin)', r.s === 200 && r.b.sessao === 'PADRAO');

      // 7. validação
      r = await login('u32_te', PIN, { ...P, ...TID });
      ok('7. portal + totemId -> 400 VALIDACAO', r.s === 400 && r.b.error === 'VALIDACAO' && r.b.message === 'Portal e totemId são mutuamente exclusivos.');
      r = await login('u32_te', PIN, P, { 'X-Totem-Id': 'TOTEM-32' });
      ok('7. portal + X-Totem-Id (header) -> 400', r.s === 400);
      ok('7. portal diferente de TECNICO -> 400', (await login('u32_te', PIN, { portal: 'OUTRO' })).s === 400);
      ok('7. campo desconhecido -> 400', (await login('u32_te', PIN, { extra: 1 })).s === 400);

      // 10. auditoria e log
      const aud = await prisma.auditoria.findMany({ where: { acao: 'LOGIN_PERFIL_BLOQUEADO' }, orderBy: { id: 'asc' } });
      ok('10. bloqueios auditados (LOGIN_PERFIL_BLOQUEADO, alvo USUARIO)', aud.length >= 8 && aud.every((a) => a.alvoTipo === 'USUARIO'), String(aud.length));
      const d = aud[0]!.detalhe as any;
      ok('10. detalhe sem PIN/token: portal, perfil, totemId', d.portal === 'TOTEM' && d.perfil === 'TECNICO' && d.totemId === 'TOTEM-32' && !JSON.stringify(aud.map((a) => a.detalhe)).includes(PIN));
      void adm;
    } finally {
      (config as any).TOTEM_PERFIS_PERMITIDOS = permitidosOriginais;
      await A.limparBanco(); // TRUNCATE da auditoria (imutável por DELETE) e remoção dos usuários 'u*'
      await A.fechar();
    }
  });
});
