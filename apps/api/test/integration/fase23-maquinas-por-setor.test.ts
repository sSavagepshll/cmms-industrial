import { describe, it } from 'vitest';
import { criarOk } from '../helpers/soft.js';
import { criarAmbiente } from '../helpers/ambiente.js';

const NOMES = ['F23 Injeção', 'F23 Usinagem', 'F23 Inativo'];

describe('Fase 23 — Máquinas por setor (CRUD administrativo de equipamentos)', () => {
  it('validação dos critérios de aceite 1–11 e 12 (auditoria) do contrato', async () => {
    const ok = criarOk();
    const A = await criarAmbiente();
    const { prisma, call, mk, tok, app } = A;
    const limpar = async () => {
      await A.limparBanco();
      await prisma.$executeRaw`DELETE FROM equipamentos WHERE codigo LIKE 'F23-%' OR codigo ILIKE 'f23%'`;
      await prisma.setor.deleteMany({ where: { nome: { in: NOMES }, predial: false } });
      await prisma.$executeRaw`DELETE FROM auditoria WHERE acao LIKE 'EQUIPAMENTO_%' OR acao LIKE 'SETOR_%'`;
    };
    try {
      await limpar();
      const adm = await mk('Admin F23', 'ADMIN', 'u23_adm');
      const ger = await mk('Gerente F23', 'GERENTE', 'u23_ger');
      const oper = await mk('Operador F23', 'OPERADOR', 'u23_oper');
      const aud = (acao: string) => prisma.auditoria.findMany({ where: { acao }, orderBy: { id: 'asc' } });
      const abrir = async (u: any, equipamentoId: any) => {
        const r = await app.inject({
          method: 'POST', url: '/ordens', headers: { ...tok(u), 'x-totem-id': 'TOTEM-F23' },
          payload: { equipamentoId: String(equipamentoId), categoria: 'MECANICO', sintomas: ['Ruído'], maquinaParada: false, tipoAtivo: 'MAQUINA', custoTipo: 'INTERNO', confirmarDuplicidade: true },
        });
        return { s: r.statusCode, b: JSON.parse(r.body) };
      };

      const inj = (await prisma.setor.create({ data: { nome: 'F23 Injeção' }, select: { id: true } })).id.toString();
      const usi = (await prisma.setor.create({ data: { nome: 'F23 Usinagem' }, select: { id: true } })).id.toString();
      const predial = (await prisma.setor.findFirstOrThrow({ where: { predial: true } })).id.toString();
      await prisma.equipamento.upsert({
        where: { codigo: 'PREDIAL' }, update: { status: 'ATIVO' },
        create: { codigo: 'PREDIAL', nome: 'Manutenção Predial / Geral', setor: 'Outros', predial: true, status: 'ATIVO' },
      });
      const pseudo = await prisma.equipamento.findUniqueOrThrow({ where: { codigo: 'PREDIAL' } });

      // ---- 1. Criar ----
      let r = await call('POST', `/setores/${inj}/equipamentos`, adm, { tag: ' F23-INJ-03 ', nome: '  Injetora   3 ', modelo: 'Haitian MA900' });
      ok('1. POST -> 201 normalizado, ATIVO, setor do caminho', r.s === 201 && r.b.tag === 'F23-INJ-03' && r.b.nome === 'Injetora 3' && r.b.modelo === 'Haitian MA900' && r.b.status === 'ATIVO' && r.b.setorId === inj && r.b.setorNome === 'F23 Injeção');
      ok('1. contagens zeradas e datas', r.b.omsAbertas === 0 && r.b.omsTotal === 0 && !!r.b.criadoEm && !!r.b.atualizadoEm);
      const eqId = r.b.id as string;
      const bd = await prisma.equipamento.findUniqueOrThrow({ where: { id: BigInt(eqId) } });
      ok('1. texto `setor` derivado pelo trigger', bd.setor === 'F23 Injeção' && bd.predial === false);
      const cA = await aud('EQUIPAMENTO_CRIADO');
      ok('1. auditoria EQUIPAMENTO_CRIADO (alvoTipo EQUIPAMENTO)', cA.length === 1 && cA[0]!.alvoTipo === 'EQUIPAMENTO' && cA[0]!.alvoId === eqId && (cA[0]!.detalhe as any)?.tag === 'F23-INJ-03');
      const tot = (await call('GET', '/equipamentos/setores', oper)).b as any[];
      ok('1. aparece no Totem (setor e equipamento)', tot.some((s) => s.id === inj && s.equipamentos === 1)
        && (await call('GET', `/equipamentos?setorId=${inj}`, oper)).b.some((e: any) => e.codigo === 'F23-INJ-03'));
      r = await call('POST', `/setores/${inj}/equipamentos`, adm, { tag: 'F23-INJ-04', nome: 'Injetora 4', modelo: '   ' });
      ok('1. modelo vazio -> null', r.s === 201 && r.b.modelo === null);

      // ---- 2. Duplicidade e validação ----
      r = await call('POST', `/setores/${inj}/equipamentos`, adm, { tag: 'f23-inj-03', nome: 'Outra' });
      ok('2. tag duplicada (caixa) -> 409 EQUIPAMENTO_TAG_DUPLICADA {campo:tag}', r.s === 409 && r.b.error === 'EQUIPAMENTO_TAG_DUPLICADA' && r.b.campo === 'tag');
      for (const t of ['F23-ÁÇ', 'F23<x>', '', ' ', 'A', '-F23', 'X'.repeat(51)]) {
        ok(`2. tag inválida "${t}" -> 400`, (await call('POST', `/setores/${inj}/equipamentos`, adm, { tag: t, nome: 'Máquina' })).s === 400);
      }
      ok('2. nome curto -> 400', (await call('POST', `/setores/${inj}/equipamentos`, adm, { tag: 'F23-X1', nome: 'a' })).s === 400);
      ok('2. campo desconhecido (status) -> 400', (await call('POST', `/setores/${inj}/equipamentos`, adm, { tag: 'F23-X2', nome: 'Máquina', status: 'INATIVO' })).s === 400);
      ok('2. setor inexistente -> 404 SETOR_NAO_ENCONTRADO', (await call('POST', '/setores/999999/equipamentos', adm, { tag: 'F23-X3', nome: 'Máquina' })).b?.error === 'SETOR_NAO_ENCONTRADO');

      // ---- 3. Predial protegido ----
      r = await call('POST', `/setores/${predial}/equipamentos`, adm, { tag: 'F23-P1', nome: 'Máquina' });
      ok('3. criar no setor predial -> 422 SETOR_PREDIAL_SEM_EQUIPAMENTOS', r.s === 422 && r.b.error === 'SETOR_PREDIAL_SEM_EQUIPAMENTOS');
      ok('3. PUT no PREDIAL -> 409 EQUIPAMENTO_PROTEGIDO', (await call('PUT', `/equipamentos/${pseudo.id}`, adm, { nome: 'Outro nome' })).b?.error === 'EQUIPAMENTO_PROTEGIDO');
      ok('3. DELETE no PREDIAL -> 409 EQUIPAMENTO_PROTEGIDO', (await call('DELETE', `/equipamentos/${pseudo.id}`, adm)).b?.error === 'EQUIPAMENTO_PROTEGIDO');
      r = await call('GET', `/setores/${predial}/equipamentos`, adm);
      ok('3. PREDIAL não é listado (200, itens vazios, setor.predial)', r.s === 200 && r.b.itens.length === 0 && r.b.setor.predial === true);
      ok('3. mover máquina para o setor predial -> 422', (await call('PUT', `/equipamentos/${eqId}`, adm, { setorId: predial })).b?.error === 'SETOR_PREDIAL_SEM_EQUIPAMENTOS');

      // ---- 4. Setor inativo ----
      const ina = (await prisma.setor.create({ data: { nome: 'F23 Inativo' }, select: { id: true } })).id.toString();
      await call('PUT', `/setores/${ina}`, adm, { ativo: false });
      ok('4. criar em setor inativo -> 422 SETOR_INATIVO', (await call('POST', `/setores/${ina}/equipamentos`, adm, { tag: 'F23-I1', nome: 'Máquina' })).b?.error === 'SETOR_INATIVO');
      ok('4. mover para setor inativo -> 422 SETOR_INATIVO', (await call('PUT', `/equipamentos/${eqId}`, adm, { setorId: ina })).b?.error === 'SETOR_INATIVO');

      // ---- 5. Atualizar ----
      r = await call('PUT', `/equipamentos/${eqId}`, adm, { tag: 'F23-INJ-03B', nome: 'Injetora 3 B', modelo: null });
      ok('5. PUT tag/nome/modelo -> 200', r.s === 200 && r.b.tag === 'F23-INJ-03B' && r.b.nome === 'Injetora 3 B' && r.b.modelo === null && r.b.avisos === undefined);
      const at = await aud('EQUIPAMENTO_ATUALIZADO');
      const d = at[0]?.detalhe as any;
      ok('5. auditoria com antes/depois só dos campos alterados', at.length === 1 && d.antes.tag === 'F23-INJ-03' && d.depois.tag === 'F23-INJ-03B' && d.antes.modelo === 'Haitian MA900' && d.depois.modelo === null && d.antes.status === undefined);
      r = await call('PUT', `/equipamentos/${eqId}`, adm, { nome: 'Injetora 3 B', tag: 'F23-INJ-03B' });
      ok('5. PUT sem mudança real -> 200 sem nova auditoria', r.s === 200 && (await aud('EQUIPAMENTO_ATUALIZADO')).length === 1);
      ok('5. PUT para tag de outra máquina (caixa diferente) -> 409', (await call('PUT', `/equipamentos/${eqId}`, adm, { tag: 'f23-inj-04' })).b?.error === 'EQUIPAMENTO_TAG_DUPLICADA');
      ok('5. PUT vazio -> 400', (await call('PUT', `/equipamentos/${eqId}`, adm, {})).s === 400);
      ok('5. PUT inexistente -> 404', (await call('PUT', '/equipamentos/999999', adm, { nome: 'Qualquer' })).b?.error === 'EQUIPAMENTO_NAO_ENCONTRADO');
      ok('5. PUT com setor (texto) no corpo -> 400', (await call('PUT', `/equipamentos/${eqId}`, adm, { setor: 'Hack' })).s === 400);

      // ---- 6. Mover ----
      r = await call('PUT', `/equipamentos/${eqId}`, adm, { setorId: usi });
      ok('6. mover -> 200 com setor novo e aviso', r.s === 200 && r.b.setorId === usi && r.b.setorNome === 'F23 Usinagem' && r.b.avisos?.[0] === 'HISTORICO_PASSA_A_CONTAR_NO_NOVO_SETOR');
      ok('6. trigger reescreve `equipamentos.setor`', (await prisma.equipamento.findUniqueOrThrow({ where: { id: BigInt(eqId) } })).setor === 'F23 Usinagem');
      ok('6. Totem lista a máquina no novo setor', (await call('GET', `/equipamentos?setorId=${usi}`, oper)).b.some((e: any) => e.codigo === 'F23-INJ-03B'));
      const dm = (await aud('EQUIPAMENTO_ATUALIZADO')).at(-1)?.detalhe as any;
      ok('6. auditoria registra setor antes/depois', dm.antes.setorNome === 'F23 Injeção' && dm.depois.setorNome === 'F23 Usinagem');

      // ---- 7. Status ----
      const om = await abrir(oper, eqId);
      ok('7. (pré) OM aberta na máquina', om.s === 201);
      r = await call('PUT', `/equipamentos/${eqId}`, adm, { status: 'INATIVO' });
      ok('7. inativar com OM aberta -> 409 EQUIPAMENTO_COM_OMS_ATIVAS {omsAbertas}', r.s === 409 && r.b.error === 'EQUIPAMENTO_COM_OMS_ATIVAS' && r.b.omsAbertas === 1);
      r = await call('PUT', `/equipamentos/${(await prisma.equipamento.findUniqueOrThrow({ where: { codigo: 'F23-INJ-04' } })).id}`, adm, { status: 'INATIVO' });
      ok('7. inativar sem OM -> 200', r.s === 200 && r.b.status === 'INATIVO');
      ok('7. inativa some do Totem', !(await call('GET', `/equipamentos?setorId=${inj}`, oper)).b.some((e: any) => e.codigo === 'F23-INJ-04'));
      r = await call('PUT', `/equipamentos/${r.b.id}`, adm, { status: 'ATIVO' });
      ok('7. reativar -> 200 e volta ao Totem', r.s === 200 && r.b.status === 'ATIVO' && (await call('GET', `/equipamentos?setorId=${inj}`, oper)).b.some((e: any) => e.codigo === 'F23-INJ-04'));

      // ---- 8. Status inválido ----
      ok('8. status DESCARTADO -> 400', (await call('PUT', `/equipamentos/${eqId}`, adm, { status: 'DESCARTADO' })).s === 400);
      ok('8. status EM_MANUTENCAO -> 400', (await call('PUT', `/equipamentos/${eqId}`, adm, { status: 'EM_MANUTENCAO' })).s === 400);

      // ---- 9. Excluir ----
      r = await call('DELETE', `/equipamentos/${eqId}`, adm);
      ok('9. DELETE com OM -> 409 EQUIPAMENTO_COM_HISTORICO {omsTotal,omsAbertas,sugestao}', r.s === 409 && r.b.error === 'EQUIPAMENTO_COM_HISTORICO' && r.b.omsTotal === 1 && r.b.omsAbertas === 1 && r.b.sugestao === 'INATIVAR');
      ok('9. nada alterado após o 409', !!(await prisma.equipamento.findUnique({ where: { id: BigInt(eqId) } })));
      await prisma.$executeRaw`UPDATE ordens_manutencao SET status = 'CANCELADA' WHERE equipamento_id = ${BigInt(eqId)}`;
      r = await call('DELETE', `/equipamentos/${eqId}`, adm);
      ok('9. OM CANCELADA também bloqueia (qualquer histórico)', r.s === 409 && r.b.omsTotal === 1 && r.b.omsAbertas === 0);
      const livre = (await call('POST', `/setores/${inj}/equipamentos`, adm, { tag: 'F23-DEL', nome: 'Descartável', modelo: 'M1' })).b.id as string;
      ok('9. DELETE sem OM -> 204', (await call('DELETE', `/equipamentos/${livre}`, adm)).s === 204);
      const ex = await aud('EQUIPAMENTO_EXCLUIDO');
      ok('9. auditoria com snapshot', ex.length === 1 && (ex[0]!.detalhe as any)?.tag === 'F23-DEL' && (ex[0]!.detalhe as any)?.setorNome === 'F23 Injeção' && (ex[0]!.detalhe as any)?.modelo === 'M1');
      ok('9. DELETE repetido -> 404', (await call('DELETE', `/equipamentos/${livre}`, adm)).b?.error === 'EQUIPAMENTO_NAO_ENCONTRADO');

      // ---- 10. RBAC ----
      for (const [nome, u] of [['GERENTE', ger], ['OPERADOR', oper]] as const) {
        ok(`10. ${nome}: GET lista -> 403`, (await call('GET', `/setores/${inj}/equipamentos`, u)).s === 403);
        ok(`10. ${nome}: POST -> 403`, (await call('POST', `/setores/${inj}/equipamentos`, u, { tag: 'F23-R1', nome: 'Máquina' })).s === 403);
        ok(`10. ${nome}: PUT -> 403`, (await call('PUT', `/equipamentos/${eqId}`, u, { nome: 'Hack' })).s === 403);
        ok(`10. ${nome}: DELETE -> 403`, (await call('DELETE', `/equipamentos/${eqId}`, u)).s === 403);
      }
      for (const [m, url] of [['GET', `/setores/${inj}/equipamentos`], ['POST', `/setores/${inj}/equipamentos`], ['PUT', `/equipamentos/${eqId}`], ['DELETE', `/equipamentos/${eqId}`]] as const) {
        ok(`10. sem token: ${m} -> 401`, (await app.inject({ method: m, url, payload: m === 'GET' || m === 'DELETE' ? undefined : {} })).statusCode === 401);
      }
      ok('10. rotas de leitura do Totem seguem abertas ao OPERADOR', (await call('GET', `/equipamentos/${eqId}`, oper)).s === 200);

      // ---- 11. Listagem ----
      for (let i = 1; i <= 3; i++) await call('POST', `/setores/${usi}/equipamentos`, adm, { tag: `F23-USI-0${i}`, nome: `Torno ${i}`, modelo: i === 2 ? 'Romi GL' : null });
      r = await call('GET', `/setores/${usi}/equipamentos?limit=2`, adm);
      ok('11. paginação e X-Total-Count', r.s === 200 && r.b.itens.length === 2 && r.h['x-total-count'] === '4' && r.b.setor.id === usi);
      ok('11. ordenação por tag', r.b.itens[0].tag === 'F23-INJ-03B' && r.b.itens[1].tag === 'F23-USI-01');
      r = await call('GET', `/setores/${usi}/equipamentos?limit=2&offset=2`, adm);
      ok('11. offset', r.b.itens.length === 2 && r.b.itens[0].tag === 'F23-USI-02');
      ok('11. busca por modelo', (await call('GET', `/setores/${usi}/equipamentos?busca=romi`, adm)).b.itens.length === 1);
      ok('11. busca por nome', (await call('GET', `/setores/${usi}/equipamentos?busca=torno%203`, adm)).b.itens.length === 1);
      ok('11. busca com % literal não vira curinga', (await call('GET', `/setores/${usi}/equipamentos?busca=%25`, adm)).b.itens.length === 0);
      ok('11. filtro por status', (await call('GET', `/setores/${usi}/equipamentos?status=INATIVO`, adm)).b.itens.length === 0);
      ok('11. limit > 200 -> 400', (await call('GET', `/setores/${usi}/equipamentos?limit=201`, adm)).s === 400);
      ok('11. setor inexistente -> 404', (await call('GET', '/setores/999999/equipamentos', adm)).b?.error === 'SETOR_NAO_ENCONTRADO');
      const itU = (await call('GET', '/setores', adm)).b.find((s: any) => s.id === usi);
      ok('11. contadores de GET /setores acompanham (equipamentos e omsAbertas/omsTotal)', itU.equipamentos === 4 && itU.omsTotal === 1 && itU.omsAbertas === 0);

      // ---- 12. Auditoria: filtro e rótulo ----
      r = await call('GET', '/auditoria?alvoTipo=EQUIPAMENTO&limit=500', adm);
      ok('12. /auditoria filtra por EQUIPAMENTO', r.s === 200 && r.b.length > 0 && r.b.every((a: any) => a.alvoTipo === 'EQUIPAMENTO'));
      ok('12. rótulo = tag (equipamento existente)', r.b.some((a: any) => a.alvoId === eqId && a.alvoRotulo === 'F23-INJ-03B'));
      ok('12. rótulo do excluído cai para detalhe.tag', r.b.some((a: any) => a.acao === 'EQUIPAMENTO_EXCLUIDO' && a.alvoRotulo === 'F23-DEL'));
      r = await call('GET', '/auditoria?alvoTipo=SETOR&limit=500', adm);
      ok('12. /auditoria filtra por SETOR com rótulo = nome', r.s === 200 && r.b.length > 0 && r.b.some((a: any) => a.alvoRotulo === 'F23 Inativo'));

      // ---- Corrida de FK (OM criada entre a checagem e o DELETE) é coberta pelo mesmo 409: o banco é a última barreira ----
      let fk = false;
      try { await prisma.$executeRaw`DELETE FROM equipamentos WHERE id = ${BigInt(eqId)}`; } catch { fk = true; }
      ok('FK RESTRICT impede DELETE direto de máquina com OM', fk);
    } finally {
      await limpar();
      await A.fechar();
    }
  });
});
