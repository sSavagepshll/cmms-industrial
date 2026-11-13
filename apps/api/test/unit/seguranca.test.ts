import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { limpar } from '../../src/auditoria.js';
import { cifrar, decifrar, estaCifrado } from '../../src/crypto/segredo.js';
import { hashPin, hashSenha, SENHA_MAX_BYTES, verifyPin, verifySenha } from '../../src/auth/password.js';
import { bloqueadoAte, limparFalhas, registrarFalha, segundosBloqueado } from '../../src/auth/lockout.js';
import { consumirTicket, emitirTicket } from '../../src/events.js';
import { erroSeguro } from '../../src/mail/mailer.js';
import { toJSON } from '../../src/serialize.js';
import { prisma } from '../../src/db.js';

describe('criptografia de segredos (AES-256-GCM)', () => {
  it('cifra e decifra; a saída não revela o texto e muda a cada vez (IV aleatório)', () => {
    const a = cifrar('minha-senha-smtp'), b = cifrar('minha-senha-smtp');
    expect(estaCifrado(a)).toBe(true);
    expect(a).toMatch(/^enc:v1:/);
    expect(a).not.toContain('minha-senha-smtp');
    expect(a).not.toBe(b);
    expect(decifrar(a)).toBe('minha-senha-smtp');
    expect(decifrar(b)).toBe('minha-senha-smtp');
  });
  it('preserva acentos e emojis', () => expect(decifrar(cifrar('açaí-ñ-日本-🔒'))).toBe('açaí-ñ-日本-🔒'));
  it('valor adulterado no banco é rejeitado (GCM autentica)', () => {
    const c = cifrar('x');
    expect(() => decifrar(c.slice(0, -4) + 'AAAA')).toThrow();
    const [p1, p2, p3, iv, tag, ct] = c.split(':');
    expect(() => decifrar([p1, p2, p3, iv, 'AAAAAAAAAAAAAAAAAAAAAA==', ct].join(':'))).toThrow();
    void tag;
  });
  it('segredo legado em texto puro é devolvido como está (migrado no boot)', () => {
    expect(estaCifrado('senha-antiga')).toBe(false);
    expect(decifrar('senha-antiga')).toBe('senha-antiga');
  });
  it('formato malformado falha explicitamente', () => expect(() => decifrar('enc:v1:so-uma-parte')).toThrow(/malformado/));
});

describe('auditoria.limpar: nunca grava PIN, senha, segredo, prototype pollution ou controle ASCII', () => {
  it('descarta chaves sensíveis e vetores de prototype pollution em qualquer nível', () => {
    const r = limpar({
      ok: 1, pin: '1234', novoPin: '9', senha: 'x', senhaHash: 'h', SMTP_PASS: 'p', token: 't',
      authorization: 'Bearer x', segredo: 's', pinHash: 'h', cookie: 'c', jwt: 'j', api_key: 'k',
      credencial: 'cr', chave_privada: 'pk', constructor: 'bad', prototype: 'bad',
      aninhado: { cliente_secret: 'c', password: 'p', nome: 'Ana', lista: [{ pin: '1', n: 2 }] },
    });
    expect(r).toEqual({ ok: 1, aninhado: { nome: 'Ana', lista: [{ n: 2 }] } });
  });
  it('remove caracteres de controle ASCII (prevenção de Log Injection / ANSI escape)', () => {
    const sujo = ' Setor\u0000\u001b[31mMalicioso\u0007 ';
    expect(limpar({ texto: sujo })).toEqual({ texto: ' Setor[31mMalicioso ' });
  });
  it('converte BigInt e Date, corta textos longos e limita a profundidade/tamanho', () => {
    expect(limpar({ id: 12n, em: new Date('2026-01-02T03:04:05Z') })).toEqual({ id: '12', em: '2026-01-02T03:04:05.000Z' });
    expect((limpar({ t: 'a'.repeat(900) }) as any).t).toHaveLength(500);
    expect(limpar(Array.from({ length: 80 }, (_, i) => i))).toHaveLength(50);
    expect(limpar({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({ a: { b: { c: { d: null } } } });
    expect(limpar(null)).toBeNull();
    expect(limpar(undefined)).toBeNull();
  });
});

  it('higieniza auditoria de GRUPO_ATIVO: preserva metadados válidos, remove chaves sensíveis e controle ASCII', () => {
    const limpo = limpar({
      codigo: 'PRODUTIVOS',
      de: 'Máquinas Produtivas\u0000\u001b[31m',
      para: 'Máquinas e Equip. Produtivos',
      ordemDe: 1,
      ordemPara: 2,
      pin: '1234',
      senha: 'secreta',
      __proto__: { admin: true },
    });
    expect(limpo).toEqual({
      codigo: 'PRODUTIVOS',
      de: 'Máquinas Produtivas[31m',
      para: 'Máquinas e Equip. Produtivos',
      ordemDe: 1,
      ordemPara: 2,
    });
    expect(limpo).not.toHaveProperty('pin');
    expect(limpo).not.toHaveProperty('senha');
  });

describe('PIN (scrypt) e senha (bcrypt)', () => {
  it('PIN: confere o certo, recusa o errado, sal aleatório, formato scrypt', async () => {
    const h1 = await hashPin('1234'), h2 = await hashPin('1234');
    expect(h1).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(h1).not.toBe(h2);
    expect(await verifyPin('1234', h1)).toBe(true);
    expect(await verifyPin('1235', h1)).toBe(false);
    expect(await verifyPin('', h1)).toBe(false);
  });
  it('PIN: hash malformado ou de outro algoritmo nunca valida', async () => {
    expect(await verifyPin('1234', 'texto-qualquer')).toBe(false);
    expect(await verifyPin('1234', '$2a$12$abcdefghijklmnopqrstuuAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(await verifyPin('1234', 'scrypt$32768$8$1$AAAA')).toBe(false);
  });
  it('senha: bcrypt custo 12 e limite de 72 bytes', async () => {
    const h = await hashSenha('Senha@1234');
    expect(h).toMatch(/^\$2[aby]\$12\$/);
    expect(await verifySenha('Senha@1234', h)).toBe(true);
    expect(await verifySenha('senha@1234', h)).toBe(false);
    expect(SENHA_MAX_BYTES).toBe(72);
  }, 30_000);
});

describe('bloqueio por tentativas de PIN', () => {
  afterEach(() => { vi.useRealTimers(); limparFalhas('m-teste'); limparFalhas('m-b'); });
  it('4 falhas não bloqueiam; a 5ª bloqueia por 15 min; limpar libera', () => {
    for (let i = 0; i < 4; i++) registrarFalha('m-teste');
    expect(segundosBloqueado('m-teste')).toBe(0);
    registrarFalha('m-teste');
    expect(segundosBloqueado('m-teste')).toBeGreaterThan(14 * 60);
    expect(segundosBloqueado('m-teste')).toBeLessThanOrEqual(15 * 60);
    expect(bloqueadoAte('m-teste')!.getTime()).toBeGreaterThan(Date.now());
    limparFalhas('m-teste');
    expect(segundosBloqueado('m-teste')).toBe(0);
    expect(bloqueadoAte('m-teste')).toBeNull();
  });
  it('é por matrícula (independe das outras) e expira com o tempo', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) registrarFalha('m-b');
    expect(segundosBloqueado('m-b')).toBeGreaterThan(0);
    expect(segundosBloqueado('m-teste')).toBe(0);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1000);
    expect(segundosBloqueado('m-b')).toBe(0);
    expect(bloqueadoAte('m-b')).toBeNull();
  });
});

describe('ticket do SSE (uso único, 30 s, vínculo ao totem)', () => {
  afterEach(() => vi.useRealTimers());
  it('uso único', () => {
    const { ticket } = emitirTicket('7');
    expect(consumirTicket(ticket)).toEqual({ sub: '7' });
    expect(consumirTicket(ticket)).toBeNull();
  });
  it('herda o Device ID e o fim absoluto da sessão do totem', () => {
    const { ticket } = emitirTicket('7', { tid: 'TOTEM-01', sessaoExp: 1_900_000_000 });
    expect(consumirTicket(ticket)).toEqual({ sub: '7', tid: 'TOTEM-01', sessaoExp: 1_900_000_000 });
  });
  it('expira em 30 s e ticket desconhecido é recusado', () => {
    vi.useFakeTimers();
    const { ticket, expiraEmSegundos } = emitirTicket('7');
    expect(expiraEmSegundos).toBe(30);
    vi.advanceTimersByTime(31_000);
    expect(consumirTicket(ticket)).toBeNull();
    expect(consumirTicket('nao-existe')).toBeNull();
  });
});

describe('utilitários', () => {
  it('erroSeguro: só código, resposta e a 1ª linha da mensagem (sem credenciais)', () => {
    expect(erroSeguro({ code: 'EAUTH', responseCode: 535, message: '535 5.7.8 authentication failed\nAUTH PLAIN dXNlcjpzZW5oYQ==' })).toBe('EAUTH 535 535 5.7.8 authentication failed');
    expect(erroSeguro(new Error('falhou'))).toBe('falhou');
  });
  it('toJSON converte BigInt (ids) em string em qualquer profundidade', () => {
    expect(toJSON({ id: 1n, itens: [{ id: 22n }], n: 3, d: new Date('2026-01-01T00:00:00Z') })).toEqual({ id: '1', itens: [{ id: '22' }], n: 3, d: '2026-01-01T00:00:00.000Z' });
  });
});

describe('Hardening HTTP, CORS, BAC, JWT e Anti-Injeção (OWASP Top 10)', () => {
  it('emite headers de segurança estritos (CSP, X-Frame-Options, HSTS, nosniff, Referrer-Policy)', async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/config/publica' });
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    await app.close();
  });

  it('política de CORS: bloqueia origens externas maliciosas e domínios forjados com prefixo numérico', async () => {
    const app = buildApp();
    await app.ready();
    const maliciosa = await app.inject({
      method: 'OPTIONS',
      url: '/ordens',
      headers: { origin: 'https://evil-hacker.com', 'access-control-request-method': 'GET' },
    });
    expect(maliciosa.headers['access-control-allow-origin']).toBeUndefined();

    const prefixoFalso = await app.inject({
      method: 'OPTIONS',
      url: '/ordens',
      headers: { origin: 'http://10.evil.com', 'access-control-request-method': 'GET' },
    });
    expect(prefixoFalso.headers['access-control-allow-origin']).toBeUndefined();

    const intranetValida = await app.inject({
      method: 'OPTIONS',
      url: '/ordens',
      headers: { origin: 'https://192.168.1.50:3000', 'access-control-request-method': 'GET' },
    });
    expect(intranetValida.headers['access-control-allow-origin']).toBe('https://192.168.1.50:3000');
    await app.close();
  });

  it('rejeita Mass Assignment e payloads de injeção em /auth/pin, /auth/login e /auth/totem (400 VALIDACAO)', async () => {
    const app = buildApp();
    await app.ready();
    for (const endpoint of ['/auth/pin', '/auth/login', '/auth/totem']) {
      // Mass assignment (campo extra não permitido pelo .strict())
      const mass = await app.inject({
        method: 'POST',
        url: endpoint,
        payload: { matricula: '333444', pin: '1234', perfil: 'ADMIN', isAdmin: true },
      });
      expect(mass.statusCode).toBe(400);
      expect(JSON.parse(mass.body).error).toBe('VALIDACAO');

      // Injeção SQL no PIN e caracteres de controle na matrícula
      const sqli = await app.inject({
        method: 'POST',
        url: endpoint,
        payload: { matricula: "admin'--\u0000", pin: "' OR 1=1--" },
      });
      expect(sqli.statusCode).toBe(400);
      expect(JSON.parse(sqli.body).error).toBe('VALIDACAO');
    }
    await app.close();
  });

  it('proteção de rotas (BAC): bloqueia acesso sem token, com JWT forjado (alg:none) ou sessão de totem sem X-Totem-Id', async () => {
    const app = buildApp();
    await app.ready();

    for (const rota of ['/ordens', '/usuarios', '/configuracoes', '/auditoria', '/setores']) {
      const semToken = await app.inject({ method: 'GET', url: rota });
      expect(semToken.statusCode).toBe(401);
    }

    // Token com alg:none forjado
    const algNone = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxIiwicGVyZmlsIjoiQURNSU4ifQ.';
    const forjado = await app.inject({
      method: 'GET',
      url: '/usuarios',
      headers: { authorization: `Bearer ${algNone}` },
    });
    expect(forjado.statusCode).toBe(401);

    // Sessão de totem exige X-Totem-Id idêntico ao claim tid
    const totemToken = app.jwt.sign({ sub: '1', perfil: 'OPERADOR', nome: 'Op', tid: 'TOTEM-01' }, { expiresIn: '60s' });
    const semHeaderTotem = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${totemToken}` },
    });
    expect(semHeaderTotem.statusCode).toBe(401);
    expect(JSON.parse(semHeaderTotem.body).error).toBe('SESSAO_TOTEM_INVALIDA');

    const deviceDiferente = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${totemToken}`, 'x-totem-id': 'TOTEM-HACKER' },
    });
    expect(deviceDiferente.statusCode).toBe(401);
    expect(JSON.parse(deviceDiferente.body).error).toBe('SESSAO_TOTEM_INVALIDA');

    // Elevação de privilégio horizontal/vertical: OPERADOR tentando acessar /configuracoes, /usuarios, /auditoria
    const opToken = app.jwt.sign({ sub: '1', perfil: 'OPERADOR', nome: 'Op' });
    for (const rotaAdmin of ['/configuracoes', '/usuarios', '/auditoria', '/setores']) {
      const negado = await app.inject({
        method: 'GET',
        url: rotaAdmin,
        headers: { authorization: `Bearer ${opToken}` },
      });
      expect(negado.statusCode).toBe(403);
      expect(JSON.parse(negado.body).error).toBe('ACESSO_NEGADO');
    }

    await app.close();
  });

  it('Fase 30 BAC: bloqueia acesso sem token ou perfil não-ADMIN em /grupos-ativos e rotas admin de equipamentos', async () => {
    const app = buildApp();
    await app.ready();

    const rotas = [
      { method: 'GET', url: '/grupos-ativos' },
      { method: 'PUT', url: '/grupos-ativos/1' },
      { method: 'GET', url: '/setores/1/equipamentos' },
      { method: 'POST', url: '/setores/1/equipamentos' },
      { method: 'PUT', url: '/equipamentos/1' },
      { method: 'DELETE', url: '/equipamentos/1' },
    ];
    for (const r of rotas) {
      const semToken = await app.inject({ method: r.method as any, url: r.url });
      expect(semToken.statusCode).toBe(401);
    }

    for (const perfil of ['OPERADOR', 'TECNICO']) {
      const token = app.jwt.sign({ sub: '1', perfil, nome: 'User' });
      for (const r of rotas) {
        const negado = await app.inject({
          method: r.method as any,
          url: r.url,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(negado.statusCode).toBe(403);
        expect(JSON.parse(negado.body).error).toBe('ACESSO_NEGADO');
      }
    }

    await app.close();
  });

  it('Fase 30 POST /ordens: validação estrita (.strict()) bloqueia Mass Assignment e injeção de campos', async () => {
    const app = buildApp();
    await app.ready();
    const token = app.jwt.sign({ sub: '1', perfil: 'OPERADOR', nome: 'Operador' });

    const mass = await app.inject({
      method: 'POST',
      url: '/ordens',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        equipamentoId: '1',
        maquinaParada: true,
        categoria: 'MECANICO',
        sintomas: ['Ruído Anormal'],
        status: 'CONCLUIDA',
        invasor: true,
      },
    });
    expect(mass.statusCode).toBe(400);
    expect(JSON.parse(mass.body).error).toBe('VALIDACAO');

    const massSinonimo = await app.inject({
      method: 'POST',
      url: '/ordens',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        equipamentoId: '1',
        maquinaParada: true,
        categoria: 'MECANICO',
        sintomas: ['Ruído Anormal'],
        tipoCusto: 'INTERNO',
        campoMalicioso: 'hacked',
      },
    });
    expect(massSinonimo.statusCode).toBe(400);
    expect(JSON.parse(massSinonimo.body).error).toBe('VALIDACAO');

    const sqliSintomas = await app.inject({
      method: 'POST',
      url: '/ordens',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        equipamentoId: '1',
        maquinaParada: true,
        categoria: 'MECANICO',
        sintomas: ['Ruído; DROP TABLE ordens_manutencao;--'],
      },
    });
    expect(sqliSintomas.statusCode).toBe(400);
    expect(JSON.parse(sqliSintomas.body).error).toBe('VALIDACAO');

    const controleTipo = await app.inject({
      method: 'POST',
      url: '/ordens',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        equipamentoId: '1',
        maquinaParada: true,
        categoria: 'OUTROS',
        sintomas: ['Falha geral'],
        tipoAtivo: 'OUTRO',
        tipoAtivoOutro: 'Outro\u0000Injetado',
      },
    });
    expect(controleTipo.statusCode).toBe(400);
    expect(JSON.parse(controleTipo.body).error).toBe('VALIDACAO');

    await app.close();
  });

  it('Fase 30 /grupos-ativos e /equipamentos: .strict() e validação de enum impedem Mass Assignment e injeção', async () => {
    const app = buildApp();
    await app.ready();
    const token = app.jwt.sign({ sub: '1', perfil: 'OPERADOR', nome: 'Operador' });

    const grupoInvalido = await app.inject({
      method: 'GET',
      url: '/equipamentos?grupo=GRUPO_INEXISTENTE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(grupoInvalido.statusCode).toBe(400);
    expect(JSON.parse(grupoInvalido.body).error).toBe('VALIDACAO');

    const queryInvalida = await app.inject({
      method: 'GET',
      url: '/equipamentos?hackerParam=1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(queryInvalida.statusCode).toBe(400);
    expect(JSON.parse(queryInvalida.body).error).toBe('VALIDACAO');

    vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({
      id: 1n,
      ativo: true,
      perfil: 'ADMIN',
    } as any);
    const adminToken = app.jwt.sign({ sub: '1', perfil: 'ADMIN', nome: 'Admin' });

    const grupoMass = await app.inject({
      method: 'PUT',
      url: '/grupos-ativos/1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        nome: 'Novo Nome',
        codigo: 'PRODUTIVOS_ALTERADO',
        invasor: true,
      },
    });
    expect(grupoMass.statusCode).toBe(400);
    expect(JSON.parse(grupoMass.body).error).toBe('VALIDACAO');

    vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({
      id: 1n,
      ativo: true,
      perfil: 'ADMIN',
    } as any);
    const grupoControle = await app.inject({
      method: 'PUT',
      url: '/grupos-ativos/1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        nome: 'Grupo\u0000Controle',
      },
    });
    expect(grupoControle.statusCode).toBe(400);
    expect(JSON.parse(grupoControle.body).error).toBe('VALIDACAO');

    await app.close();
  });


  it('Fase 31 BAC: exige soAdmin em /grupos-ativos/:id/equipamentos e perfilConcluidor em /ordens/:id/encerrar', async () => {
    const app = buildApp();
    await app.ready();

    const rotasGrupoEquip = [
      { method: 'GET', url: '/grupos-ativos/1/equipamentos' },
      { method: 'POST', url: '/grupos-ativos/1/equipamentos' },
    ];
    for (const r of rotasGrupoEquip) {
      const semToken = await app.inject({ method: r.method as any, url: r.url });
      expect(semToken.statusCode).toBe(401);
    }

    for (const perfil of ['OPERADOR', 'LIDER_PRODUCAO', 'TECNICO', 'GERENTE']) {
      const token = app.jwt.sign({ sub: '1', perfil, nome: 'User' });
      for (const r of rotasGrupoEquip) {
        const negado = await app.inject({
          method: r.method as any,
          url: r.url,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(negado.statusCode).toBe(403);
        expect(JSON.parse(negado.body).error).toBe('ACESSO_NEGADO');
      }
    }

    // /ordens/:id/encerrar bloqueia sem token (401) e perfis não-concluidores (OPERADOR, LIDER_PRODUCAO, TECNICO -> 403)
    const encerrarSemToken = await app.inject({ method: 'POST', url: '/ordens/1/encerrar' });
    expect(encerrarSemToken.statusCode).toBe(401);

    for (const perfil of ['OPERADOR', 'LIDER_PRODUCAO', 'TECNICO']) {
      const token = app.jwt.sign({ sub: '1', perfil, nome: 'User' });
      const negado = await app.inject({
        method: 'POST',
        url: '/ordens/1/encerrar',
        headers: { authorization: `Bearer ${token}` },
        payload: { pin: '1234', custoTipo: 'INTERNO' },
      });
      expect(negado.statusCode).toBe(403);
      expect(JSON.parse(negado.body).error).toBe('ACESSO_NEGADO');
    }

    await app.close();
  });

  it('Fase 31 itemDescricao (pseudo-ativo OUTROS): valida sanitização, controle ASCII e limites de 3 a 100 caracteres', async () => {
    const app = buildApp();
    await app.ready();
    const token = app.jwt.sign({ sub: '1', perfil: 'OPERADOR', nome: 'Operador' });

    // Rejeita caracteres de controle ASCII no schema Zod de itemDescricao
    const comControle = await app.inject({
      method: 'POST',
      url: '/ordens',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        equipamentoId: '99',
        itemDescricao: 'Bancada\u0000Maliciosa',
        maquinaParada: false,
        categoria: 'MECANICO',
        sintomas: ['Quebra'],
      },
    });
    expect(comControle.statusCode).toBe(400);
    expect(JSON.parse(comControle.body).error).toBe('VALIDACAO');

    // Para o pseudo-ativo OUTROS (itemLivre: true), exige entre 3 e 100 caracteres após trim/colapso de espaços
    for (const invalido of [undefined, 'ab', '   a   ', 'x'.repeat(101)]) {
      vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({ id: 1n, ativo: true, perfil: 'OPERADOR' } as any);
      vi.spyOn(prisma.equipamento, 'findUnique').mockResolvedValueOnce({
        id: 99n,
        status: 'ATIVO',
        predial: false,
        itemLivre: true,
        grupo: { codigo: 'OUTROS' },
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/ordens',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          equipamentoId: '99',
          ...(invalido !== undefined && { itemDescricao: invalido }),
          maquinaParada: false,
          categoria: 'MECANICO',
          sintomas: ['Quebra'],
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('VALIDACAO');
      expect(body.detalhes?.[0]?.campo).toBe('itemDescricao');
    }

    await app.close();
  });

  it('Fase 31 POST /ordens/:id/encerrar e /grupos-ativos/:id/equipamentos: .strict(), custoTipo obrigatório e limites de centroCusto', async () => {
    const app = buildApp();
    await app.ready();
    const adminToken = app.jwt.sign({ sub: '1', perfil: 'ADMIN', nome: 'Admin' });

    const mockAdmin = () =>
      vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({ id: 1n, ativo: true, perfil: 'ADMIN' } as any);

    // 1. Omitir custoTipo em /encerrar -> 400 VALIDACAO (antes de tocar no PIN)
    mockAdmin();
    const semCusto = await app.inject({
      method: 'POST',
      url: '/ordens/1/encerrar',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { pin: '1234' },
    });
    expect(semCusto.statusCode).toBe(400);
    expect(JSON.parse(semCusto.body).error).toBe('VALIDACAO');

    // 2. custoTipo inválido -> 400 VALIDACAO
    mockAdmin();
    const custoInvalido = await app.inject({
      method: 'POST',
      url: '/ordens/1/encerrar',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { pin: '1234', custoTipo: 'TERCEIRO' },
    });
    expect(custoInvalido.statusCode).toBe(400);
    expect(JSON.parse(custoInvalido.body).error).toBe('VALIDACAO');

    // 3. centroCusto > 50 caracteres ou com controle ASCII -> 400 VALIDACAO
    mockAdmin();
    const ccLongo = await app.inject({
      method: 'POST',
      url: '/ordens/1/encerrar',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { pin: '1234', custoTipo: 'INTERNO', centroCusto: 'C'.repeat(51) },
    });
    expect(ccLongo.statusCode).toBe(400);
    expect(JSON.parse(ccLongo.body).error).toBe('VALIDACAO');

    mockAdmin();
    const ccControle = await app.inject({
      method: 'POST',
      url: '/ordens/1/encerrar',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { pin: '1234', custoTipo: 'CLIENTE', centroCusto: 'CC\u0000123' },
    });
    expect(ccControle.statusCode).toBe(400);
    expect(JSON.parse(ccControle.body).error).toBe('VALIDACAO');

    // 4. Mass Assignment em /encerrar -> 400 VALIDACAO
    mockAdmin();
    const encerrarMass = await app.inject({
      method: 'POST',
      url: '/ordens/1/encerrar',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { pin: '1234', custoTipo: 'INTERNO', concluidoPor: '999', invasor: true },
    });
    expect(encerrarMass.statusCode).toBe(400);
    expect(JSON.parse(encerrarMass.body).error).toBe('VALIDACAO');

    // 5. Mass Assignment em POST /grupos-ativos/:id/equipamentos e GET query param extra -> 400 VALIDACAO
    mockAdmin();
    const criarEqMass = await app.inject({
      method: 'POST',
      url: '/grupos-ativos/1/equipamentos',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { tag: 'INJ-99', nome: 'Injetora', itemLivre: true, predial: true },
    });
    expect(criarEqMass.statusCode).toBe(400);
    expect(JSON.parse(criarEqMass.body).error).toBe('VALIDACAO');

    mockAdmin();
    const listEqQueryExtra = await app.inject({
      method: 'GET',
      url: '/grupos-ativos/1/equipamentos?hacker=1',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listEqQueryExtra.statusCode).toBe(400);
    expect(JSON.parse(listEqQueryExtra.body).error).toBe('VALIDACAO');

    await app.close();
  });


  it('Fase 32 US-17 POST /auth/pin: anti-enumeração, exclusão mútua portal/totemId, não-consumo de lockout e sanitização de LOGIN_PERFIL_BLOQUEADO', async () => {
    const app = buildApp();
    await app.ready();

    // 1. Exclusão mútua portal + totemId (body ou header X-Totem-Id) e validação estrita de portal
    const conflitoBody = await app.inject({
      method: 'POST',
      url: '/auth/pin',
      payload: { matricula: 'u32_sec', pin: '1234', portal: 'TECNICO', totemId: 'TOTEM-01' },
      remoteAddress: '10.99.0.1',
    });
    expect(conflitoBody.statusCode).toBe(400);
    expect(JSON.parse(conflitoBody.body).error).toBe('VALIDACAO');
    expect(JSON.parse(conflitoBody.body).message).toBe('Portal e totemId são mutuamente exclusivos.');

    const conflitoHeader = await app.inject({
      method: 'POST',
      url: '/auth/pin',
      headers: { 'x-totem-id': 'TOTEM-01' },
      payload: { matricula: 'u32_sec', pin: '1234', portal: 'TECNICO' },
      remoteAddress: '10.99.0.2',
    });
    expect(conflitoHeader.statusCode).toBe(400);
    expect(JSON.parse(conflitoHeader.body).error).toBe('VALIDACAO');

    const portalInvalido = await app.inject({
      method: 'POST',
      url: '/auth/pin',
      payload: { matricula: 'u32_sec', pin: '1234', portal: 'ADMIN' },
      remoteAddress: '10.99.0.3',
    });
    expect(portalInvalido.statusCode).toBe(400);
    expect(JSON.parse(portalInvalido.body).error).toBe('VALIDACAO');

    // 2. Anti-enumeração: TECNICO com PIN incorreto no Totem deve retornar 401 genérico (nunca 403 PERFIL_NAO_PERMITIDO_NO_TOTEM)
    const pinCertoHash = await hashPin('1234');
    limparFalhas('u32_tec_sec');
    vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({
      id: 42n,
      nome: 'Tec Sec',
      matricula: 'u32_tec_sec',
      perfil: 'TECNICO',
      ativo: true,
      pinHash: pinCertoHash,
    } as any);

    const pinErradoTotem = await app.inject({
      method: 'POST',
      url: '/auth/pin',
      payload: { matricula: 'u32_tec_sec', pin: '9999', totemId: 'TOTEM-01' },
      remoteAddress: '10.99.0.4',
    });
    expect(pinErradoTotem.statusCode).toBe(401);
    expect(JSON.parse(pinErradoTotem.body).error).toBe('CREDENCIAIS_INVALIDAS');
    limparFalhas('u32_tec_sec');

    // 3. Bloqueio de política com PIN correto NÃO consome tentativas de lockout (mesmo após 6 bloqueios seguidos) e não emite token
    const auditSpy = vi.spyOn(prisma.auditoria, 'create').mockResolvedValue({ id: 1n } as any);
    for (let i = 0; i < 6; i++) {
      vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({
        id: 42n,
        nome: 'Tec Sec',
        matricula: 'u32_tec_sec',
        perfil: 'TECNICO',
        ativo: true,
        pinHash: pinCertoHash,
      } as any);
      const bloq = await app.inject({
        method: 'POST',
        url: '/auth/pin',
        payload: { matricula: 'u32_tec_sec', pin: '1234', totemId: 'TOTEM-01' },
        remoteAddress: `10.99.1.${i + 1}`,
      });
      expect(bloq.statusCode).toBe(403);
      const body = JSON.parse(bloq.body);
      expect(body.error).toBe('PERFIL_NAO_PERMITIDO_NO_TOTEM');
      expect(body.token).toBeUndefined();
      expect(bloq.headers['set-cookie']).toBeUndefined();
    }
    expect(segundosBloqueado('u32_tec_sec')).toBe(0);

    // 4. Higienização da auditoria LOGIN_PERFIL_BLOQUEADO: preserva portal/perfil/totemId e descarta qualquer PIN/token
    const detalheLimpo = limpar({
      portal: 'TOTEM',
      perfil: 'TECNICO',
      totemId: 'TOTEM-01\u0000\u001b[31m',
      pin: '1234',
      token: 'jwt-secreto',
    });
    expect(detalheLimpo).toEqual({
      portal: 'TOTEM',
      perfil: 'TECNICO',
      totemId: 'TOTEM-01[31m',
    });
    expect(detalheLimpo).not.toHaveProperty('pin');
    expect(detalheLimpo).not.toHaveProperty('token');

    auditSpy.mockRestore();
    await app.close();
  });

  it('Fase 34 DevSecOps: mitigação de Log Injection em X-Request-Id, validação e anti-tampering de cursor, anti-CRLF injection no outbox de e-mail e exclusão mútua cursor/offset', async () => {
    const app = buildApp();
    await app.ready();

    // 1. Prevenção de Log Injection / ANSI Escape em reqId / X-Request-Id:
    // Headers maliciosos com quebras de linha ou caracteres de controle devem ser sanitizados/substituídos por UUID
    const injecoesReqId = [
      'req-malicioso\r\nInjected-Header: evil',
      'req\u001b[31mANSI',
      'curto', // < 8 caracteres
      'a'.repeat(65), // > 64 caracteres
      'req com espaco',
    ];
    for (const badReqId of injecoesReqId) {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': badReqId },
      });
      const returnedId = res.headers['x-request-id'];
      expect(typeof returnedId).toBe('string');
      expect(returnedId).not.toBe(badReqId);
      // Deve ter gerado um UUID v4 seguro
      expect(returnedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }

    // reqId legítimo é preservado
    const bomReqId = 'req-trace-valido-12345';
    const resBom = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': bomReqId },
    });
    expect(resBom.headers['x-request-id']).toBe(bomReqId);

    // 2. Validação e anti-tampering do cursor (keyset pagination):
    // Cursors adulterados, vetores de injeção ou tipos inesperados são rejeitados com 400
    const { cursorSchema, codificarCursor } = await import('../../src/cursor.js');
    const cursoresMaliciosos = [
      Buffer.from('{"i":"1; DROP TABLE ordens;--"}').toString('base64url'),
      Buffer.from('{"__proto__":{"admin":true}}').toString('base64url'),
      Buffer.from('{"i":"-5"}').toString('base64url'),
      Buffer.from('{"i":123}').toString('base64url'),
      'not-base64!',
      '',
    ];
    for (const badCursor of cursoresMaliciosos) {
      expect(cursorSchema.safeParse(badCursor).success).toBe(false);
    }
    // Cursor legítimo é decodificado com segurança para bigint
    const cursorValido = codificarCursor(987654321n);
    expect(cursorSchema.parse(cursorValido)).toBe(987654321n);

    // 3. Prevenção de SMTP Header Injection no Outbox:
    const { destinatarioValido } = await import('../../src/mail/outbox.js');
    const { limpaAssunto } = await import('../../src/mail/mailer.js');
    // Destinatário com CRLF, tab ou espaço é rejeitado
    expect(destinatarioValido('admin@empresa.com\r\nBcc: hacker@evil.com')).toBe(false);
    expect(destinatarioValido('admin@empresa.com\u0000')).toBe(false);
    expect(destinatarioValido('admin @empresa.com')).toBe(false);
    expect(destinatarioValido('operador@fabrica.local')).toBe(true);
    // Assunto limpo de CRLF
    expect(limpaAssunto('Alerta\r\nBcc: spy@evil.com')).toBe('Alerta Bcc: spy@evil.com');

    // 4. Exclusão mútua cursor/offset na rota de auditoria (impede confusão de paginação):
    const adminToken = app.jwt.sign({ sub: '1', perfil: 'ADMIN', nome: 'Admin' });
    vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({
      id: 1n,
      ativo: true,
      perfil: 'ADMIN',
    } as any);

    const conflitoPaginacao = await app.inject({
      method: 'GET',
      url: '/auditoria?offset=10&cursor=' + cursorValido,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(conflitoPaginacao.statusCode).toBe(400);
    expect(JSON.parse(conflitoPaginacao.body).error).toBe('VALIDACAO');

    await app.close();
  });

  it('Fase 35 DevSecOps: proteção contra injeção de fórmulas CSV, sanitização de e-mails/XSS/headers, ausência de segredos no snapshot da ficha, catálogo vital e RBAC em /ordens/:id/ficha.pdf', async () => {
    const app = buildApp();
    await app.ready();

    // 1. Proteção contra Injeção de Fórmulas no CSV (CWE-1236 / OWASP A03):
    // Prefixo /^[=+\-@\t\r]/ deve receber apóstrofo (') na frente, neutralizando execução em planilhas
    const { gerarCsv } = await import('../../../web/src/lib/csv.ts');
    const vetoresFormula = [
      '=cmd|\' /C calc\'!A0',
      '+cmd|\' /C calc\'!A0',
      '-2+3+cmd|\' /C calc\'!A0',
      '@SUM(1,2)',
      '\tmalicious_tab',
      '\rmalicious_cr',
      'Texto "com" aspas',
      'Texto normal sem perigo',
      123.45,
      true,
      null,
    ];

    const csvGerado = gerarCsv([vetoresFormula]);

    // O arquivo deve iniciar com BOM UTF-8 (\uFEFF)
    expect(csvGerado.startsWith('\uFEFF')).toBe(true);

    // Caracteres perigosos devem estar neutralizados com apóstrofo e entre aspas duplas
    expect(csvGerado).toContain(`"'=cmd|' /C calc'!A0"`);
    expect(csvGerado).toContain(`"'+cmd|' /C calc'!A0"`);
    expect(csvGerado).toContain(`"'-2+3+cmd|' /C calc'!A0"`);
    expect(csvGerado).toContain(`"'@SUM(1,2)"`);
    expect(csvGerado).toContain(`"'\tmalicious_tab"`);
    expect(csvGerado).toContain(`"'\rmalicious_cr"`);

    // Aspas internas devem ser duplicadas e texto normal preservado sem apóstrofo
    expect(csvGerado).toContain(`"Texto ""com"" aspas"`);
    expect(csvGerado).toContain(`"Texto normal sem perigo"`);

    // Números com vírgula decimal sem aspas, booleano Sim, vazio para null, terminador CRLF
    expect(csvGerado).toContain(';123,45;');
    expect(csvGerado).toContain(';"Sim";');
    expect(csvGerado.endsWith('\r\n')).toBe(true);

    // 2. Sanitização de E-mails contra Header Injection e XSS (OWASP A03):
    const { destinatarioValido } = await import('../../src/mail/outbox.js');
    const { limpaAssunto } = await import('../../src/mail/mailer.js');

    // Validação estrita de destinatário contra injeção de quebra de linha ou bytes nulos
    expect(destinatarioValido('tecnico@empresa.com\r\nBcc: hacker@evil.com')).toBe(false);
    expect(destinatarioValido('tecnico@empresa.com\0')).toBe(false);
    expect(destinatarioValido('tecnico@empresa.com\n')).toBe(false);
    expect(destinatarioValido('tecnico@empresa.com\r')).toBe(false);
    expect(destinatarioValido('tecnico @empresa.com')).toBe(false);
    expect(destinatarioValido('tecnico\tempresa.com')).toBe(false);
    expect(destinatarioValido('')).toBe(false);
    expect(destinatarioValido('tecnico@apexindustrial.com')).toBe(true);

    // Sanitização de assunto contra SMTP Header Injection
    expect(limpaAssunto('Nova OM\r\nSubject: Injetado')).toBe('Nova OM Subject: Injetado');
    expect(limpaAssunto('Alerta\nCC: spy@evil.com')).toBe('Alerta CC: spy@evil.com');

    // 3. Ausência Total de Segredos no Snapshot JSONB da Ficha (OWASP A01 / A02):
    const { fichaSnapshotV1, TAMANHO_MAX_SNAPSHOT } = await import('../../src/ficha/schema.js');

    const snapshotValido = {
      versao: 1,
      tipoDocumento: 'FICHA_INICIAL',
      geradoEm: new Date().toISOString(),
      om: {
        numeroFormatado: 'OM-2026-000999',
        titulo: 'Reparo hidráulico',
        descricao: 'Vazamento no pistão',
        sintomas: ['Vazamento'],
        prioridade: 'ALTA',
        categoria: 'MECANICO',
        dataAbertura: new Date().toISOString(),
        localDescricao: null,
        itemDescricao: null,
        tipoAtivo: 'MAQUINA',
        tipoAtivoRotulo: 'Máquina',
      },
      equipamento: {
        codigo: 'INJ-01',
        nome: 'Injetora 01',
        setorExibicao: 'Injeção',
      },
      solicitante: { nome: 'Operador Fabril' },
      responsavel: null,
      aprovadoPor: null,
      concluidoPor: null,
      custoTipo: null,
      centroCusto: null,
      apontamentos: [],
      materiais: [],
    };
    expect(fichaSnapshotV1.safeParse(snapshotValido).success).toBe(true);

    // Campos proibidos devem causar falha imediata de validação Zod (.strict())
    const chavesProibidas = [
      { pin: '1234' },
      { pinHash: 'scrypt$32768$8$1$fake' },
      { senha: 'senha-secreta' },
      { senhaHash: '$2a$12$fake' },
      { token: 'jwt.token.aqui' },
      { matricula: '998877' },
      { authorization: 'Bearer secret' },
      { jwt: 'ey...' },
      { chave_privada: '-----BEGIN RSA PRIVATE KEY-----' },
    ];
    for (const proibido of chavesProibidas) {
      expect(fichaSnapshotV1.safeParse({ ...snapshotValido, ...proibido }).success).toBe(false);
      expect(fichaSnapshotV1.safeParse({
        ...snapshotValido,
        solicitante: { nome: 'Operador', ...proibido },
      }).success).toBe(false);
    }

    // Teto de tamanho do snapshot (64 KB)
    expect(TAMANHO_MAX_SNAPSHOT).toBe(65536);

    // 4. Catálogo Vital e Regra Estrita de Anexos:
    const { EMAIL_TIPOS_VITAIS, ANEXO_POR_TIPO, ehTipoVital } = await import('../../src/mail/catalogo.js');
    expect([...EMAIL_TIPOS_VITAIS].sort()).toEqual([
      'OM_ABERTURA',
      'OM_APROVADA_SOLICITANTE',
      'OM_CONCLUIDA_GESTOR',
      'OM_FINALIZADA_TECNICO',
    ].sort());
    // PDF obrigatório APENAS na abertura e na conclusão
    expect(ANEXO_POR_TIPO.OM_ABERTURA).toBe('FICHA_INICIAL');
    expect(ANEXO_POR_TIPO.OM_CONCLUIDA_GESTOR).toBe('FICHA_FINAL');
    expect(ANEXO_POR_TIPO.OM_FINALIZADA_TECNICO).toBeNull();
    expect(ANEXO_POR_TIPO.OM_APROVADA_SOLICITANTE).toBeNull();
    // Tipos não vitais não podem ser enfileirados
    expect(ehTipoVital('OM_ATRIBUIDA')).toBe(false);
    expect(ehTipoVital('OM_RESERVADA')).toBe(false);
    expect(ehTipoVital('OM_RECUSADA')).toBe(false);

    // 5. Permissões RBAC e Hardening em GET /ordens/:id/ficha.pdf:
    // 5.1 Não autenticado -> 401
    const resSemAuth = await app.inject({
      method: 'GET',
      url: '/ordens/1/ficha.pdf',
    });
    expect(resSemAuth.statusCode).toBe(401);

    // 5.2 Perfil não autorizado (OPERADOR / LIDER_PRODUCAO) -> 403 ACESSO_NEGADO
    const operadorToken = app.jwt.sign({ sub: '10', perfil: 'OPERADOR', nome: 'Operador' });
    const resOperador = await app.inject({
      method: 'GET',
      url: '/ordens/1/ficha.pdf',
      headers: { authorization: `Bearer ${operadorToken}` },
    });
    expect(resOperador.statusCode).toBe(403);
    expect(JSON.parse(resOperador.body).error).toBe('ACESSO_NEGADO');

    // 5.3 Usuário inativo no banco -> 403 ACESSO_NEGADO
    const tecnicoToken = app.jwt.sign({ sub: '20', perfil: 'TECNICO', nome: 'Técnico' });
    vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({
      id: 20n,
      ativo: false,
      perfil: 'TECNICO',
    } as any);
    const resInativo = await app.inject({
      method: 'GET',
      url: '/ordens/1/ficha.pdf',
      headers: { authorization: `Bearer ${tecnicoToken}` },
    });
    expect(resInativo.statusCode).toBe(403);
    expect(JSON.parse(resInativo.body).error).toBe('ACESSO_NEGADO');

    // 5.4 Usuário autorizado ativo (TECNICO / ADMIN):
    // Ordem não encontrada -> 404
    vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({
      id: 20n,
      ativo: true,
      perfil: 'TECNICO',
    } as any);
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (cb: any) => {
      return cb({
        ordem: { findUnique: vi.fn().mockResolvedValue(null) },
      });
    });
    const res404 = await app.inject({
      method: 'GET',
      url: '/ordens/999/ficha.pdf',
      headers: { authorization: `Bearer ${tecnicoToken}` },
    });
    expect(res404.statusCode).toBe(404);
    expect(JSON.parse(res404.body).error).toBe('OM_NAO_ENCONTRADA');

    // 5.5 Renderização do PDF com sucesso: confere cabeçalhos de segurança e sanitização do Content-Disposition
    vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({
      id: 20n,
      ativo: true,
      perfil: 'TECNICO',
    } as any);
    vi.spyOn(prisma, '$transaction').mockResolvedValueOnce(snapshotValido as any);

    const resSucesso = await app.inject({
      method: 'GET',
      url: '/ordens/1/ficha.pdf',
      headers: { authorization: `Bearer ${tecnicoToken}` },
    });
    expect(resSucesso.statusCode).toBe(200);
    expect(resSucesso.headers['content-type']).toBe('application/pdf');
    expect(resSucesso.headers['cache-control']).toBe('no-store');
    expect(resSucesso.headers['content-disposition']).toBe('inline; filename="ficha_OM-2026-000999.pdf"');
    expect(resSucesso.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    await app.close();
  });

  it('Fase 36 DevSecOps: validação de inputs e RBAC em equipamentos com setorId, DevIndicator inacessível, hardening MIME/RFC 5322 e conformidade CSV sep=;', async () => {
    const app = buildApp();
    await app.ready();

    // 1. RBAC e Validação de Entrada no Cadastro/Edição de Equipamentos com setorId:
    // 1.1 RBAC: Sem token -> 401; Perfil não-ADMIN (ex: TECNICO) -> 403
    const resSemAuth = await app.inject({
      method: 'POST',
      url: '/grupos-ativos/1/equipamentos',
      payload: { tag: 'EQ-01', nome: 'Equipamento', setorId: '10' },
    });
    expect(resSemAuth.statusCode).toBe(401);

    const tecnicoToken = app.jwt.sign({ sub: '20', perfil: 'TECNICO', nome: 'Técnico' });
    const resTecnico = await app.inject({
      method: 'POST',
      url: '/grupos-ativos/1/equipamentos',
      headers: { authorization: `Bearer ${tecnicoToken}` },
      payload: { tag: 'EQ-01', nome: 'Equipamento', setorId: '10' },
    });
    expect(resTecnico.statusCode).toBe(403);
    expect(JSON.parse(resTecnico.body).error).toBe('ACESSO_NEGADO');

    // 1.2 Admin ativo para testes subsequentes
    const adminToken = app.jwt.sign({ sub: '1', perfil: 'ADMIN', nome: 'Admin' });

    // 1.3 .strict() impede Mass Assignment no POST /grupos-ativos/:id/equipamentos
    vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({ id: 1n, ativo: true, perfil: 'ADMIN' } as any);
    const resMassAssignment = await app.inject({
      method: 'POST',
      url: '/grupos-ativos/1/equipamentos',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        tag: 'EQ-MASS',
        nome: 'Equipamento Mass',
        setorId: '10',
        invasor: true,
        status: 'ATIVO',
        predial: true,
        itemLivre: true,
      },
    });
    expect(resMassAssignment.statusCode).toBe(400);
    expect(JSON.parse(resMassAssignment.body).error).toBe('VALIDACAO');

    // 1.4 setorId é OBRIGATÓRIO (RN-72 / Fase 35/36): criação sem setorId é rejeitada
    vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({ id: 1n, ativo: true, perfil: 'ADMIN' } as any);
    const resSemSetorId = await app.inject({
      method: 'POST',
      url: '/grupos-ativos/1/equipamentos',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { tag: 'EQ-SEM-SETOR', nome: 'Equipamento Sem Setor' },
    });
    expect(resSemSetorId.statusCode).toBe(400);
    expect(JSON.parse(resSemSetorId.body).error).toBe('VALIDACAO');

    // 1.5 Caracteres de controle ASCII e validação de tag
    vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({ id: 1n, ativo: true, perfil: 'ADMIN' } as any);
    const resControle = await app.inject({
      method: 'POST',
      url: '/grupos-ativos/1/equipamentos',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { tag: 'EQ-01\u0000', nome: 'Equipamento\u001b[31m', setorId: '10' },
    });
    expect(resControle.statusCode).toBe(400);
    expect(JSON.parse(resControle.body).error).toBe('VALIDACAO');

    // 1.6 Proteção de integridade: setor predial sem equipamentos (422) e setor inativo (422)
    vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({ id: 1n, ativo: true, perfil: 'ADMIN' } as any);
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (cb: any) => {
      return cb({
        grupoAtivo: { findUnique: vi.fn().mockResolvedValue({ id: 1n, codigo: 'PRODUTIVOS' }) },
        setor: { findUnique: vi.fn().mockResolvedValue({ id: 10n, nome: 'Predial', ativo: true, predial: true }) },
      });
    });
    const resSetorPredial = await app.inject({
      method: 'POST',
      url: '/grupos-ativos/1/equipamentos',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { tag: 'EQ-01', nome: 'Equipamento', setorId: '10' },
    });
    expect(resSetorPredial.statusCode).toBe(422);
    expect(JSON.parse(resSetorPredial.body).error).toBe('SETOR_PREDIAL_SEM_EQUIPAMENTOS');

    // 1.7 Proteção na edição PUT /equipamentos/:id: .strict() e proteção de pseudo-ativos
    vi.spyOn(prisma.usuario, 'findUnique').mockResolvedValueOnce({ id: 1n, ativo: true, perfil: 'ADMIN' } as any);
    const resPutInvasor = await app.inject({
      method: 'PUT',
      url: '/equipamentos/1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { nome: 'Novo Nome', campoInjetado: 'hacker' },
    });
    expect(resPutInvasor.statusCode).toBe(400);
    expect(JSON.parse(resPutInvasor.body).error).toBe('VALIDACAO');

    // 2. Inacessibilidade do DevIndicator do Next.js (L1 + L2):
    // 2.1 Leitura estática de apps/web/next.config.ts confirmando devIndicators: false
    const nextConfigContent = await (await import('node:fs/promises')).readFile(
      new URL('../../../web/next.config.ts', import.meta.url),
      'utf8'
    );
    expect(nextConfigContent).toMatch(/devIndicators:\s*false/);

    // 2.2 Leitura estática de globals.css confirmando regra global no host contra <nextjs-portal> e overlays
    const globalsCssContent = await (await import('node:fs/promises')).readFile(
      new URL('../../../web/src/app/globals.css', import.meta.url),
      'utf8'
    );
    expect(globalsCssContent).toContain('nextjs-portal');
    expect(globalsCssContent).toContain('#nextjs-dev-overlay');
    expect(globalsCssContent).toContain('[data-nextjs-dev-tools-button]');
    expect(globalsCssContent).toContain('display: none !important');
    expect(globalsCssContent).toContain('pointer-events: none !important');
    expect(globalsCssContent).toContain('visibility: hidden !important');

    // 3. Hardening MIME, RFC 5322 e Anti-Header Injection nos E-mails com Anexo PDF:
    const { enviarAgora } = await import('../../src/mail/mailer.js');
    const { extrairEndereco } = await import('../../src/mail/smtp.js');

    // 3.1 Anti-Header Injection no nome de arquivo de anexos MIME:
    // Nomes com quebra de linha, path traversal, ou caracteres fora de [A-Za-z0-9._-] são barrados com EANEXO_NOME_INVALIDO
    const nomesMaliciosos = [
      'ficha\r\nInjected-Header: bad.pdf',
      'ficha\nBcc: evil@attacker.com.pdf',
      '../../../etc/passwd',
      'ficha; filename="exploit.exe"',
      'ficha com espacos.pdf',
      'a'.repeat(81) + '.pdf', // > 80 caracteres
      '',
    ];
    for (const nomeInvalido of nomesMaliciosos) {
      await expect(
        enviarAgora({
          para: 'dest@empresa.com',
          assunto: 'Teste',
          texto: 'Texto',
          html: '<p>HTML</p>',
          anexos: [{ nome: nomeInvalido, conteudo: Buffer.from('%PDF-1.3 fake'), tipo: 'application/pdf' }],
        })
      ).rejects.toMatchObject({ code: 'EANEXO_NOME_INVALIDO' });
    }

    // 3.2 Higienização de endereços de e-mail (extrairEndereco):
    expect(extrairEndereco('admin@apexindustrial.com')).toBe('admin@apexindustrial.com');
    expect(extrairEndereco('Apex Industrial <sistema@apexindustrial.com>')).toBe('sistema@apexindustrial.com');
    expect(extrairEndereco('Apex Industrial <sistema@apexindustrial.com>\r\n')).toBe('sistema@apexindustrial.com');
    expect(extrairEndereco('malicioso@empresa.com\r\nBcc: spy@evil.com')).toBeNull();
    expect(extrairEndereco('malicioso\u0000@empresa.com')).toBeNull();
    expect(extrairEndereco('malicioso <bad\r\n@evil.com>')).toBeNull();
    expect(extrairEndereco('malicioso <bad@evil.com\r\nBcc: spy@evil.com>')).toBeNull();
    expect(extrairEndereco('malicioso <bad\u0000@evil.com>')).toBeNull();
    expect(extrairEndereco('invalido-sem-arroba')).toBeNull();

    // 4. Conformidade de Segurança da Diretiva sep=; contra CSV Formula Injection:
    const { gerarCsv } = await import('../../../web/src/lib/csv.ts');

    // 4.1 Com padrão (diretivaSep omitida ou true): inicia com BOM + sep=;\r\n
    const linhasPerigosas = [
      ['=cmd|\' /C calc\'!A0', '+cmd', '-calc', '@SUM(A1:A10)', '\tmalicious', '\rmalicious', 'Texto normal'],
    ];
    const csvPadrao = gerarCsv(linhasPerigosas);
    expect(csvPadrao.startsWith('\uFEFFsep=;\r\n')).toBe(true);

    // Linha 2 de dados mantém neutralização estrita de fórmulas (apóstrofo na frente do caractere de fórmula)
    expect(csvPadrao).toContain(`"'=cmd|' /C calc'!A0"`);
    expect(csvPadrao).toContain(`"'+cmd"`);
    expect(csvPadrao).toContain(`"'-calc"`);
    expect(csvPadrao).toContain(`"'@SUM(A1:A10)"`);
    expect(csvPadrao).toContain(`"'\tmalicious"`);
    expect(csvPadrao).toContain(`"'\rmalicious"`);
    expect(csvPadrao).toContain(`"Texto normal"`);

    // 4.2 Quando diretivaSep = false: suprime sep=;\r\n mas preserva BOM e neutralização de fórmula
    const csvSemSep = gerarCsv(linhasPerigosas, { diretivaSep: false });
    expect(csvSemSep.startsWith('\uFEFF')).toBe(true);
    expect(csvSemSep.startsWith('\uFEFFsep=;\r\n')).toBe(false);
    expect(csvSemSep).not.toContain('sep=;');
    expect(csvSemSep).toContain(`"'=cmd|' /C calc'!A0"`);

    await app.close();
  });
});
