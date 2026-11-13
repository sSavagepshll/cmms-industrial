import { describe, it } from 'vitest';
import { criarOk } from '../helpers/soft.js';
import { criarAmbiente } from '../helpers/ambiente.js';

const NOMES = ['Usinagem', 'Usinagem CNC', 'Setor Vazio', 'Setor Vazio 2'];

describe('Fase 22 — Setores dinâmicos, setor predial configurável e locais padrão', () => {
  it('validação dos critérios de aceite do contrato (§3 e §5)', async () => {
    const ok = criarOk();
    const A = await criarAmbiente();
    const { prisma, call, mk, tok, app } = A;
    const limpar = async () => {
      await A.limparBanco();
      await prisma.$executeRaw`UPDATE equipamentos SET setor_id = (SELECT id FROM setores WHERE predial) WHERE predial`;
      await prisma.$executeRaw`DELETE FROM equipamentos WHERE codigo LIKE 'F22-%'`;
      await prisma.setor.deleteMany({ where: { nome: { in: NOMES }, predial: false } });
      await prisma.$executeRaw`UPDATE setores SET nome = 'Outros', ativo = TRUE WHERE predial`;
      await prisma.setorLocal.deleteMany({ where: { nome: { in: ['Almoxarifado', 'Almox'] } } });
      // Restaura os 6 locais seed do contrato (o teste reordena/exclui locais).
      await prisma.$executeRaw`DELETE FROM setor_locais`;
      await prisma.$executeRaw`INSERT INTO setor_locais (setor_id, nome, ordem) SELECT s.id, v.nome, v.ordem FROM setores s, (VALUES ('Administração',1),('RH',2),('Refeitório',3),('Recepção',4),('Banheiros',5),('Pátio',6)) AS v(nome, ordem) WHERE s.predial`;
      await prisma.$executeRaw`DELETE FROM auditoria WHERE acao LIKE 'SETOR_%'`;
    };
    try {
      await limpar();
      const adm = await mk('Admin F22', 'ADMIN', 'u22_adm');
      const ger = await mk('Gerente F22', 'GERENTE', 'u22_ger');
      const tec = await mk('Tecnico F22', 'TECNICO', 'u22_tec');
      const oper = await mk('Operador F22', 'OPERADOR', 'u22_oper');
      const lider = await mk('Lider F22', 'LIDER_PRODUCAO', 'u22_lid');
      const ordemBody = (equipamentoId: bigint | string, extra: object = {}) => ({
        equipamentoId: String(equipamentoId), categoria: 'MECANICO', sintomas: ['Ruído'], maquinaParada: false,
        tipoAtivo: 'MAQUINA', custoTipo: 'INTERNO', confirmarDuplicidade: true, ...extra,
      });
      const abrir = async (u: any, corpo: any) => {
        const r = await app.inject({ method: 'POST', url: '/ordens', headers: { ...tok(u), 'x-totem-id': 'TOTEM-F22' }, payload: corpo });
        let b: any = null; try { b = JSON.parse(r.body); } catch { b = r.body; }
        return { s: r.statusCode, b };
      };
      const audit = (acao: string) => prisma.auditoria.findMany({ where: { acao }, orderBy: { id: 'asc' } });

      // ---- 5. RBAC ----
      for (const [nome, u] of [['GERENTE', ger], ['TECNICO', tec], ['OPERADOR', oper], ['LIDER', lider]] as const) {
        ok(`${nome}: GET /setores -> 403`, (await call('GET', '/setores', u)).s === 403);
        ok(`${nome}: POST /setores -> 403`, (await call('POST', '/setores', u, { nome: 'Usinagem' })).s === 403);
      }
      ok('GERENTE: /setores/opcoes -> 200', (await call('GET', '/setores/opcoes', ger)).s === 200);
      ok('ADMIN: /setores/opcoes -> 200', (await call('GET', '/setores/opcoes', adm)).s === 200);
      ok('OPERADOR: /setores/opcoes -> 403', (await call('GET', '/setores/opcoes', oper)).s === 403);
      ok('GERENTE: /setores/:id/locais -> 403', (await call('GET', '/setores/1/locais', ger)).s === 403);

      // ---- 1. Criar ----
      // Fase 37 (RN-88): catálogo fechado -> POST /setores é 422; o setor de teste é criado direto no banco.
      let r = await call('POST', '/setores', adm, { nome: '  Usinagem  ', ordem: 5 });
      ok('Fase 37: POST /setores -> 422 SETOR_CATALOGO_FECHADO', r.s === 422 && r.b.error === 'SETOR_CATALOGO_FECHADO');
      const usiRow = await prisma.setor.create({ data: { nome: 'Usinagem', ordem: 5 }, select: { id: true } });
      r = await call('GET', `/setores?busca=Usinagem`, adm);
      const usiItem = r.b.find((x: any) => x.nome === 'Usinagem');
      ok('Item no formato §3.2 (contagens e podeExcluir)', usiItem && usiItem.equipamentos === 0 && usiItem.omsAbertas === 0 && usiItem.omsTotal === 0 && usiItem.podeExcluir === true && usiItem.motivoNaoExclui === null);
      const usi = usiRow.id.toString();
      r = await call('GET', '/setores/opcoes?uso=equipamento', adm);
      ok('Fase 37: ?uso=equipamento só traz setores oficiais ativos (Usinagem de teste fica fora)', r.s === 200 && Array.isArray(r.b) && r.b.every((x: any) => x.oficial === true && x.ativo === true) && !r.b.some((x: any) => x.nome === 'Usinagem'));
      ok('Nome curto -> 400 VALIDACAO', (await call('POST', '/setores', adm, { nome: 'a' })).s === 400);
      ok('Nome com caractere de controle -> 400', (await call('POST', '/setores', adm, { nome: 'Ab\u0007c' })).s === 400);
      ok('POST com predial no corpo -> 400 (impossível criar outro predial)', (await call('POST', '/setores', adm, { nome: 'Outro Predial', predial: true })).s === 400);

      // ---- Equipamentos do setor (o texto `setor` é derivado por trigger) ----
      const eq = await prisma.equipamento.create({ data: { codigo: 'F22-USI-01', nome: 'Centro de usinagem', setor: 'ignorado', setorId: BigInt(usi), status: 'ATIVO' } });
      const eqPred = await prisma.equipamento.upsert({
        where: { codigo: 'PREDIAL' }, update: { status: 'ATIVO' },
        create: { codigo: 'PREDIAL', nome: 'Manutenção Predial / Geral', setor: 'Outros', predial: true, status: 'ATIVO' },
      });
      ok('Trigger: equipamentos.setor deriva de setores.nome', (await prisma.equipamento.findUniqueOrThrow({ where: { id: eq.id } })).setor === 'Usinagem');
      let falhou = false;
      try { await prisma.equipamento.create({ data: { codigo: 'F22-ERR', nome: 'x', setor: 'x', setorId: eqPred.setorId!, predial: false } }); } catch { falhou = true; }
      ok('Trigger: equipamento comum no setor predial é recusado', falhou);

      // ---- 2. Renomear ----
      r = await call('PUT', `/setores/${usi}`, adm, { nome: 'Usinagem CNC' });
      ok('PUT renomear -> 200', r.s === 200 && r.b.nome === 'Usinagem CNC' && r.b.equipamentos === 1 && r.b.podeExcluir === false && r.b.motivoNaoExclui === 'SETOR_COM_VINCULOS');
      ok('Renomear propaga equipamentos.setor', (await prisma.equipamento.findUniqueOrThrow({ where: { id: eq.id } })).setor === 'Usinagem CNC');
      ok('GET /equipamentos?setor=<novo nome> encontra o equipamento', (await call('GET', '/equipamentos?setor=Usinagem%20CNC', oper)).b.length === 1);
      ok('GET /equipamentos?setorId= filtra', (await call('GET', `/equipamentos?setorId=${usi}`, oper)).b.length === 1);
      const ren = await audit('SETOR_ATUALIZADO');
      ok('Auditoria SETOR_ATUALIZADO com de/para', ren.length === 1 && (ren[0]!.detalhe as any)?.de === 'Usinagem' && (ren[0]!.detalhe as any)?.para === 'Usinagem CNC');
      ok('PUT duplicado -> 409 SETOR_DUPLICADO', (await call('PUT', `/setores/${usi}`, adm, { nome: 'outros' })).b?.error === 'SETOR_DUPLICADO');
      ok('PUT com predial -> 400', (await call('PUT', `/setores/${usi}`, adm, { predial: true })).s === 400);
      ok('PUT vazio -> 400', (await call('PUT', `/setores/${usi}`, adm, {})).s === 400);
      ok('PUT inexistente -> 404 SETOR_NAO_ENCONTRADO', (await call('PUT', '/setores/999999', adm, { nome: 'Qualquer' })).b?.error === 'SETOR_NAO_ENCONTRADO');

      // ---- Totem: /equipamentos/setores ----
      r = await call('GET', '/equipamentos/setores', oper);
      const lista = r.b as any[];
      const ult = lista[lista.length - 1];
      ok('Totem: lista inclui o setor novo com id', r.s === 200 && lista.some((s) => s.setor === 'Usinagem CNC' && s.id === usi && s.predial === false && s.equipamentos === 1));
      ok('Totem: predial por último, com locais ativos em ordem', ult.predial === true && Array.isArray(ult.locais) && ult.locais.length >= 6 && ult.locais[0].nome === 'Administração');
      ok('Totem: setor de produção não traz `locais`', lista.filter((s) => !s.predial).every((s) => s.locais === undefined));

      // ---- 3. Desativar ----
      r = await call('PUT', `/setores/${usi}`, adm, { ativo: false });
      ok('Desativar -> 200', r.s === 200 && r.b.ativo === false && r.b.avisos === undefined);
      ok('Auditoria SETOR_DESATIVADO', (await audit('SETOR_DESATIVADO')).length === 1);
      ok('Setor inativo some de /equipamentos/setores', !(await call('GET', '/equipamentos/setores', oper)).b.some((s: any) => s.id === usi));
      ok('Setor inativo permanece em /setores/opcoes', (await call('GET', '/setores/opcoes', ger)).b.some((s: any) => s.id === usi && s.ativo === false));
      ok('Fase 31 (B4): setor inativo não esconde mais a máquina do Totem', (await call('GET', '/equipamentos?setor=Usinagem%20CNC', oper)).b.length === 1);
      ok('Gerente ainda lista equipamentos do setor inativo', (await call('GET', '/equipamentos?setor=Usinagem%20CNC', ger)).b.length === 1);
      r = await abrir(oper, ordemBody(eq.id));
      ok('Fase 31 (B4): POST /ordens em setor inativo -> 201 (SETOR_INATIVO não é mais emitido)', r.s === 201, JSON.stringify(r.b).slice(0, 120));
      r = await call('GET', `/equipamentos/${eq.id}`, oper);
      ok('GET /equipamentos/:ref devolve setorAtivo=false', r.s === 200 && r.b.setorAtivo === false);
      ok('GET /setores?ativo=false lista o setor', (await call('GET', '/setores?ativo=false', adm)).b.some((s: any) => s.id === usi));
      ok('GET /setores?ativo=true não lista o setor', !(await call('GET', '/setores?ativo=true', adm)).b.some((s: any) => s.id === usi));
      r = await call('PUT', `/setores/${usi}`, adm, { ativo: true });
      ok('Reativar -> 200 e auditoria SETOR_ATIVADO', r.s === 200 && r.b.ativo === true && (await audit('SETOR_ATIVADO')).length === 1);
      r = await abrir(oper, ordemBody(eq.id));
      ok('Reativado: POST /ordens -> 201', r.s === 201);
      const omAberta = r.b.id as string;

      // OM já aberta continua o fluxo com o setor desativado
      await call('PUT', `/setores/${usi}`, adm, { ativo: false });
      ok('OM já aberta segue visível/atendível com setor inativo', (await call('GET', `/ordens/${omAberta}`, ger)).s === 200);
      r = await call('GET', '/setores', adm);
      const itUsi = r.b.find((s: any) => s.id === usi);
      ok('Contagens: equipamentos, omsAbertas e omsTotal', itUsi.equipamentos === 1 && itUsi.equipamentosAtivos === 1 && itUsi.omsAbertas === 2 && itUsi.omsTotal === 2);
      ok('GET /setores: X-Total-Count e ordenação (predial por último)', r.h['x-total-count'] === String(r.b.length) && r.b[r.b.length - 1].predial === true);
      ok('GET /setores?busca= filtra por nome', (await call('GET', '/setores?busca=usinagem', adm)).b.length === 1);
      await call('PUT', `/setores/${usi}`, adm, { ativo: true });

      // ---- 4. Excluir ----
      r = await call('DELETE', `/setores/${usi}`, adm);
      ok('DELETE com equipamentos -> 409 SETOR_COM_VINCULOS (+ contagens e sugestão)', r.s === 409 && r.b.error === 'SETOR_COM_VINCULOS' && r.b.equipamentos === 1 && r.b.omsTotal === 2 && r.b.sugestao === 'DESATIVAR');
      let fk = false;
      try { await prisma.$executeRaw`DELETE FROM setores WHERE id = ${BigInt(usi)}`; } catch { fk = true; }
      ok('DELETE direto no banco também falha (FK RESTRICT)', fk);
      const vazio = (await prisma.setor.create({ data: { nome: 'Setor Vazio' }, select: { id: true } })).id.toString();
      ok('DELETE setor vazio -> 204', (await call('DELETE', `/setores/${vazio}`, adm)).s === 204);
      const exc = await audit('SETOR_EXCLUIDO');
      ok('Auditoria SETOR_EXCLUIDO com nome', exc.length === 1 && (exc[0]!.detalhe as any)?.nome === 'Setor Vazio');
      ok('DELETE inexistente -> 404 SETOR_NAO_ENCONTRADO', (await call('DELETE', `/setores/${vazio}`, adm)).b?.error === 'SETOR_NAO_ENCONTRADO');

      // ---- 6/7/8. Setor predial ----
      const predial = (await call('GET', '/setores', adm)).b.find((s: any) => s.predial);
      ok('Predial: motivoNaoExclui SETOR_PROTEGIDO e contagem de locais', predial.podeExcluir === false && predial.motivoNaoExclui === 'SETOR_PROTEGIDO' && predial.locais >= 6);
      r = await call('DELETE', `/setores/${predial.id}`, adm);
      ok('DELETE do predial -> 409 SETOR_PROTEGIDO', r.s === 409 && r.b.error === 'SETOR_PROTEGIDO');
      let t1 = false, t2 = false, t3 = false;
      try { await prisma.$executeRaw`DELETE FROM setores WHERE predial`; } catch { t1 = true; }
      try { await prisma.$executeRaw`UPDATE setores SET predial = FALSE WHERE predial`; } catch { t2 = true; }
      try { await prisma.$executeRaw`INSERT INTO setores (nome, predial) VALUES ('Segundo Predial', TRUE)`; } catch { t3 = true; }
      ok('Triggers/índices impedem excluir, destipar ou duplicar o predial por SQL', t1 && t2 && t3);

      r = await call('PUT', `/setores/${predial.id}`, adm, { nome: 'Predial / Geral' });
      ok('Renomear predial -> 200', r.s === 200 && r.b.nome === 'Predial / Geral' && r.b.predial === true);
      ok('Pseudo-ativo PREDIAL segue predial e ganha o novo texto', (await prisma.equipamento.findUniqueOrThrow({ where: { id: eqPred.id } })).setor === 'Predial / Geral');
      const tot = (await call('GET', '/equipamentos/setores', oper)).b as any[];
      ok('Totem exibe o novo nome como último card', tot[tot.length - 1].setor === 'Predial / Geral' && tot[tot.length - 1].predial === true);

      r = await call('PUT', `/setores/${predial.id}`, adm, { ativo: false });
      ok('Desativar predial -> 200 com avisos PREDIAL_INDISPONIVEL_NO_TOTEM', r.s === 200 && r.b.avisos?.[0] === 'PREDIAL_INDISPONIVEL_NO_TOTEM');
      ok('Predial inativo some do Totem', !(await call('GET', '/equipamentos/setores', oper)).b.some((s: any) => s.predial));
      r = await abrir(lider, ordemBody(eqPred.id, { categoria: 'CIVIL_PREDIAL', tipoAtivo: 'OUTRO', tipoAtivoOutro: 'Predial', localDescricao: 'RH' }));
      ok('Fase 31 (B4): TAG PREDIAL com setor inativo -> 201', r.s === 201, JSON.stringify(r.b).slice(0, 120));
      await call('PUT', `/setores/${predial.id}`, adm, { ativo: true });
      r = await abrir(lider, ordemBody(eqPred.id, { categoria: 'CIVIL_PREDIAL', tipoAtivo: 'OUTRO', tipoAtivoOutro: 'Predial', localDescricao: 'RH' }));
      ok('Predial reativado: abertura de OM com local -> 201', r.s === 201 && r.b.localDescricao === 'RH');

      // ---- 9. Locais padrão ----
      const base = `/setores/${predial.id}/locais`;
      r = await call('GET', base, adm);
      ok('GET locais: seeds ordenados', r.s === 200 && r.b.length >= 6 && r.b[0].nome === 'Administração' && r.b[0].ativo === true);
      ok('Setor de produção: locais -> 422 SETOR_SEM_LOCAIS', (await call('GET', `/setores/${usi}/locais`, adm)).b?.error === 'SETOR_SEM_LOCAIS');
      ok('Setor de produção: POST local -> 422', (await call('POST', `/setores/${usi}/locais`, adm, { nome: 'X' })).s === 422);
      ok('Setor inexistente: locais -> 404', (await call('GET', '/setores/999999/locais', adm)).b?.error === 'SETOR_NAO_ENCONTRADO');
      r = await call('POST', base, adm, { nome: '  Almoxarifado ' });
      ok('POST local -> 201', r.s === 201 && r.b.nome === 'Almoxarifado' && r.b.ativo === true);
      const alm = r.b.id as string;
      ok('POST local duplicado (caixa) -> 409 LOCAL_DUPLICADO', (await call('POST', base, adm, { nome: 'almoxarifado' })).b?.error === 'LOCAL_DUPLICADO');
      ok('POST local vazio -> 400', (await call('POST', base, adm, { nome: '   ' })).s === 400);
      ok('POST local > 60 -> 400', (await call('POST', base, adm, { nome: 'A'.repeat(61) })).s === 400);
      ok('Auditoria SETOR_LOCAL_CRIADO', (await audit('SETOR_LOCAL_CRIADO')).length === 1);
      ok('Chip novo aparece no Totem sem reiniciar', (await call('GET', '/equipamentos/setores', oper)).b.find((s: any) => s.predial).locais.some((l: any) => l.nome === 'Almoxarifado'));

      r = await call('PUT', `${base}/${alm}`, adm, { nome: 'Almox' });
      ok('PUT local renomear -> 200', r.s === 200 && r.b.nome === 'Almox');
      const aud = await audit('SETOR_LOCAL_ATUALIZADO');
      ok('Auditoria SETOR_LOCAL_ATUALIZADO com de/para', aud.length === 1 && (aud[0]!.detalhe as any)?.de === 'Almoxarifado' && (aud[0]!.detalhe as any)?.para === 'Almox');
      ok('PUT local duplicado -> 409', (await call('PUT', `${base}/${alm}`, adm, { nome: 'RH' })).b?.error === 'LOCAL_DUPLICADO');
      ok('PUT local inexistente -> 404 LOCAL_NAO_ENCONTRADO', (await call('PUT', `${base}/999999`, adm, { ativo: false })).b?.error === 'LOCAL_NAO_ENCONTRADO');
      await call('PUT', `${base}/${alm}`, adm, { ativo: false });
      ok('Local desativado some dos chips do Totem', !(await call('GET', '/equipamentos/setores', oper)).b.find((s: any) => s.predial).locais.some((l: any) => l.nome === 'Almox'));
      ok('Local desativado segue na listagem admin', (await call('GET', base, adm)).b.some((l: any) => l.id === alm && l.ativo === false));

      // Reordenar
      const ids = (await call('GET', base, adm)).b.map((l: any) => l.id) as string[];
      const invertido = [...ids].reverse();
      ok('PUT ordem -> 204', (await call('PUT', `${base}/ordem`, adm, { ids: invertido })).s === 204);
      ok('Ordem persistida na sequência enviada', ((await call('GET', base, adm)).b.map((l: any) => l.id) as string[]).join() === invertido.join());
      ok('PUT ordem incompleta -> 400', (await call('PUT', `${base}/ordem`, adm, { ids: ids.slice(1) })).s === 400);
      ok('PUT ordem com repetição -> 400', (await call('PUT', `${base}/ordem`, adm, { ids: [...ids.slice(1), ids[1]!] })).s === 400);
      ok('Auditoria SETOR_LOCAIS_REORDENADOS', (await audit('SETOR_LOCAIS_REORDENADOS')).length === 1);

      // OM aberta mantém o texto do local mesmo após excluir o local
      ok('DELETE local -> 204', (await call('DELETE', `${base}/${alm}`, adm)).s === 204);
      ok('DELETE local inexistente -> 404', (await call('DELETE', `${base}/${alm}`, adm)).b?.error === 'LOCAL_NAO_ENCONTRADO');
      ok('Auditoria SETOR_LOCAL_EXCLUIDO', (await audit('SETOR_LOCAL_EXCLUIDO')).length === 1);
      const rh = (await call('GET', base, adm)).b.find((l: any) => l.nome === 'RH');
      await call('DELETE', `${base}/${rh.id}`, adm);
      const omRh = await prisma.ordem.findFirst({ where: { localDescricao: 'RH' } });
      ok('OM já aberta mantém o texto do local excluído', omRh?.localDescricao === 'RH');
      await prisma.$executeRaw`INSERT INTO setor_locais (setor_id, nome, ordem) VALUES (${BigInt(predial.id)}, 'RH', 2) ON CONFLICT DO NOTHING`;

      // Local fora do setor predial por SQL
      let sql = false;
      try { await prisma.$executeRaw`INSERT INTO setor_locais (setor_id, nome) VALUES (${BigInt(usi)}, 'Indevido')`; } catch { sql = true; }
      ok('Trigger: local em setor não predial é recusado por SQL', sql);

      // Config pública: contador de setores de produção ativos com equipamento ativo
      const { invalidarConfigPublica } = await import('../../src/routes/publico.js');
      invalidarConfigPublica();
      await call('PUT', `/setores/${usi}`, adm, { ativo: true });
      const cfg1 = (await app.inject({ method: 'GET', url: '/config/publica' })).json().setoresCount as number;
      await call('PUT', `/setores/${usi}`, adm, { ativo: false });
      invalidarConfigPublica();
      const cfg2 = (await app.inject({ method: 'GET', url: '/config/publica' })).json().setoresCount as number;
      ok('setoresCount ignora setor desativado', cfg1 - cfg2 === 1);
    } finally {
      await limpar();
      await A.fechar();
    }
  });
});
