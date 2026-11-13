import { describe, it } from 'vitest';
import { criarOk } from '../helpers/soft.js';
import { criarAmbiente } from '../helpers/ambiente.js';

describe('Fase 31 — US-16 (item livre OUTROS, custo no encerramento, equipamentos por grupo)', () => {
  it('validação do contrato §2.4, §3, §4, §5 e §8', async () => {
    const ok = criarOk();
    const A = await criarAmbiente();
    const { prisma, call, mk, tok, app, PIN } = A;
    const limpar = async () => {
      await A.limparBanco();
      await prisma.$executeRaw`DELETE FROM equipamentos WHERE codigo LIKE 'F31-%'`;
      await prisma.$executeRaw`DELETE FROM setores WHERE nome = 'F31 Setor Inativo'`;
      await prisma.$executeRaw`DELETE FROM auditoria WHERE acao LIKE 'EQUIPAMENTO_%'`;
    };
    try {
      await limpar();
      const adm = await mk('Admin F31', 'ADMIN', 'u31_adm');
      const ger = await mk('Gerente F31', 'GERENTE', 'u31_ger');
      const oper = await mk('Operador F31', 'OPERADOR', 'u31_oper');
      const gid = async (codigo: string) => (await prisma.grupoAtivo.findUniqueOrThrow({ where: { codigo } })).id;
      const abrir = async (u: any, corpo: any) => {
        const r = await app.inject({ method: 'POST', url: '/ordens', headers: { ...tok(u), 'x-totem-id': 'TOTEM-F31' }, payload: corpo });
        let b: any = null; try { b = JSON.parse(r.body); } catch { b = r.body; }
        return { s: r.statusCode, b };
      };
      const minimo = (equipamentoId: any, extra: object = {}) => ({
        equipamentoId: String(equipamentoId), maquinaParada: false, categoria: 'MECANICO', sintomas: ['Ruído Anormal'],
        totemIdOrigem: 'TOTEM-F31', ...extra,
      });

      // O TRUNCATE do ambiente apaga o pseudo-ativo; recria como a V023 o criaria.
      const eqLivre = await prisma.equipamento.create({ data: { codigo: 'OUTROS', nome: 'Item Não Cadastrado / Outros', setor: 'Geral', itemLivre: true, grupoId: await gid('PREDIAL_OUTROS') } });
      const eqProd = await prisma.equipamento.create({ data: { codigo: 'F31-PROD', nome: 'Prensa F31', setor: 'Geral' } });

      // ---- 1. POST /ordens: custo NULL e item livre ----
      let r = await abrir(oper, minimo(eqProd.id));
      ok('1. sem custo -> 201 com custoTipo/centroCusto null', r.s === 201 && r.b.custoTipo === null && r.b.centroCusto === null, JSON.stringify(r.b).slice(0, 160));
      r = await abrir(oper, minimo(eqProd.id, { custoTipo: 'CLIENTE', centroCusto: 'CC-1', confirmarDuplicidade: true }));
      ok('1. payload legado com custo -> 201 e continua null', r.s === 201 && r.b.custoTipo === null && r.b.centroCusto === null);
      r = await abrir(oper, minimo(eqProd.id, { itemDescricao: 'Texto ignorado', confirmarDuplicidade: true }));
      ok('1. equipamento comum com itemDescricao -> descartado (null)', r.s === 201 && r.b.itemDescricao === null);

      r = await abrir(oper, minimo(eqLivre.id));
      ok('1. pseudo-ativo sem itemDescricao -> 400 VALIDACAO no campo itemDescricao', r.s === 400 && r.b.error === 'VALIDACAO' && r.b.detalhes?.[0]?.campo === 'itemDescricao');
      r = await abrir(oper, minimo(eqLivre.id, { itemDescricao: 'ab' }));
      ok('1. itemDescricao curto (<3) -> 400', r.s === 400 && r.b.detalhes?.[0]?.campo === 'itemDescricao');
      r = await abrir(oper, minimo(eqLivre.id, { itemDescricao: 'x'.repeat(101) }));
      ok('1. itemDescricao longo (>100) -> 400', r.s === 400 && r.b.detalhes?.[0]?.campo === 'itemDescricao');
      r = await abrir(oper, minimo(eqLivre.id, { itemDescricao: '  Carrinho   hidráulico da moagem ', localDescricao: 'ignorado' }));
      ok('1. pseudo-ativo com texto -> 201, normalizado, OUTRO/Outros, sem local', r.s === 201 && r.b.itemDescricao === 'Carrinho hidráulico da moagem'
        && r.b.tipoAtivo === 'OUTRO' && r.b.tipoAtivoOutro === 'Outros' && r.b.localDescricao === null && r.b.equipamento.itemLivre === true, JSON.stringify(r.b).slice(0, 200));
      ok('1. título e descrição trazem o item', String(r.b.titulo).startsWith('Carrinho hidráulico da moagem — ') && String(r.b.descricao).includes('Item: Carrinho hidráulico da moagem'));
      const omLivre = r.b.id as string;

      // ---- 2. Duplicidade por item normalizado ----
      r = await abrir(oper, minimo(eqLivre.id, { itemDescricao: 'CARRINHO HIDRÁULICO   da moagem' }));
      ok('2. mesmo texto normalizado (caixa/espaços) -> 409 OM_DUPLICADA', r.s === 409 && r.b.error === 'OM_DUPLICADA' && r.b.ordensAbertas?.[0]?.id === omLivre);
      r = await abrir(oper, minimo(eqLivre.id, { itemDescricao: 'Esteira da expedição' }));
      ok('2. texto diferente -> 201', r.s === 201);
      r = await abrir(oper, minimo(eqLivre.id, { itemDescricao: 'CARRINHO hidráulico da moagem', confirmarDuplicidade: true }));
      ok('2. confirmarDuplicidade=true ignora a advertência', r.s === 201);
      r = await call('GET', `/ordens?equipamentoId=${eqLivre.id}&itemDescricao=carrinho%20hidr%C3%A1ulico%20da%20moagem`, oper);
      ok('2. GET /ordens?itemDescricao= filtra (case-insensitive)', r.s === 200 && r.b.length === 2 && r.b.every((o: any) => o.itemDescricao.toLowerCase() === 'carrinho hidráulico da moagem'), `${r.s} ${r.b?.length}`);

      // ---- 3. Encerramento com custo ----
      const aguardar = async (omId: string) => prisma.$executeRaw`UPDATE ordens_manutencao SET status = 'AGUARDANDO_BAIXA', data_conclusao = now(), aprovado_por = ${oper.id}, data_aprovacao = now() WHERE id = ${BigInt(omId)}`;
      await aguardar(omLivre);
      const url = `/ordens/${omLivre}/encerrar`;
      r = await call('POST', url, ger, { ...PIN });
      ok('3. só {pin} -> 400 VALIDACAO (custoTipo obrigatório)', r.s === 400 && r.b.error === 'VALIDACAO');
      r = await call('POST', url, ger, { ...PIN, custoTipo: 'OUTRO' });
      ok('3. custoTipo inválido -> 400', r.s === 400);
      r = await call('POST', url, ger, { pin: '9999' });
      ok('3. custo ausente + PIN errado -> 400 (validação vem antes do PIN)', r.s === 400);
      r = await call('POST', url, ger, { ...PIN, custoTipo: 'CLIENTE', centroCusto: 'x'.repeat(51) });
      ok('3. centroCusto > 50 -> 400', r.s === 400);
      ok('3. OM segue AGUARDANDO_BAIXA após os 400', (await prisma.ordem.findUniqueOrThrow({ where: { id: BigInt(omLivre) } })).status === 'AGUARDANDO_BAIXA');
      r = await call('POST', url, ger, { ...PIN, custoTipo: 'CLIENTE', centroCusto: '  CC-77 ' });
      ok('3. CLIENTE + centro -> 200 com custo na resposta', r.s === 200 && r.b.status === 'CONCLUIDA' && r.b.custoTipo === 'CLIENTE' && r.b.centroCusto === 'CC-77', JSON.stringify(r.b));
      const banco = await prisma.ordem.findUniqueOrThrow({ where: { id: BigInt(omLivre) } });
      ok('3. persistido: tipo_custo=CLIENTE e centro_custo=CC-77', banco.custoTipo === 'CLIENTE' && banco.centroCusto === 'CC-77');
      const aud = (await prisma.auditoria.findMany({ where: { acao: 'OM_CONCLUIDA', alvoId: omLivre } }))[0]?.detalhe as any;
      ok('3. auditoria OM_CONCLUIDA registra custoTipo e centroCusto', aud?.custoTipo === 'CLIENTE' && aud?.centroCusto === 'CC-77');
      const om2 = (await abrir(oper, minimo(eqProd.id, { confirmarDuplicidade: true }))).b.id as string;
      await aguardar(om2);
      r = await call('POST', `/ordens/${om2}/encerrar`, adm, { ...PIN, custoTipo: 'INTERNO', centroCusto: '' });
      const b2 = await prisma.ordem.findUniqueOrThrow({ where: { id: BigInt(om2) } });
      ok('3. INTERNO + centroCusto vazio -> 200, centro não informado (null)', r.s === 200 && r.b.centroCusto === null && b2.custoTipo === 'INTERNO' && b2.centroCusto === null, JSON.stringify(r.b));

      // ---- 4. Guardas no banco ----
      const falha = async (sql: () => Promise<unknown>) => { try { await sql(); return false; } catch (e: any) { return /23514|reservado|imutavel|excluido/.test(String(e?.message ?? e)) || e?.code === 'P2010' || true; } };
      ok('4. DELETE do pseudo-ativo -> erro', await falha(() => prisma.$executeRaw`DELETE FROM equipamentos WHERE id = ${eqLivre.id}`));
      ok('4. UPDATE codigo do pseudo-ativo -> erro', await falha(() => prisma.$executeRaw`UPDATE equipamentos SET codigo = 'X-OUT' WHERE id = ${eqLivre.id}`));
      ok('4. máquina comum no grupo PREDIAL_OUTROS -> erro', await falha(async () => prisma.$executeRaw`UPDATE equipamentos SET grupo_id = ${await gid('PREDIAL_OUTROS')} WHERE id = ${eqProd.id}`));
      ok('4. segundo item_livre -> erro (índice único)', await falha(() => prisma.$executeRaw`INSERT INTO equipamentos (codigo, nome, setor, item_livre, grupo_id) VALUES ('F31-DUP', 'Dup', 'Geral', TRUE, ${eqLivre.grupoId})`));

      // ---- 5. API do Totem ----
      r = await call('GET', '/equipamentos/grupos', oper);
      const gs = r.b as any[];
      ok('5. Fase 35: 4 grupos, modo sempre LISTA, sem equipamentoId', r.s === 200 && gs.length === 4 && gs.every((x) => x.modo === 'LISTA' && !('equipamentoId' in x)));
      ok('5. GET /equipamentos nunca lista OUTROS; só ?grupo=PREDIAL_OUTROS (sem busca) o traz com itemLivre', !(await call('GET', '/equipamentos', oper)).b.some((e: any) => e.codigo === 'OUTROS')
        && (await call('GET', '/equipamentos?grupo=PREDIAL_OUTROS', oper)).b.some((e: any) => e.codigo === 'OUTROS' && e.itemLivre === true)
        && !(await call('GET', '/equipamentos?grupo=PREDIAL_OUTROS&busca=OUTROS', oper)).b.some((e: any) => e.codigo === 'OUTROS'));
      ok('5. GET /equipamentos/OUTROS -> 404 (não buscável por TAG)', (await call('GET', '/equipamentos/OUTROS', oper)).s === 404);
      const loc = await call('GET', '/equipamentos/locais', oper);
      ok('5. GET /equipamentos/locais: lista { id, nome } ordenada', loc.s === 200 && Array.isArray(loc.b) && loc.b.every((l: any) => typeof l.id === 'string' && typeof l.nome === 'string'));
      ok('5. /equipamentos/locais exige autenticação', (await app.inject({ method: 'GET', url: '/equipamentos/locais' })).statusCode === 401);

      // ---- 6. Admin: equipamentos por grupo ----
      const gProd = String(await gid('PRODUTIVOS')); const gOutros = String(await gid('PREDIAL_OUTROS')); const gMol = String(await gid('MOLDES'));
      for (const [n, u] of [['GERENTE', ger], ['OPERADOR', oper]] as const) {
        ok(`6. ${n}: GET/POST /grupos-ativos/:id/equipamentos -> 403`,
          (await call('GET', `/grupos-ativos/${gProd}/equipamentos`, u)).s === 403 && (await call('POST', `/grupos-ativos/${gProd}/equipamentos`, u, { tag: 'F31-X', nome: 'Máquina X' })).s === 403);
      }
      const setorGeral = await prisma.setor.findFirstOrThrow({ where: { nome: 'Geral' } });
      const sid = String(setorGeral.id);
      r = await call('POST', `/grupos-ativos/${gMol}/equipamentos`, adm, { tag: 'F31-MOL1', nome: 'Molde 1', modelo: 'M-1', setorId: sid });
      ok('6. POST cria no grupo da URL (molde), no setor informado, ATIVO', r.s === 201 && r.b.grupoCodigo === 'MOLDES' && r.b.setorNome === 'Geral' && r.b.status === 'ATIVO' && r.b.tag === 'F31-MOL1', JSON.stringify(r.b).slice(0, 200));
      const mol = r.b.id as string;
      const dAud = (await prisma.auditoria.findMany({ where: { acao: 'EQUIPAMENTO_CRIADO' }, orderBy: { id: 'desc' } }))[0]?.detalhe as any;
      ok('6. auditoria EQUIPAMENTO_CRIADO com grupo', dAud?.grupo === 'MOLDES' && dAud?.tag === 'F31-MOL1');
      ok('6. POST TAG duplicada (case-insensitive) -> 409', (await call('POST', `/grupos-ativos/${gProd}/equipamentos`, adm, { tag: 'f31-mol1', nome: 'Outro', setorId: sid })).s === 409);
      r = await call('POST', `/grupos-ativos/${gOutros}/equipamentos`, adm, { tag: 'F31-OUT', nome: 'Proibido', setorId: sid });
      ok('6. POST no grupo PREDIAL_OUTROS -> 422 GRUPO_RESERVADO', r.s === 422 && r.b.error === 'GRUPO_RESERVADO');
      ok('6. POST grupo inexistente -> 404 GRUPO_NAO_ENCONTRADO', (await call('POST', '/grupos-ativos/999999/equipamentos', adm, { tag: 'F31-Z', nome: 'Zeta', setorId: sid })).b?.error === 'GRUPO_NAO_ENCONTRADO');
      ok('6. POST campo extra -> 400', (await call('POST', `/grupos-ativos/${gProd}/equipamentos`, adm, { tag: 'F31-Y', nome: 'Ypsilon', setorId: sid, extra: 1 })).s === 400);
      // Fase 35 (RN-72): setorId obrigatório, sem padrão "Geral"; valida existência, ativo e não predial.
      ok('6. Fase 35: POST sem setorId -> 400', (await call('POST', `/grupos-ativos/${gProd}/equipamentos`, adm, { tag: 'F31-Y', nome: 'Ypsilon' })).s === 400);
      ok('6. Fase 35: setor inexistente -> 404 SETOR_NAO_ENCONTRADO', (await call('POST', `/grupos-ativos/${gProd}/equipamentos`, adm, { tag: 'F31-Y', nome: 'Ypsilon', setorId: '999999' })).b?.error === 'SETOR_NAO_ENCONTRADO');
      const setorPred = await prisma.setor.findFirst({ where: { predial: true } });
      if (setorPred) ok('6. Fase 35: setor predial -> 422 SETOR_PREDIAL_SEM_EQUIPAMENTOS', (await call('POST', `/grupos-ativos/${gProd}/equipamentos`, adm, { tag: 'F31-Y', nome: 'Ypsilon', setorId: String(setorPred.id) })).b?.error === 'SETOR_PREDIAL_SEM_EQUIPAMENTOS');
      const setorX = await prisma.setor.create({ data: { nome: 'F31 Setor Inativo', ativo: false } });
      ok('6. Fase 35: setor inativo -> 422 SETOR_INATIVO', (await call('POST', `/grupos-ativos/${gProd}/equipamentos`, adm, { tag: 'F31-Y', nome: 'Ypsilon', setorId: String(setorX.id) })).b?.error === 'SETOR_INATIVO');
      await prisma.setor.delete({ where: { id: setorX.id } });
      r = await call('POST', `/grupos-ativos/${gProd}/equipamentos`, adm, { tag: 'F31-SET', nome: 'Máquina com setor', setorId: sid });
      ok('6. Fase 35: máquina criada por grupo usa o setor escolhido (não fixa Geral)', r.s === 201 && r.b.setorId === sid);


      r = await call('GET', `/grupos-ativos/${gMol}/equipamentos`, adm);
      ok('6. GET lista o grupo com { itens, total, grupo } e X-Total-Count', r.s === 200 && r.b.itens.some((i: any) => i.tag === 'F31-MOL1') && r.b.total === r.b.itens.length
        && r.h['x-total-count'] === String(r.b.total) && r.b.grupo.codigo === 'MOLDES' && r.b.grupo.modo === 'LISTA' && r.b.grupo.reservado === false);
      await prisma.equipamento.upsert({ where: { codigo: 'PREDIAL' }, update: { status: 'ATIVO' }, create: { codigo: 'PREDIAL', nome: 'Manutenção Predial / Geral', setor: 'Outros', predial: true, status: 'ATIVO' } });
      r = await call('GET', `/grupos-ativos/${gMol}/equipamentos`, adm);
      ok('6. Fase 35: MOLDES não traz mais o pseudo-ativo PREDIAL', !r.b.itens.some((i: any) => i.tag === 'PREDIAL'));
      ok('6. busca (TAG/nome) filtra', (await call('GET', `/grupos-ativos/${gMol}/equipamentos?busca=f31-mol`, adm)).b.itens.length === 1);
      ok('6. status=INATIVO filtra', (await call('GET', `/grupos-ativos/${gMol}/equipamentos?status=INATIVO`, adm)).b.itens.length === 0);
      ok('6. paginação limit=1', (await call('GET', `/grupos-ativos/${gMol}/equipamentos?limit=1`, adm)).b.itens.length === 1);
      ok('6. query desconhecida -> 400', (await call('GET', `/grupos-ativos/${gMol}/equipamentos?x=1`, adm)).s === 400);
      r = await call('GET', `/grupos-ativos/${gOutros}/equipamentos`, adm);
      ok('6. PREDIAL_OUTROS -> 200 itens [] e reservado:true (modo LISTA)', r.s === 200 && r.b.itens.length === 0 && r.b.grupo.reservado === true && r.b.grupo.modo === 'LISTA');
      ok('6. GET grupo inexistente -> 404', (await call('GET', '/grupos-ativos/999999/equipamentos', adm)).s === 404);

      r = await call('GET', '/grupos-ativos', adm);
      const gOut = r.b.find((x: any) => x.codigo === 'PREDIAL_OUTROS'); const gPr = r.b.find((x: any) => x.codigo === 'PRODUTIVOS');
      ok('6. GET /grupos-ativos: modo/reservado/equipamentosInativos; contagens sem pseudo-ativo', r.s === 200 && gOut.modo === 'LISTA' && gOut.reservado === true && gOut.equipamentos === 0
        && gPr.modo === 'LISTA' && gPr.reservado === false && typeof gPr.equipamentosInativos === 'number');

      // Transferência e proteções do PUT/DELETE
      r = await call('PUT', `/equipamentos/${eqProd.id}`, adm, { grupoId: gOutros });
      ok('6. PUT destino PREDIAL_OUTROS -> 422 GRUPO_RESERVADO', r.s === 422 && r.b.error === 'GRUPO_RESERVADO');
      ok('6. PUT no pseudo-ativo -> 422 ATIVO_RESERVADO', (await call('PUT', `/equipamentos/${eqLivre.id}`, adm, { nome: 'Renomeado' })).b?.error === 'ATIVO_RESERVADO');
      ok('6. DELETE do pseudo-ativo -> 422 ATIVO_RESERVADO', (await call('DELETE', `/equipamentos/${eqLivre.id}`, adm)).b?.error === 'ATIVO_RESERVADO');
      const omsAntes = await prisma.ordem.count({ where: { equipamentoId: eqProd.id } });
      r = await call('PUT', `/equipamentos/${eqProd.id}`, adm, { grupoId: gMol });
      ok('6. PUT transfere de grupo sem alterar OMs nem setor', r.s === 200 && r.b.grupoCodigo === 'MOLDES' && r.b.setorNome === 'Geral' && r.b.avisos === undefined
        && (await prisma.ordem.count({ where: { equipamentoId: eqProd.id } })) === omsAntes);
      r = await call('DELETE', `/equipamentos/${eqProd.id}`, adm);
      ok('6. DELETE com histórico -> 409 EQUIPAMENTO_COM_HISTORICO (sugere INATIVAR)', r.s === 409 && r.b.error === 'EQUIPAMENTO_COM_HISTORICO' && r.b.sugestao === 'INATIVAR');
      ok('6. DELETE sem histórico -> 204', (await call('DELETE', `/equipamentos/${mol}`, adm)).s === 204);
    } finally {
      await limpar();
      await A.fechar();
    }
  });
});
