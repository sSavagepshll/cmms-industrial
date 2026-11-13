import { describe, it } from 'vitest';
import { criarOk } from '../helpers/soft.js';
import { criarAmbiente } from '../helpers/ambiente.js';

describe('Fase 30 — US-15 (tipoAtivo derivado, custo default, grupos de ativos)', () => {
  it('validação do contrato §2, §3.3, §4.4 e §7', async () => {
    const ok = criarOk();
    const A = await criarAmbiente();
    const { prisma, call, mk, tok, app } = A;
    const nomesOriginais = await prisma.grupoAtivo.findMany({ select: { id: true, nome: true, ordem: true } });
    const limpar = async () => {
      await A.limparBanco();
      await prisma.$executeRaw`DELETE FROM equipamentos WHERE codigo LIKE 'F30-%'`;
      await prisma.setor.deleteMany({ where: { nome: 'F30 Setor', predial: false } });
      for (const g of nomesOriginais) await prisma.$executeRaw`UPDATE grupos_ativos SET nome = ${g.nome}, ordem = ${g.ordem} WHERE id = ${g.id}`;
      await prisma.$executeRaw`DELETE FROM auditoria WHERE acao = 'GRUPO_ATUALIZADO' OR acao LIKE 'EQUIPAMENTO_%'`;
    };
    try {
      await limpar();
      const adm = await mk('Admin F30', 'ADMIN', 'u30_adm');
      const ger = await mk('Gerente F30', 'GERENTE', 'u30_ger');
      const oper = await mk('Operador F30', 'OPERADOR', 'u30_oper');
      const gid = async (codigo: string) => (await prisma.grupoAtivo.findUniqueOrThrow({ where: { codigo } })).id;
      const abrir = async (u: any, corpo: any) => {
        const r = await app.inject({ method: 'POST', url: '/ordens', headers: { ...tok(u), 'x-totem-id': 'TOTEM-F30' }, payload: corpo });
        let b: any = null; try { b = JSON.parse(r.body); } catch { b = r.body; }
        return { s: r.statusCode, b };
      };
      const minimo = (equipamentoId: any, extra: object = {}) => ({
        equipamentoId: String(equipamentoId), maquinaParada: false, categoria: 'MECANICO', sintomas: ['Ruído Anormal'],
        observacao: 'Ruído alto', totemIdOrigem: 'TOTEM-F30', confirmarDuplicidade: true, ...extra,
      });

      const eqProd = await prisma.equipamento.create({ data: { codigo: 'F30-PROD', nome: 'Prensa', setor: 'F30 Setor' } });
      const eqImp = await prisma.equipamento.create({ data: { codigo: 'F30-IMP', nome: 'Compressor', setor: 'F30 Setor', grupoId: await gid('IMPRODUTIVOS') } });
      const eqMolde = await prisma.equipamento.create({ data: { codigo: 'F30-MOL', nome: 'Molde 12', setor: 'F30 Setor', grupoId: await gid('MOLDES') } });
      // Fase 35: PREDIAL_OUTROS é reservado aos pseudo-ativos PREDIAL e OUTROS (item_livre); a TRUNCATE do ambiente os apaga, então são recriados aqui.
      const eqOutros = await prisma.equipamento.create({ data: { codigo: 'OUTROS', nome: 'Item Não Cadastrado / Outros', setor: 'Geral', itemLivre: true, grupoId: await gid('PREDIAL_OUTROS') } });
      const eqPred = await prisma.equipamento.upsert({
        where: { codigo: 'PREDIAL' }, update: { status: 'ATIVO' },
        create: { codigo: 'PREDIAL', nome: 'Manutenção Predial / Geral', setor: 'Outros', predial: true, status: 'ATIVO' },
      });
      ok('INSERT sem grupo: trigger põe PRODUTIVOS; predial vai para PREDIAL_OUTROS',
        (await prisma.equipamento.findUniqueOrThrow({ where: { id: eqProd.id }, include: { grupo: true } })).grupo?.codigo === 'PRODUTIVOS'
        && (await prisma.equipamento.findUniqueOrThrow({ where: { id: eqPred.id }, include: { grupo: true } })).grupo?.codigo === 'PREDIAL_OUTROS');

      // ---- 1. POST /ordens: payload mínimo (§2.1) e derivação (§3.3) ----
      const casos: [any, string, string | null, string][] = [
        [eqProd, 'MAQUINA', null, 'PRODUTIVOS'],
        [eqImp, 'MAQUINA', null, 'IMPRODUTIVOS'],
        [eqMolde, 'MOLDE', null, 'MOLDES'],
        [eqOutros, 'OUTRO', 'Outros', 'PREDIAL_OUTROS'],
      ];
      for (const [eq, tipo, outro, grupo] of casos) {
        const r = await abrir(oper, minimo(eq.id, eq === eqOutros ? { itemDescricao: 'Carrinho hidráulico' } : {}));
        ok(`1. mínimo (${grupo}) -> 201 com tipoAtivo=${tipo}`, r.s === 201 && r.b.tipoAtivo === tipo && r.b.tipoAtivoOutro === outro, JSON.stringify(r.b).slice(0, 200));
        ok(`1. (${grupo}) Fase 31: custoTipo=null, centroCusto=null`, r.b.custoTipo === null && r.b.centroCusto === null);
        ok(`1. (${grupo}) tipoAtivoRotulo coerente`, r.b.tipoAtivoRotulo === (tipo === 'MOLDE' ? 'Molde' : tipo === 'MAQUINA' ? 'Máquina' : 'Outros'));
      }
      let r = await abrir(oper, minimo(eqPred.id, { categoria: 'CIVIL_PREDIAL', localDescricao: 'RH' }));
      ok('1. predial sem tipoAtivo -> OUTRO/Predial', r.s === 201 && r.b.tipoAtivo === 'OUTRO' && r.b.tipoAtivoOutro === 'Predial' && r.b.tipoAtivoRotulo === 'Predial');
      const omBanco = await prisma.ordem.findFirstOrThrow({ where: { equipamentoId: eqProd.id } });
      ok('1. persistido no banco', omBanco.custoTipo === null && omBanco.centroCusto === null && omBanco.tipoAtivo === 'MAQUINA');

      // ---- 2. Compatibilidade retroativa ----
      r = await abrir(oper, minimo(eqProd.id, { tipoAtivo: 'ROBO', custoTipo: 'CLIENTE', centroCusto: 'CC-9' }));
      ok('2. payload legado completo -> 201: ROBO respeitado, custo descartado (Fase 31)', r.s === 201 && r.b.tipoAtivo === 'ROBO' && r.b.custoTipo === null && r.b.centroCusto === null);
      r = await abrir(oper, minimo(eqProd.id, { tipoCusto: 'CLIENTE' }));
      ok('2. alias tipoCusto continua aceito (e descartado)', r.s === 201 && r.b.custoTipo === null);
      r = await abrir(oper, minimo(eqProd.id, { tipoAtivo: 'OUTRO', tipoAtivoOutro: 'Esteira' }));
      ok('2. tipoAtivo OUTRO explícito mantém o rótulo informado', r.s === 201 && r.b.tipoAtivoOutro === 'Esteira' && r.b.tipoAtivoRotulo === 'Esteira');
      r = await abrir(oper, minimo(eqProd.id, { tipoAtivo: 'OUTRO' }));
      ok('2. OUTRO explícito sem rótulo -> 400', r.s === 400 && r.b.error === 'VALIDACAO');
      r = await abrir(oper, minimo(eqProd.id, { campoInexistente: 1 }));
      ok('2. campo desconhecido -> 400', r.s === 400);
      r = await abrir(oper, minimo(eqProd.id, { custoTipo: 'OUTRO' }));
      ok('2. custoTipo inválido -> 400', r.s === 400);
      r = await abrir(oper, minimo(eqProd.id, { tipoAtivo: 'XYZ' }));
      ok('2. tipoAtivo inválido -> 400', r.s === 400);

      // ---- 3. V022: default no banco ----
      await prisma.$executeRaw`INSERT INTO ordens_manutencao (equipamento_id, solicitante_id, titulo) VALUES (${eqProd.id}, ${oper.id}, 'Insert direto F30')`;
      const direto = await prisma.ordem.findFirstOrThrow({ where: { titulo: 'Insert direto F30' } });
      ok('3. SQL direto sem tipo_custo -> NULL (V023 removeu o DEFAULT)', direto.custoTipo === null);

      // ---- 4. GET /equipamentos/grupos ----
      r = await call('GET', '/equipamentos/grupos', oper);
      const g = r.b as any[];
      ok('4. sempre 4 grupos na ordem fixa', r.s === 200 && g.length === 4 && g.map((x) => x.codigo).join() === 'PRODUTIVOS,IMPRODUTIVOS,MOLDES,PREDIAL_OUTROS');
      ok('4. forma { codigo, nome, ordem, total }', g.every((x) => typeof x.nome === 'string' && typeof x.ordem === 'number' && typeof x.total === 'number'));
      const tot = (c: string) => g.find((x) => x.codigo === c).total as number;
      ok('4. totais: produtivos >=1, improdutivos >=1, moldes >=1, predial+outros = 2 (os dois pseudo-ativos)', tot('PRODUTIVOS') >= 1 && tot('IMPRODUTIVOS') >= 1 && tot('MOLDES') >= 1 && tot('PREDIAL_OUTROS') === 2);
      ok('4. Fase 35: modo sempre LISTA e sem equipamentoId', g.every((x) => x.modo === 'LISTA' && !('equipamentoId' in x)));
      const antes = tot('IMPRODUTIVOS');
      await prisma.equipamento.update({ where: { id: eqImp.id }, data: { status: 'INATIVO' } });
      ok('4. total conta só equipamentos ATIVOS', ((await call('GET', '/equipamentos/grupos', oper)).b as any[]).find((x) => x.codigo === 'IMPRODUTIVOS').total === antes - 1);
      await prisma.equipamento.update({ where: { id: eqImp.id }, data: { status: 'ATIVO' } });
      const setorF30 = await prisma.setor.findFirstOrThrow({ where: { nome: 'F30 Setor' } });
      await prisma.setor.update({ where: { id: setorF30.id }, data: { ativo: false } });
      ok('4. total ignora setor inativo (os 4 grupos seguem listados)', ((await call('GET', '/equipamentos/grupos', oper)).b as any[]).length === 4 && ((await call('GET', '/equipamentos/grupos', oper)).b as any[]).find((x) => x.codigo === 'PRODUTIVOS').total === tot('PRODUTIVOS'));
      await prisma.setor.update({ where: { id: setorF30.id }, data: { ativo: true } });
      ok('4. GERENTE e sem token: autenticado apenas', (await call('GET', '/equipamentos/grupos', ger)).s === 200 && (await app.inject({ method: 'GET', url: '/equipamentos/grupos' })).statusCode === 401);

      // ---- 5. GET /equipamentos?grupo= ----
      r = await call('GET', '/equipamentos?grupo=MOLDES', oper);
      ok('5. filtro grupo MOLDES: só moldes (sem PREDIAL), com campo `grupo`', r.s === 200 && r.b.some((e: any) => e.codigo === 'F30-MOL' && e.grupo === 'MOLDES') && !r.b.some((e: any) => e.codigo === 'PREDIAL') && r.b.every((e: any) => e.grupo === 'MOLDES' && e.itemLivre === false));
      r = await call('GET', '/equipamentos?grupo=PREDIAL_OUTROS', oper);
      ok('5. Fase 35: PREDIAL_OUTROS traz PREDIAL e o item avulso (itemLivre:true)', r.s === 200 && r.b.length === 2 && r.b.some((e: any) => e.codigo === 'PREDIAL' && e.itemLivre === false) && r.b.some((e: any) => e.codigo === 'OUTROS' && e.itemLivre === true));
      ok('5. Fase 35: com busca o item avulso some; sem grupo também', !(await call('GET', '/equipamentos?grupo=PREDIAL_OUTROS&busca=out', oper)).b.some((e: any) => e.codigo === 'OUTROS') && !(await call('GET', '/equipamentos', oper)).b.some((e: any) => e.codigo === 'OUTROS'));
      ok('5. grupo inválido -> 400', (await call('GET', '/equipamentos?grupo=XYZ', oper)).s === 400);
      ok('5. sem grupo: lista tudo (sem o pseudo-ativo) e ?setor= continua', (await call('GET', '/equipamentos?setor=F30%20Setor', oper)).b.length === 3);
      ok('5. grupo + busca combinam; códigos antigos (OUTROS, MOLDES_PREDIAL) -> 400', (await call('GET', '/equipamentos?grupo=PRODUTIVOS&busca=f30-prod', oper)).b.length === 1 && (await call('GET', '/equipamentos?grupo=OUTROS', oper)).s === 400 && (await call('GET', '/equipamentos?grupo=MOLDES_PREDIAL', oper)).s === 400);

      // ---- 6. Admin: /grupos-ativos ----
      for (const [n, u] of [['GERENTE', ger], ['OPERADOR', oper]] as const) {
        ok(`6. ${n}: GET /grupos-ativos -> 403`, (await call('GET', '/grupos-ativos', u)).s === 403);
        ok(`6. ${n}: PUT -> 403`, (await call('PUT', `/grupos-ativos/${nomesOriginais[0]!.id}`, u, { nome: 'Hack' })).s === 403);
      }
      r = await call('GET', '/grupos-ativos', adm);
      ok('6. GET admin: 4 grupos com contagens', r.s === 200 && r.b.length === 4 && r.b.every((x: any) => typeof x.equipamentos === 'number' && typeof x.equipamentosAtivos === 'number' && x.id));
      const pid = r.b.find((x: any) => x.codigo === 'PRODUTIVOS').id as string;
      r = await call('PUT', `/grupos-ativos/${pid}`, adm, { nome: '  Equip.   Produtivos F30 ', ordem: 7 });
      ok('6. PUT nome/ordem -> 200 normalizado', r.s === 200 && r.b.nome === 'Equip. Produtivos F30' && r.b.ordem === 7 && r.b.codigo === 'PRODUTIVOS');
      ok('6. Totem reflete nome e ordem', ((await call('GET', '/equipamentos/grupos', oper)).b as any[]).at(-1).nome === 'Equip. Produtivos F30');
      const au = await prisma.auditoria.findMany({ where: { acao: 'GRUPO_ATUALIZADO' } });
      ok('6. auditoria GRUPO_ATUALIZADO com de/para', au.length === 1 && au[0]!.alvoTipo === 'GRUPO_ATIVO' && (au[0]!.detalhe as any)?.para === 'Equip. Produtivos F30' && (au[0]!.detalhe as any)?.ordemPara === 7);
      ok('6. PUT sem mudança: 200 sem nova auditoria', (await call('PUT', `/grupos-ativos/${pid}`, adm, { ordem: 7 })).s === 200 && (await prisma.auditoria.count({ where: { acao: 'GRUPO_ATUALIZADO' } })) === 1);
      ok('6. nome duplicado (caixa) -> 409 GRUPO_NOME_DUPLICADO', (await call('PUT', `/grupos-ativos/${pid}`, adm, { nome: 'predial e outros' })).b?.error === 'GRUPO_NOME_DUPLICADO');
      ok('6. codigo no corpo -> 400 (imutável)', (await call('PUT', `/grupos-ativos/${pid}`, adm, { codigo: 'OUTROS' })).s === 400);
      ok('6. PUT vazio / nome curto -> 400', (await call('PUT', `/grupos-ativos/${pid}`, adm, {})).s === 400 && (await call('PUT', `/grupos-ativos/${pid}`, adm, { nome: 'a' })).s === 400);
      ok('6. grupo inexistente -> 404 GRUPO_NAO_ENCONTRADO', (await call('PUT', '/grupos-ativos/999999', adm, { nome: 'Qualquer' })).b?.error === 'GRUPO_NAO_ENCONTRADO');
      ok('6. sem POST/DELETE (rotas inexistentes)', (await call('POST', '/grupos-ativos', adm, { nome: 'Novo' })).s === 404 && (await call('DELETE', `/grupos-ativos/${pid}`, adm)).s === 404);
      let del = false; try { await prisma.$executeRaw`DELETE FROM grupos_ativos WHERE id = ${BigInt(pid)}`; } catch { del = true; }
      let cod = false; try { await prisma.$executeRaw`UPDATE grupos_ativos SET codigo = 'OUTROS' WHERE id = ${BigInt(pid)}`; } catch { cod = true; }
      ok('6. banco impede excluir grupo e mudar codigo', del && cod);
      r = await call('GET', '/auditoria?alvoTipo=GRUPO_ATIVO', adm);
      ok('6. /auditoria filtra por GRUPO_ATIVO com rótulo = nome', r.s === 200 && r.b.length === 1 && r.b[0].alvoRotulo === 'Equip. Produtivos F30');

      // ---- 7. Equipamento: grupoId no cadastro admin ----
      const gOut = String(await gid('MOLDES')); // destino válido da troca (PREDIAL_OUTROS é reservado)
      const gOutros = String(await gid('PREDIAL_OUTROS'));
      const gMol = String(await gid('MOLDES'));
      r = await call('POST', `/setores/${setorF30.id}/equipamentos`, adm, { tag: 'F30-NOVO', nome: 'Nova máquina' });
      ok('7. POST sem grupoId -> PRODUTIVOS por padrão', r.s === 201 && r.b.grupoCodigo === 'PRODUTIVOS');
      const novo = r.b.id as string;
      r = await call('POST', `/setores/${setorF30.id}/equipamentos`, adm, { tag: 'F30-NOVO2', nome: 'Molde novo', grupoId: gMol });
      ok('7. POST com grupoId', r.s === 201 && r.b.grupoCodigo === 'MOLDES' && typeof r.b.grupoNome === 'string');
      ok('7. POST com grupo inexistente -> 404 GRUPO_NAO_ENCONTRADO', (await call('POST', `/setores/${setorF30.id}/equipamentos`, adm, { tag: 'F30-NOVO3', nome: 'X Máquina', grupoId: '999999' })).b?.error === 'GRUPO_NAO_ENCONTRADO');
      const omAntes = await prisma.ordem.count({ where: { equipamentoId: eqProd.id } });
      r = await call('PUT', `/equipamentos/${eqProd.id}`, adm, { grupoId: gOut });
      ok('7. PUT troca de grupo -> 200', r.s === 200 && r.b.grupoCodigo === 'MOLDES');
      ok('7. OMs preservadas após trocar o grupo', (await prisma.ordem.count({ where: { equipamentoId: eqProd.id } })) === omAntes);
      const dA = (await prisma.auditoria.findMany({ where: { acao: 'EQUIPAMENTO_ATUALIZADO' }, orderBy: { id: 'desc' } }))[0]?.detalhe as any;
      ok('7. auditoria com grupo antes/depois', dA?.antes?.grupo === 'PRODUTIVOS' && dA?.depois?.grupo === 'MOLDES');
      ok('7. nova OM usa o grupo novo para derivar tipoAtivo', (await abrir(oper, minimo(eqProd.id))).b.tipoAtivo === 'MOLDE');
      ok('7. PUT mesmo grupo: sem mudança', (await call('PUT', `/equipamentos/${eqProd.id}`, adm, { grupoId: gOut })).s === 200);
      ok('7. PUT grupo inexistente -> 404', (await call('PUT', `/equipamentos/${novo}`, adm, { grupoId: '999999' })).b?.error === 'GRUPO_NAO_ENCONTRADO');
      ok('7. PUT grupoId no PREDIAL -> 409 EQUIPAMENTO_PROTEGIDO', (await call('PUT', `/equipamentos/${eqPred.id}`, adm, { grupoId: gOut })).b?.error === 'EQUIPAMENTO_PROTEGIDO');
      let pr = false; try { await prisma.$executeRaw`UPDATE equipamentos SET grupo_id = ${BigInt(gMol)} WHERE id = ${eqPred.id}`; } catch { pr = true; }
      ok('7. banco impede predial fora de PREDIAL_OUTROS', pr);
      ok('7. listagem admin traz grupo', (await call('GET', `/setores/${setorF30.id}/equipamentos`, adm)).b.itens.every((i: any) => typeof i.grupoCodigo === 'string'));
    } finally {
      await limpar();
      await A.fechar();
    }
  });
});
