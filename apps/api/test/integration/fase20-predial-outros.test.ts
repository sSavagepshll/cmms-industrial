import { describe, it } from 'vitest';
import { criarOk, URL_TESTE } from '../helpers/soft.js';

describe('Fase 20 — Manutenção Predial / Setor Outros', () => {
  it('validação completa dos critérios de aceite da Fase 20', async () => {
    process.env.DATABASE_URL = URL_TESTE;
    process.env.JWT_SECRET ??= 'integration-test-secret-integration-test-secret-0123456789';

    const ok = criarOk();
    try {
      const { buildApp } = await import('../../src/app.js');
      const { prisma } = await import('../../src/db.js');
      const { hashPin } = await import('../../src/auth/password.js');
      const app = buildApp();
      await app.ready();

      // Limpeza de tabelas para o teste
      await prisma.$executeRaw`TRUNCATE ordens_manutencao, equipamentos, auditoria RESTART IDENTITY CASCADE`;
      await prisma.usuario.deleteMany({ where: { matricula: { startsWith: 'f20_' } } });

      const pin = await hashPin('1234');
      const mkUser = (nome: string, perfil: any, matricula: string) =>
        prisma.usuario.create({
          data: { nome, perfil, matricula, pinHash: pin, ativo: true },
        });

      const oper = await mkUser('Operador F20', 'OPERADOR', 'f20_oper');
      const lider = await mkUser('Lider F20', 'LIDER_PRODUCAO', 'f20_lider');

      // Equipamento de produção normal
      const eqProd = await prisma.equipamento.create({
        data: { codigo: 'INJ-F20-01', nome: 'Injetora 120T', setor: 'Injeção', status: 'ATIVO', predial: false },
      });

      // Pseudo-ativo predial (setor Outros)
      const eqPredial = await prisma.equipamento.create({
        data: {
          codigo: 'PREDIAL',
          nome: 'Manutenção Predial / Geral',
          descricao: 'Pseudo-ativo predial',
          setor: 'Outros',
          status: 'ATIVO',
          predial: true,
        },
      });

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
      // 1. Listagem de setores retornando 'Outros' (com predial: true) ao final
      // =====================================================================
      console.log('--- 1. Listagem de setores com Outros ao final ---');
      let res = await call('GET', '/equipamentos/setores', oper);
      ok('GET /equipamentos/setores responde 200', res.s === 200);
      ok('Retorna array de setores', Array.isArray(res.b) && res.b.length >= 2);

      const setores = res.b as { setor: string; equipamentos: number; predial: boolean }[];
      const ultimoSetor = setores[setores.length - 1];
      ok('Último setor da lista é "Outros"', ultimoSetor?.setor === 'Outros');
      ok('"Outros" possui predial === true', ultimoSetor?.predial === true);

      const outrosSetores = setores.slice(0, -1);
      ok('Demais setores de produção possuem predial === false', outrosSetores.every((s) => s.predial === false));

      // Teste de busca por setor e rota /equipamentos/:ref
      res = await call('GET', '/equipamentos?setor=Outros', oper);
      ok('GET /equipamentos?setor=Outros retorna o pseudo-ativo PREDIAL', res.s === 200 && res.b.length === 1 && res.b[0].codigo === 'PREDIAL');

      res = await call('GET', '/equipamentos/PREDIAL', oper);
      ok('GET /equipamentos/PREDIAL (por TAG) responde 200 com predial: true', res.s === 200 && res.b.predial === true && res.b.codigo === 'PREDIAL');

      // =====================================================================
      // 2. Abertura de OM no Totem selecionando 'Outros' e informando local
      // =====================================================================
      console.log('--- 2. Abertura de OM Predial com local e categoria CIVIL_PREDIAL ---');

      // 2.1 Abertura de OM predial válida com local 'Administração' e categoria CIVIL_PREDIAL
      const omPredial1 = await call('POST', '/ordens', oper, {
        equipamentoId: String(eqPredial.id),
        localDescricao: 'Administração',
        categoria: 'CIVIL_PREDIAL',
        sintomas: ['Lâmpada Queimada'],
        maquinaParada: false,
        tipoAtivo: 'OUTRO',
        tipoAtivoOutro: 'Predial',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: true,
      }, { 'x-totem-id': 'TOTEM-01' });

      ok('Abertura de OM predial com local -> 201 Created', omPredial1.s === 201);
      ok('OM criada contém categoria CIVIL_PREDIAL', omPredial1.b.categoria === 'CIVIL_PREDIAL');
      ok('OM criada contém localDescricao "Administração"', omPredial1.b.localDescricao === 'Administração');
      ok('OM criada contém equipamento com predial: true', omPredial1.b.equipamento?.predial === true);
      ok('Descrição gerada não menciona "máquina" e inclui "Local: Administração"',
        !/máquina/i.test(omPredial1.b.descricao) &&
        omPredial1.b.descricao.includes('Local: Administração') &&
        omPredial1.b.descricao.includes('FALHA / REPARO NÃO URGENTE')
      );

      // 2.2 Abertura de OM predial com maquinaParada = true (área interditada/risco)
      const omPredialUrgente = await call('POST', '/ordens', lider, {
        equipamentoId: String(eqPredial.id),
        localDescricao: 'Refeitório',
        categoria: 'CIVIL_PREDIAL',
        sintomas: ['Vazamento/Infiltração'],
        maquinaParada: true,
        tipoAtivo: 'OUTRO',
        tipoAtivoOutro: 'Predial',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: true,
      }, { 'x-totem-id': 'TOTEM-01' });

      ok('OM predial urgente -> 201 Created com prioridade CRITICA', omPredialUrgente.s === 201 && omPredialUrgente.b.prioridade === 'CRITICA');
      ok('Descrição para predial urgente indica ÁREA/INSTALAÇÃO INTERDITADA OU COM RISCO',
        omPredialUrgente.b.descricao.includes('ÁREA/INSTALAÇÃO INTERDITADA OU COM RISCO')
      );

      // 2.3 Validação: OM predial SEM localDescricao (deve ser rejeitada com 400)
      const omSemLocal = await call('POST', '/ordens', oper, {
        equipamentoId: String(eqPredial.id),
        categoria: 'CIVIL_PREDIAL',
        sintomas: ['Tomada Queimada'],
        maquinaParada: false,
        tipoAtivo: 'OUTRO',
        tipoAtivoOutro: 'Predial',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: true,
      }, { 'x-totem-id': 'TOTEM-01' });
      ok('OM predial sem localDescricao -> 400 VALIDACAO', omSemLocal.s === 400 && omSemLocal.b.error === 'VALIDACAO');

      // 2.4 Validação: OM predial com localDescricao > 100 caracteres (deve ser rejeitada)
      const omLocalLongo = await call('POST', '/ordens', oper, {
        equipamentoId: String(eqPredial.id),
        localDescricao: 'A'.repeat(101),
        categoria: 'CIVIL_PREDIAL',
        sintomas: ['Tomada Queimada'],
        maquinaParada: false,
        tipoAtivo: 'OUTRO',
        tipoAtivoOutro: 'Predial',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: true,
      }, { 'x-totem-id': 'TOTEM-01' });
      ok('OM predial com localDescricao > 100 caracteres -> 400 VALIDACAO', omLocalLongo.s === 400);

      // 2.5 Validação: Equipamento de produção comum deve ignorar localDescricao e gravar NULL
      const omProdComLocal = await call('POST', '/ordens', oper, {
        equipamentoId: String(eqProd.id),
        localDescricao: 'Local Qualquer Ignorado',
        categoria: 'MECANICO',
        sintomas: ['Ruído'],
        maquinaParada: false,
        tipoAtivo: 'MAQUINA',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: true,
      }, { 'x-totem-id': 'TOTEM-01' });
      ok('Equipamento de produção comum descarta localDescricao (grava NULL)',
        omProdComLocal.s === 201 && omProdComLocal.b.localDescricao === null
      );

      // =====================================================================
      // 3. Validação de duplicidade por local
      // =====================================================================
      console.log('--- 3. Validação de duplicidade por local ---');

      // 3.1 Tentativa de abrir 2ª OM no MESMO local ('Administração') sem confirmarDuplicidade -> 409 OM_DUPLICADA
      const omDupMesmoLocal = await call('POST', '/ordens', oper, {
        equipamentoId: String(eqPredial.id),
        localDescricao: 'Administração',
        categoria: 'CIVIL_PREDIAL',
        sintomas: ['Fiação exposta'],
        maquinaParada: false,
        tipoAtivo: 'OUTRO',
        tipoAtivoOutro: 'Predial',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: false,
      }, { 'x-totem-id': 'TOTEM-01' });
      ok('Mesmo local no pseudo-ativo predial -> 409 OM_DUPLICADA', omDupMesmoLocal.s === 409 && omDupMesmoLocal.b.error === 'OM_DUPLICADA');

      // 3.2 Mesma localidade com espaços extras e letras maiúsculas/minúsculas -> 409 OM_DUPLICADA
      const omDupCaseEspacos = await call('POST', '/ordens', oper, {
        equipamentoId: String(eqPredial.id),
        localDescricao: '  administração   ',
        categoria: 'CIVIL_PREDIAL',
        sintomas: ['Fiação exposta'],
        maquinaParada: false,
        tipoAtivo: 'OUTRO',
        tipoAtivoOutro: 'Predial',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: false,
      }, { 'x-totem-id': 'TOTEM-01' });
      ok('Mesmo local com variação de case/espaços -> 409 OM_DUPLICADA', omDupCaseEspacos.s === 409 && omDupCaseEspacos.b.error === 'OM_DUPLICADA');

      // 3.3 Abertura no pseudo-ativo predial com LOCAL DIFERENTE ('RH') sem confirmarDuplicidade -> 201 Sucesso
      const omOutroLocal = await call('POST', '/ordens', oper, {
        equipamentoId: String(eqPredial.id),
        localDescricao: 'RH',
        categoria: 'CIVIL_PREDIAL',
        sintomas: ['Ar-condicionado pingando'],
        maquinaParada: false,
        tipoAtivo: 'OUTRO',
        tipoAtivoOutro: 'Predial',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: false,
      }, { 'x-totem-id': 'TOTEM-01' });
      ok('Local diferente no pseudo-ativo predial NÃO gera duplicidade (201 Created)', omOutroLocal.s === 201 && omOutroLocal.b.localDescricao === 'RH');

      // =====================================================================
      // 4. Exibição e consulta do local
      // =====================================================================
      console.log('--- 4. Exibição e consulta do local ---');

      // 4.1 Consulta GET /ordens/:id
      const getDetalhe = await call('GET', `/ordens/${omPredial1.b.id}`, oper, null, { 'x-totem-id': 'TOTEM-01' });
      ok('GET /ordens/:id retorna localDescricao e equipamento.predial',
        getDetalhe.s === 200 &&
        getDetalhe.b.localDescricao === 'Administração' &&
        getDetalhe.b.equipamento?.predial === true
      );

      // 4.2 Filtro por localDescricao em GET /ordens
      const listPorLocal = await call('GET', `/ordens?equipamentoId=${eqPredial.id}&localDescricao=Administração`, oper, null, { 'x-totem-id': 'TOTEM-01' });
      ok('GET /ordens?localDescricao=Administração filtra com precisão',
        listPorLocal.s === 200 &&
        Array.isArray(listPorLocal.b) &&
        listPorLocal.b.every((o: any) => o.localDescricao === 'Administração')
      );

      // 4.3 Busca por texto em GET /ordens?busca=Administração (com equipamentoId para operador)
      const listBusca = await call('GET', `/ordens?equipamentoId=${eqPredial.id}&busca=Administração`, oper, null, { 'x-totem-id': 'TOTEM-01' });
      ok('GET /ordens?busca=Administração encontra OM pelo localDescricao',
        listBusca.s === 200 &&
        listBusca.b.some((o: any) => o.id === omPredial1.b.id)
      );

      // 4.4 Busca global por admin sem restrição de equipamentoId
      const admin = await prisma.usuario.findFirstOrThrow({ where: { perfil: 'ADMIN' } });
      const listBuscaAdmin = await call('GET', `/ordens?busca=Administração`, admin);
      ok('Admin busca global por localDescricao -> 200 e encontra OM',
        listBuscaAdmin.s === 200 &&
        listBuscaAdmin.b.some((o: any) => o.id === omPredial1.b.id)
      );

      // Limpeza final
      await prisma.$executeRaw`TRUNCATE ordens_manutencao, equipamentos, auditoria RESTART IDENTITY CASCADE`;
      await prisma.usuario.deleteMany({ where: { matricula: { startsWith: 'f20_' } } });

    } finally {
      // Finalização
    }
  });
});
