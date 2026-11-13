import { describe, it } from 'vitest';
import { criarOk, URL_TESTE } from '../helpers/soft.js';

describe('Fase 21 — Aprovação Operacional e Conclusão pelo Gestor (Concluir OM)', () => {
  it('validação completa dos critérios de aceite da Fase 21', async () => {
    process.env.DATABASE_URL = URL_TESTE;
    process.env.JWT_SECRET ??= 'integration-test-secret-integration-test-secret-0123456789';

    const ok = criarOk();
    try {
      const { buildApp } = await import('../../src/app.js');
      const { prisma } = await import('../../src/db.js');
      const { hashPin } = await import('../../src/auth/password.js');
      const app = buildApp();
      await app.ready();

      // Limpeza de tabelas para isolamento
      await prisma.$executeRaw`TRUNCATE ordens_manutencao, equipamentos, auditoria RESTART IDENTITY CASCADE`;
      await prisma.usuario.deleteMany({ where: { matricula: { startsWith: 'f21_' } } });

      const pin = await hashPin('1234');
      const mkUser = (nome: string, perfil: any, matricula: string) =>
        prisma.usuario.create({
          data: { nome, perfil, matricula, pinHash: pin, ativo: true },
        });

      const tec = await mkUser('Técnico F21', 'TECNICO', 'f21_tec');
      const tecOutro = await mkUser('Técnico Dois F21', 'TECNICO', 'f21_tec2');
      const oper = await mkUser('Operador F21', 'OPERADOR', 'f21_oper');
      const operOutro = await mkUser('Operador Dois F21', 'OPERADOR', 'f21_oper2');
      const lider = await mkUser('Líder F21', 'LIDER_PRODUCAO', 'f21_lider');
      const ger = await mkUser('Gerente F21', 'GERENTE', 'f21_ger'); // Perfil no Prisma é GERENTE
      const admin = await mkUser('Admin F21', 'ADMIN', 'f21_admin');

      const eq = await prisma.equipamento.create({
        data: { codigo: 'EQ-F21-01', nome: 'Injetora F21', setor: 'Injeção', status: 'ATIVO', predial: false },
      });

      const tok = (u: any) => ({
        authorization: 'Bearer ' + app.jwt.sign({ sub: String(u.id), perfil: u.perfil, nome: u.nome }),
      });

      const call = async (m: any, url: string, u: any | null, payload?: any) => {
        const h = u ? tok(u) : {};
        const r = await app.inject({ method: m, url, headers: h, payload });
        let b: any = null;
        try { b = r.body ? JSON.parse(r.body) : null; } catch { b = r.body; }
        return { s: r.statusCode, b, h: r.headers };
      };

      const PIN = { pin: '1234' };

      const novaOm = async (usr = oper) => {
        const res = await call('POST', '/ordens', usr, {
          equipamentoId: String(eq.id),
          maquinaParada: false,
          categoria: 'MECANICO',
          sintomas: ['Ruído excessivo'],
          tipoAtivo: 'MAQUINA',
          custoTipo: 'INTERNO',
          confirmarDuplicidade: true,
        });
        return String(res.b.id);
      };

      console.log('--- 1. Fluxo feliz: Técnico finaliza -> Operador aprova para AGUARDANDO_BAIXA -> Gestor conclui em /encerrar ---');
      const om1 = await novaOm(oper);
      await call('POST', `/ordens/${om1}/atribuir`, admin, { tecnicoId: String(tec.id) });
      await call('POST', `/ordens/${om1}/assumir`, tec, PIN);
      await call('POST', `/ordens/${om1}/play`, tec, {});
      await call('POST', `/ordens/${om1}/concluir`, tec, { causaRaiz: 'Rolamento gasto', acaoExecutada: 'Substituição do rolamento' });

      // Verificação em AGUARDANDO_APROVACAO
      let om1Dto = (await call('GET', `/ordens/${om1}`, tec)).b;
      ok('técnico conclui e OM vai para AGUARDANDO_APROVACAO', om1Dto.status === 'AGUARDANDO_APROVACAO');

      // Operador aprova
      const ap1 = await call('POST', `/ordens/${om1}/aprovar`, oper, PIN);
      ok('operador aprova: status 200, status AGUARDANDO_BAIXA e statusKanban AGUARDANDO_BAIXA', ap1.s === 200 && ap1.b.status === 'AGUARDANDO_BAIXA' && ap1.b.statusKanban === 'AGUARDANDO_BAIXA');

      // Consulta detalhe da OM: deve conter aprovadoPor e dataAprovacao
      om1Dto = (await call('GET', `/ordens/${om1}`, ger)).b;
      ok('OM em AGUARDANDO_BAIXA tem aprovadoPor registrado', om1Dto.status === 'AGUARDANDO_BAIXA' && om1Dto.aprovadoPor?.id === String(oper.id));

      // Verificação em /ordens/conclusoes-pendentes pelo Gerente
      const pend = await call('GET', '/ordens/conclusoes-pendentes', ger);
      ok('gerente acessa conclusoes-pendentes (200)', pend.s === 200 && Array.isArray(pend.b));
      const itemPend1 = pend.b.find((x: any) => x.id === om1);
      ok('OM1 aparece em conclusões pendentes com executor e aprovador corretos',
        !!itemPend1 && itemPend1.aprovadoPor?.id === String(oper.id) && itemPend1.executores.some((e: any) => e.id === String(tec.id)) && itemPend1.podeConcluir === true);

      // Gerente conclui a OM em /encerrar
      const enc1 = await call('POST', `/ordens/${om1}/encerrar`, ger, { ...PIN, custoTipo: 'INTERNO' });
      ok('gerente conclui em /encerrar: 200, status CONCLUIDA, statusKanban CONCLUIDO',
        enc1.s === 200 && enc1.b.status === 'CONCLUIDA' && enc1.b.statusKanban === 'CONCLUIDO' && enc1.b.concluidoPor === String(ger.id) && !!enc1.b.concluidoEm);

      // Auditoria e histórico verificados
      const audOm1 = await prisma.auditoria.findFirst({ where: { acao: 'OM_CONCLUIDA', alvoId: om1 } });
      ok('auditoria OM_CONCLUIDA registrada com atorId do gestor', audOm1?.atorId === ger.id && audOm1?.atorPerfil === 'GERENTE');

      const histOm1 = await prisma.historicoStatusOrdem.findMany({ where: { ordemId: BigInt(om1) }, orderBy: { id: 'asc' } });
      const transicoes = histOm1.map((h) => `${h.statusAnterior}->${h.statusNovo}`);
      ok('historico_status_ordem contém as transições AGUARDANDO_APROVACAO->AGUARDANDO_BAIXA e AGUARDANDO_BAIXA->CONCLUIDA',
        transicoes.includes('AGUARDANDO_APROVACAO->AGUARDANDO_BAIXA') && transicoes.includes('AGUARDANDO_BAIXA->CONCLUIDA'));

      console.log('--- 2. Bloqueio 403 de Gerente em aprovação/reprovação e /ordens/aprovacoes ---');
      const om2 = await novaOm(oper);
      await call('POST', `/ordens/${om2}/atribuir`, admin, { tecnicoId: String(tec.id) });
      await call('POST', `/ordens/${om2}/assumir`, tec, PIN);
      await call('POST', `/ordens/${om2}/concluir`, tec, { causaRaiz: 'Causa teste', acaoExecutada: 'Ação teste' });

      const gerAp = await call('POST', `/ordens/${om2}/aprovar`, ger, PIN);
      ok('gerente tentando aprovar retorna 403 ACESSO_NEGADO', gerAp.s === 403 && gerAp.b.error === 'ACESSO_NEGADO');

      const gerRep = await call('POST', `/ordens/${om2}/reprovar`, ger, { ...PIN, motivo: 'Rejeitado por gerente' });
      ok('gerente tentando reprovar retorna 403 ACESSO_NEGADO', gerRep.s === 403 && gerRep.b.error === 'ACESSO_NEGADO');

      const gerFilaAp = await call('GET', '/ordens/aprovacoes', ger);
      ok('gerente tentando listar /ordens/aprovacoes retorna 403', gerFilaAp.s === 403);

      console.log('--- 3. Coringa ADMIN: aprova sem espera com emNomeDe e também conclui ---');
      // Admin aprova OM de oper imediatamente (sem esperar 30 min)
      const admAp = await call('POST', `/ordens/${om2}/aprovar`, admin, PIN);
      ok('admin aprova imediatamente com emNomeDe do solicitante', admAp.s === 200 && admAp.b.status === 'AGUARDANDO_BAIXA' && admAp.b.emNomeDe === String(oper.id));

      // Admin também conclui a OM
      const admEnc = await call('POST', `/ordens/${om2}/encerrar`, admin, { ...PIN, custoTipo: 'INTERNO' });
      ok('admin também conclui a OM em /encerrar: 200 CONCLUIDA', admEnc.s === 200 && admEnc.b.status === 'CONCLUIDA' && admEnc.b.concluidoPor === String(admin.id));

      console.log('--- 4. Segregação e auto-aprovação/auto-conclusão proibida ---');
      // Cenário: Admin executa a OM -> não pode aprovar (403 AUTOAPROVACAO_PROIBIDA) nem concluir (403 AUTOCONCLUSAO_PROIBIDA)
      const om3 = await novaOm(oper);
      await call('POST', `/ordens/${om3}/atribuir`, admin, { tecnicoId: String(admin.id) });
      await call('POST', `/ordens/${om3}/assumir`, admin, PIN);
      await call('POST', `/ordens/${om3}/play`, admin, {});
      await call('POST', `/ordens/${om3}/concluir`, admin, { causaRaiz: 'Causa admin', acaoExecutada: 'Ação admin' });

      const admApBloq = await call('POST', `/ordens/${om3}/aprovar`, admin, PIN);
      ok('admin que executou OM é bloqueado na aprovação (403 AUTOAPROVACAO_PROIBIDA)',
        admApBloq.s === 403 && admApBloq.b.error === 'AUTOAPROVACAO_PROIBIDA');

      // Operador aprova a OM3
      await call('POST', `/ordens/${om3}/aprovar`, oper, PIN);

      // Admin tentando concluir a OM que ele mesmo executou -> 403 AUTOCONCLUSAO_PROIBIDA
      const admEncBloq = await call('POST', `/ordens/${om3}/encerrar`, admin, { ...PIN, custoTipo: 'INTERNO' });
      ok('admin que executou OM é bloqueado na conclusão (403 AUTOCONCLUSAO_PROIBIDA)',
        admEncBloq.s === 403 && admEncBloq.b.error === 'AUTOCONCLUSAO_PROIBIDA');

      // Gerente que executou também é bloqueado
      const om4 = await novaOm(oper);
      await call('POST', `/ordens/${om4}/assumir`, ger, PIN);
      await call('POST', `/ordens/${om4}/play`, ger, {});
      await call('POST', `/ordens/${om4}/concluir`, ger, { causaRaiz: 'Causa ger', acaoExecutada: 'Ação ger' });
      await call('POST', `/ordens/${om4}/aprovar`, oper, PIN);

      const pendGer = await call('GET', '/ordens/conclusoes-pendentes', ger);
      const itemOm4 = pendGer.b.find((x: any) => x.id === om4);
      ok('OM4 em conclusões pendentes para o gestor executante tem podeConcluir=false e motivo AUTOCONCLUSAO_PROIBIDA',
        !!itemOm4 && itemOm4.podeConcluir === false && itemOm4.motivoBloqueio === 'AUTOCONCLUSAO_PROIBIDA');

      const gerEncBloq = await call('POST', `/ordens/${om4}/encerrar`, ger, { ...PIN, custoTipo: 'INTERNO' });
      ok('gerente que executou OM é bloqueado em /encerrar (403 AUTOCONCLUSAO_PROIBIDA)',
        gerEncBloq.s === 403 && gerEncBloq.b.error === 'AUTOCONCLUSAO_PROIBIDA');

      console.log('--- 5. RBAC e bloqueios de perfil em /encerrar e /ordens/conclusoes-pendentes ---');
      for (const u of [tec, oper, lider]) {
        const pBlock = await call('GET', '/ordens/conclusoes-pendentes', u);
        ok(`${u.perfil} tentando listar conclusoes-pendentes retorna 403`, pBlock.s === 403);

        const eBlock = await call('POST', `/ordens/${om4}/encerrar`, u, { ...PIN, custoTipo: 'INTERNO' });
        ok(`${u.perfil} tentando POST /encerrar retorna 403`, eBlock.s === 403);
      }

      console.log('--- 6. Validação de erros de status, PIN e idempotência/concorrência em /encerrar ---');
      const omAberta = await novaOm(oper);
      const encStatusInvalido = await call('POST', `/ordens/${omAberta}/encerrar`, ger, { ...PIN, custoTipo: 'INTERNO' });
      ok('POST /encerrar em status ABERTA retorna 409 STATUS_INVALIDO',
        encStatusInvalido.s === 409 && encStatusInvalido.b.error === 'STATUS_INVALIDO');

      const encPinInvalido = await call('POST', `/ordens/${om4}/encerrar`, admin, { pin: '9999', custoTipo: 'INTERNO' });
      ok('POST /encerrar com PIN inválido retorna 401', encPinInvalido.s === 401);

      // Conclusão com sucesso por outro gestor/admin que não executou
      const encOm4Admin = await call('POST', `/ordens/${om4}/encerrar`, admin, { ...PIN, custoTipo: 'INTERNO' });
      ok('outro gestor (admin) conclui OM4 com sucesso: 200 CONCLUIDA', encOm4Admin.s === 200 && encOm4Admin.b.status === 'CONCLUIDA');

      // Segunda chamada subsequente em status já CONCLUIDA -> 409 STATUS_INVALIDO
      const encRepetido = await call('POST', `/ordens/${om4}/encerrar`, admin, { ...PIN, custoTipo: 'INTERNO' });
      ok('segunda chamada em OM já concluída retorna 409 STATUS_INVALIDO',
        encRepetido.s === 409 && encRepetido.b.error === 'STATUS_INVALIDO');

      console.log('--- 7. Imutabilidade em AGUARDANDO_BAIXA (materiais e ficha física) e não bloqueio de nova OM ---');
      // Equipamento dedicado para testar isolamento de duplicidade da OM em AGUARDANDO_BAIXA
      const eq2 = await prisma.equipamento.create({
        data: { codigo: 'EQ-F21-02', nome: 'Injetora F21 Dois', setor: 'Injeção', status: 'ATIVO', predial: false },
      });
      const om5Res = await call('POST', '/ordens', oper, {
        equipamentoId: String(eq2.id), maquinaParada: false, categoria: 'MECANICO', sintomas: ['Ruído'], tipoAtivo: 'MAQUINA', custoTipo: 'INTERNO', confirmarDuplicidade: true,
      });
      const om5 = String(om5Res.b.id);
      await call('POST', `/ordens/${om5}/atribuir`, admin, { tecnicoId: String(tec.id) });
      await call('POST', `/ordens/${om5}/assumir`, tec, PIN);
      await call('POST', `/ordens/${om5}/concluir`, tec, { causaRaiz: 'Causa 5', acaoExecutada: 'Ação 5' });
      await call('POST', `/ordens/${om5}/aprovar`, oper, PIN); // agora em AGUARDANDO_BAIXA

      // Tentativa de adicionar material na OM em AGUARDANDO_BAIXA
      const matBloq = await call('POST', `/ordens/${om5}/materiais`, tec, {
        codigo: 'MAT-01', descricao: 'Parafuso M8', quantidade: 2, unidade: 'UN',
      });
      ok('tentar adicionar material em AGUARDANDO_BAIXA retorna 409 OM_ENCERRADA',
        matBloq.s === 409 && matBloq.b.error === 'OM_ENCERRADA');

      // Não bloqueio de nova OM no mesmo equipamento (RN-04):
      const om5NovaMesmoEq = await call('POST', '/ordens', oper, {
        equipamentoId: String(eq2.id),
        maquinaParada: false,
        categoria: 'MECANICO',
        sintomas: ['Novo sintoma'],
        tipoAtivo: 'MAQUINA',
        custoTipo: 'INTERNO',
        confirmarDuplicidade: false,
      });
      ok('OM em AGUARDANDO_BAIXA não bloqueia nova abertura no mesmo equipamento (RN-04 não acusa duplicidade)',
        om5NovaMesmoEq.s === 201);

      console.log('--- 8. Exclusão de usuário e restrição FK concluido_por (B-19-01) ---');
      const delGerenteBloq = await call('DELETE', `/usuarios/${ger.id}`, admin);
      ok('DELETE /usuarios/:id bloqueia usuário que possui concluido_por com 409 USUARIO_COM_HISTORICO',
        delGerenteBloq.s === 409 && delGerenteBloq.b.error === 'USUARIO_COM_HISTORICO');

    } finally {
      const { prisma: p } = await import('../../src/db.js');
      await p.$disconnect();
    }
  }, 120_000);
});
