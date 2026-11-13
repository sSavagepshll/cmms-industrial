import { describe, it } from 'vitest';
import { criarOk, URL_TESTE } from '../helpers/soft.js';

describe('Fase 19 — B-19-01 (exclusão de usuários), B-19-04 (CORS Totem) e B-19-05 (tipo de ativo OUTRO)', () => {
  it('validação completa dos critérios de aceite da Fase 19', async () => {
    process.env.DATABASE_URL = URL_TESTE;
    process.env.JWT_SECRET ??= 'integration-test-secret-integration-test-secret-0123456789';

    const ok = criarOk();
    try {
      const { buildApp } = await import('../../src/app.js');
      const { prisma } = await import('../../src/db.js');
      const { hashPin } = await import('../../src/auth/password.js');
      const { config } = await import('../../src/config.js');
      const app = buildApp();
      await app.ready();

      // Limpeza de tabelas para o teste
      await prisma.$executeRaw`TRUNCATE ordens_manutencao, equipamentos, auditoria RESTART IDENTITY CASCADE`;
      await prisma.usuario.deleteMany({ where: { matricula: { startsWith: 'f19_' } } });

      const pin = await hashPin('1234');
      const mkUser = (nome: string, perfil: any, matricula: string, email?: string) =>
        prisma.usuario.create({
          data: { nome, perfil, matricula, pinHash: pin, email: email ?? null, ativo: true },
        });

      // Usuários base
      const admin = await prisma.usuario.findFirstOrThrow({ where: { email: 'admin@om.com.br' } });
      const tec = await mkUser('Tecnico F19', 'TECNICO', 'f19_tec');
      const oper = await mkUser('Operador F19', 'OPERADOR', 'f19_oper');
      const lider = await mkUser('Lider F19', 'LIDER_PRODUCAO', 'f19_lider');
      const eq = await prisma.equipamento.create({ data: { codigo: 'EQ-F19-01', nome: 'Prensa 100T', setor: 'Injecao' } });

      const tok = (u: any, tid?: string) => {
        const payload: any = { sub: String(u.id), perfil: u.perfil, nome: u.nome };
        if (tid) payload.tid = tid;
        return { authorization: 'Bearer ' + app.jwt.sign(payload) };
      };

      const call = async (m: any, url: string, u: any | null, payload?: any, headers: Record<string, string> = {}) => {
        const h = { ...(u ? tok(u) : {}), ...headers };
        const r = await app.inject({ method: m, url, headers: h, payload });
        let b: any = null;
        try { b = r.body ? JSON.parse(r.body) : null; } catch { b = r.body; }
        return { s: r.statusCode, b, h: r.headers };
      };

      // =====================================================================
      // 1. B-19-01: Exclusão de usuários (DELETE /usuarios/:id)
      // =====================================================================
      console.log('--- 1. B-19-01: Exclusão de usuários ---');

      // 1.1 Permissões
      let res = await call('DELETE', `/usuarios/${tec.id}`, null);
      ok('DELETE sem autenticação -> 401', res.s === 401);

      res = await call('DELETE', `/usuarios/${tec.id}`, tec);
      ok('DELETE por não-ADMIN (TECNICO) -> 403 ACESSO_NEGADO', res.s === 403 && res.b.error === 'ACESSO_NEGADO');

      res = await call('DELETE', `/usuarios/${tec.id}`, oper);
      ok('DELETE por não-ADMIN (OPERADOR) -> 403 ACESSO_NEGADO', res.s === 403);

      // 1.2 Auto-exclusão
      res = await call('DELETE', `/usuarios/${admin.id}`, admin);
      ok('Auto-exclusão proibida -> 409 AUTO_EXCLUSAO', res.s === 409 && res.b.error === 'AUTO_EXCLUSAO');

      // 1.3 ID inválido e inexistente
      res = await call('DELETE', '/usuarios/abc', admin);
      ok('ID inválido -> 400 VALIDACAO', res.s === 400 && res.b.error === 'VALIDACAO');

      res = await call('DELETE', '/usuarios/99999999', admin);
      ok('ID inexistente -> 404 USUARIO_NAO_ENCONTRADO', res.s === 404 && res.b.error === 'USUARIO_NAO_ENCONTRADO');

      // 1.4 Usuário com histórico: criar usuário e atribuir em OM
      const userComHistorico = await mkUser('User Histórico', 'TECNICO', 'f19_hist');
      const omComUser = await prisma.ordem.create({
        data: {
          numeroFormatado: 'OM-F19-TEST-01',
          titulo: 'Falha teste motor',
          solicitanteId: userComHistorico.id,
          equipamentoId: eq.id,
          tipo: 'CORRETIVA',
          prioridade: 'MEDIA',
          categoria: 'MECANICO',
          sintomas: 'Falha teste',
          status: 'ABERTA',
          tipoAtivo: 'MAQUINA',
          custoTipo: 'INTERNO',
        },
      });

      res = await call('DELETE', `/usuarios/${userComHistorico.id}`, admin);
      ok('Usuário com OM como solicitante -> 409 USUARIO_COM_HISTORICO', res.s === 409 && res.b.error === 'USUARIO_COM_HISTORICO');
      ok('Corpo contém referências detalhadas e sugestão DESATIVAR', res.b.referencias?.ordens > 0 && res.b.sugestao === 'DESATIVAR');

      // Verificar que usuário NÃO foi excluído
      let checkDb = await prisma.usuario.findUnique({ where: { id: userComHistorico.id } });
      ok('Usuário com histórico permanece no banco', checkDb !== null);

      // 1.6 Usuário com histórico em auditoria (ator_id)
      const userComAuditoria = await mkUser('User Auditoria', 'OPERADOR', 'f19_aud');
      await prisma.auditoria.create({
        data: {
          atorId: userComAuditoria.id,
          atorPerfil: 'OPERADOR',
          acao: 'LOGIN',
          alvoTipo: 'SISTEMA',
          alvoId: '1',
        },
      });
      res = await call('DELETE', `/usuarios/${userComAuditoria.id}`, admin);
      ok('Usuário com ação em auditoria -> 409 USUARIO_COM_HISTORICO', res.s === 409 && res.b.referencias?.auditoria > 0);

      // 1.7 Exclusão de usuário virgem (sucesso 204)
      const userVirgem = await mkUser('User Virgem', 'OPERADOR', 'f19_virgem', 'virgem@teste.com');
      res = await call('DELETE', `/usuarios/${userVirgem.id}`, admin);
      ok('Exclusão de usuário virgem -> 204 No Content', res.s === 204);

      // Verificar remoção física do banco
      checkDb = await prisma.usuario.findUnique({ where: { id: userVirgem.id } });
      ok('Usuário virgem foi removido fisicamente do banco', checkDb === null);

      // Verificar registro de auditoria USUARIO_EXCLUIDO
      const auditLog = await prisma.auditoria.findFirst({
        where: { acao: 'USUARIO_EXCLUIDO', alvoId: String(userVirgem.id) },
      });
      ok('Auditoria USUARIO_EXCLUIDO registrada', auditLog !== null);
      ok('Auditoria contém nome e matrícula mas NENHUM PIN/hash',
        auditLog?.detalhe !== null &&
        (auditLog?.detalhe as any)?.matricula === 'f19_virgem' &&
        !(auditLog?.detalhe as any)?.pin &&
        !(auditLog?.detalhe as any)?.pinHash
      );

      // 1.8 Reuso de matrícula após exclusão
      const userRecriado = await mkUser('User Recriado', 'OPERADOR', 'f19_virgem', 'virgem2@teste.com');
      ok('Matrícula de usuário excluído pode ser reusada com sucesso', userRecriado.id !== undefined && userRecriado.matricula === 'f19_virgem');

      // =====================================================================
      // 2. B-19-04: CORS do Totem Kiosk e Login Operador / Líder
      // =====================================================================
      console.log('--- 2. B-19-04: CORS do Totem Kiosk e Login Operador / Líder ---');

      // 2.1 Preflight CORS com header X-Totem-Id
      const corsRes = await app.inject({
        method: 'OPTIONS',
        url: '/ordens',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'Content-Type, Authorization, X-Totem-Id',
        },
      });
      const allowHeaders = (corsRes.headers['access-control-allow-headers'] as string ?? '').toLowerCase();
      ok('Preflight CORS inclui X-Totem-Id nos headers permitidos', allowHeaders.includes('x-totem-id'));
      ok('Preflight CORS retorna Access-Control-Allow-Origin', corsRes.headers['access-control-allow-origin'] === 'http://localhost:3000');

      // 2.2 Login por PIN com Operador no Totem
      const loginOper = await call('POST', '/auth/pin', null, {
        matricula: oper.matricula,
        pin: '1234',
        totemId: 'TOTEM-01',
      });
      ok('Login do Operador no Totem -> 200 OK', loginOper.s === 200);
      ok('Sessão é TOTEM com totemId e expiraEmSegundos configurado', loginOper.b.sessao === 'TOTEM' && loginOper.b.totemId === 'TOTEM-01' && loginOper.b.expiraEmSegundos === config.KIOSK_TOKEN_TTL_S);
      const operToken = loginOper.b.token;

      // 2.3 Login por PIN com Líder de Produção no Totem
      const loginLider = await call('POST', '/auth/pin', null, {
        matricula: lider.matricula,
        pin: '1234',
        totemId: 'TOTEM-01',
      });
      ok('Login do Líder no Totem -> 200 OK', loginLider.s === 200);
      ok('Sessão Líder é TOTEM com totemId', loginLider.b.sessao === 'TOTEM' && loginLider.b.totemId === 'TOTEM-01');
      const liderToken = loginLider.b.token;

      // 2.4 Operador autenticado com X-Totem-Id busca equipamentos e setores
      const eqRes = await app.inject({
        method: 'GET',
        url: '/equipamentos',
        headers: { authorization: `Bearer ${operToken}`, 'x-totem-id': 'TOTEM-01' },
      });
      ok('Operador autenticado lista equipamentos no Totem -> 200', eqRes.statusCode === 200);

      const setoresRes = await app.inject({
        method: 'GET',
        url: '/equipamentos/setores',
        headers: { authorization: `Bearer ${operToken}`, 'x-totem-id': 'TOTEM-01' },
      });
      ok('Operador autenticado lista setores no Totem -> 200', setoresRes.statusCode === 200);

      // 2.5 Operador abre OM no Totem
      const omOperRes = await app.inject({
        method: 'POST',
        url: '/ordens',
        headers: { authorization: `Bearer ${operToken}`, 'x-totem-id': 'TOTEM-01' },
        payload: {
          equipamentoId: String(eq.id),
          maquinaParada: false,
          categoria: 'ELETRICO',
          sintomas: ['Ruído anormal no motor'],
          tipoAtivo: 'MAQUINA',
          custoTipo: 'INTERNO',
          confirmarDuplicidade: true,
        },
      });
      ok('Operador abre OM no Totem com X-Totem-Id -> 201 Created', omOperRes.statusCode === 201);

      // 2.6 Líder abre OM no Totem
      const omLiderRes = await app.inject({
        method: 'POST',
        url: '/ordens',
        headers: { authorization: `Bearer ${liderToken}`, 'x-totem-id': 'TOTEM-01' },
        payload: {
          equipamentoId: String(eq.id),
          maquinaParada: true,
          categoria: 'MECANICO',
          sintomas: ['Vazamento de óleo'],
          tipoAtivo: 'MOLDE',
          custoTipo: 'INTERNO',
          confirmarDuplicidade: true,
        },
      });
      ok('Líder abre OM no Totem com X-Totem-Id -> 201 Created', omLiderRes.statusCode === 201);

      // =====================================================================
      // 3. B-19-05: 3ª Opção Customizável de Ativo (OUTRO / tipoAtivoOutro)
      // =====================================================================
      console.log('--- 3. B-19-05: 3ª Opção Customizável de Ativo ---');

      // 3.1 Criação de OM com tipoAtivo: 'OUTRO' e texto customizado válido
      const omOutroValida = await call('POST', '/ordens', oper, {
        equipamentoId: String(eq.id),
        maquinaParada: false,
        categoria: 'MECANICO',
        sintomas: ['Falha na estufa'],
        tipoAtivo: 'OUTRO',
        tipoAtivoOutro: 'Estufa 04',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: true,
      }, { 'x-totem-id': 'TOTEM-01' });
      ok('Criação com OUTRO e texto válido -> 201', omOutroValida.s === 201);
      ok('Retorno contém tipoAtivo OUTRO, tipoAtivoOutro e tipoAtivoRotulo',
        omOutroValida.b.tipoAtivo === 'OUTRO' &&
        omOutroValida.b.tipoAtivoOutro === 'Estufa 04' &&
        omOutroValida.b.tipoAtivoRotulo === 'Estufa 04'
      );

      // 3.2 Validação: OUTRO sem tipoAtivoOutro (rejeitado)
      const omOutroSemTexto = await call('POST', '/ordens', oper, {
        equipamentoId: String(eq.id),
        maquinaParada: false,
        categoria: 'MECANICO',
        sintomas: ['Falha'],
        tipoAtivo: 'OUTRO',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: true,
      }, { 'x-totem-id': 'TOTEM-01' });
      ok('OUTRO sem tipoAtivoOutro -> 400 VALIDACAO', omOutroSemTexto.s === 400 && omOutroSemTexto.b.error === 'VALIDACAO');

      // 3.3 Validação: OUTRO com texto vazio ou espaços em branco (rejeitado)
      const omOutroVazio = await call('POST', '/ordens', oper, {
        equipamentoId: String(eq.id),
        maquinaParada: false,
        categoria: 'MECANICO',
        sintomas: ['Falha'],
        tipoAtivo: 'OUTRO',
        tipoAtivoOutro: '    ',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: true,
      }, { 'x-totem-id': 'TOTEM-01' });
      ok('OUTRO com espaços em branco -> 400 VALIDACAO', omOutroVazio.s === 400);

      // 3.4 Validação: OUTRO com mais de 30 caracteres (rejeitado)
      const omOutroLongo = await call('POST', '/ordens', oper, {
        equipamentoId: String(eq.id),
        maquinaParada: false,
        categoria: 'MECANICO',
        sintomas: ['Falha'],
        tipoAtivo: 'OUTRO',
        tipoAtivoOutro: 'Este texto possui mais de trinta caracteres!',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: true,
      }, { 'x-totem-id': 'TOTEM-01' });
      ok('OUTRO com mais de 30 caracteres -> 400 VALIDACAO', omOutroLongo.s === 400);

      // 3.5 Outro tipo (ex: MOLDE) com tipoAtivoOutro informado deve ignorar e gravar NULL
      const omMoldeComTexto = await call('POST', '/ordens', oper, {
        equipamentoId: String(eq.id),
        maquinaParada: false,
        categoria: 'MECANICO',
        sintomas: ['Molde trincado'],
        tipoAtivo: 'MOLDE',
        tipoAtivoOutro: 'Texto Ignorado',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: true,
      }, { 'x-totem-id': 'TOTEM-01' });
      ok('MOLDE com tipoAtivoOutro -> 201 e tipoAtivoOutro é NULL', omMoldeComTexto.s === 201 && omMoldeComTexto.b.tipoAtivoOutro === null);
      ok('MOLDE possui tipoAtivoRotulo "Molde"', omMoldeComTexto.b.tipoAtivoRotulo === 'Molde');

      // 3.6 Tipo legado ROBO
      const omRobo = await call('POST', '/ordens', oper, {
        equipamentoId: String(eq.id),
        maquinaParada: false,
        categoria: 'ELETRICO',
        sintomas: ['Braço travado'],
        tipoAtivo: 'ROBO',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: true,
      }, { 'x-totem-id': 'TOTEM-01' });
      ok('ROBO -> 201 e tipoAtivoRotulo "Robô"', omRobo.s === 201 && omRobo.b.tipoAtivoRotulo === 'Robô');

      // 3.7 Leitura via GET /ordens/:id
      const getOm = await call('GET', `/ordens/${omOutroValida.b.id}`, oper, null, { 'x-totem-id': 'TOTEM-01' });
      ok('GET /ordens/:id retorna tipoAtivo e tipoAtivoRotulo consistentes',
        getOm.s === 200 &&
        getOm.b.tipoAtivo === 'OUTRO' &&
        getOm.b.tipoAtivoOutro === 'Estufa 04' &&
        getOm.b.tipoAtivoRotulo === 'Estufa 04'
      );

      // 3.8 XSS / Sanitização no rótulo
      const omXss = await call('POST', '/ordens', oper, {
        equipamentoId: String(eq.id),
        maquinaParada: false,
        categoria: 'MECANICO',
        sintomas: ['Falha teste'],
        tipoAtivo: 'OUTRO',
        tipoAtivoOutro: '<script>alert(1)</script>',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: true,
      }, { 'x-totem-id': 'TOTEM-01' });
      ok('Texto com caracteres HTML/script é aceito como texto puro', omXss.s === 201 && omXss.b.tipoAtivoOutro === '<script>alert(1)</script>');

      // Limpeza final
      await prisma.$executeRaw`TRUNCATE ordens_manutencao, equipamentos, auditoria RESTART IDENTITY CASCADE`;
      await prisma.usuario.deleteMany({ where: { matricula: { startsWith: 'f19_' } } });

    } finally {
      // Finalização
    }
  });
});
