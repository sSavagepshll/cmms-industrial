import type { FastifyBaseLogger } from 'fastify';
import type { Tx } from '../db.js';
import type { TipoDocumento } from '../mail/catalogo.js';
import { setorExibicao } from '../setorExibicao.js';
import { tipoAtivoRotulo } from '../tipoAtivo.js';
import { TAMANHO_MAX_SNAPSHOT, type FichaSnapshotV1 } from './schema.js';

// Mesmo separador de routes/ordens.ts (SEP_SINTOMAS); duplicado de propósito para não criar import circular com as rotas.
const SEP_SINTOMAS = '; ';
const corta = (v: string | null | undefined, max: number): string => (v ?? '').slice(0, max);
const cortaN = (v: string | null | undefined, max: number): string | null => (v == null ? null : v.slice(0, max));
const tamanho = (s: FichaSnapshotV1) => Buffer.byteLength(JSON.stringify(s), 'utf8');

/**
 * Fase 35 (§3.2): lê a OM e monta o snapshot da ficha. SOMENTE LEITURA, usa o `tx` do chamador (enxerga o UPDATE ainda não
 * commitado do evento). Tetos: 200 apontamentos, 100 materiais, strings truncadas, JSON ≤ 64 KB. Excedeu: trunca e registra
 * `ficha_snapshot_truncado`; nunca derruba a ação de negócio.
 */
export async function montarFichaSnapshot(
  db: Tx, ordemId: bigint, tipoDocumento: TipoDocumento, log?: FastifyBaseLogger,
): Promise<FichaSnapshotV1> {
  const [om, apontamentos, materiais] = await Promise.all([
    db.ordem.findUnique({
      where: { id: ordemId },
      select: {
        numeroFormatado: true, titulo: true, descricao: true, sintomas: true, prioridade: true, categoria: true, dataAbertura: true,
        localDescricao: true, itemDescricao: true, tipoAtivo: true, tipoAtivoOutro: true, custoTipo: true, centroCusto: true,
        dataAprovacao: true, concluidoEm: true,
        equipamento: { select: { codigo: true, nome: true, setor: true, predial: true, itemLivre: true } },
        solicitante: { select: { nome: true } },
        responsavel: { select: { nome: true } },
        aprovador: { select: { nome: true } },
        concluidor: { select: { nome: true } },
      },
    }),
    db.omApontamentoTempo.findMany({
      where: { ordemId, deletadoEm: null }, orderBy: [{ inicio: 'asc' }, { id: 'asc' }], take: 200,
      select: { inicio: true, fim: true, origem: true, justificativa: true },
    }),
    db.omMaterialUtilizado.findMany({
      where: { ordemId }, orderBy: { id: 'asc' }, take: 100,
      select: { quantidade: true, unidade: true, descricao: true, flagInterno: true, confNf: true },
    }),
  ]);
  if (!om) throw new Error(`ficha: OM ${ordemId} inexistente`);

  const final = tipoDocumento === 'FICHA_FINAL';
  const snap: FichaSnapshotV1 = {
    versao: 1,
    tipoDocumento,
    geradoEm: new Date().toISOString(),
    om: {
      numeroFormatado: corta(om.numeroFormatado, 30),
      titulo: corta(om.titulo, 200),
      descricao: corta(om.descricao, 2000),
      sintomas: om.sintomas ? om.sintomas.split(SEP_SINTOMAS).slice(0, 20).map((s) => corta(s, 200)) : [],
      prioridade: corta(om.prioridade, 20),
      categoria: corta(om.categoria, 60),
      dataAbertura: om.dataAbertura.toISOString(),
      localDescricao: cortaN(om.localDescricao, 200),
      itemDescricao: cortaN(om.itemDescricao, 200),
      tipoAtivo: cortaN(om.tipoAtivo, 20),
      tipoAtivoRotulo: cortaN(tipoAtivoRotulo(om.tipoAtivo, om.tipoAtivoOutro), 60),
    },
    equipamento: {
      codigo: corta(om.equipamento.codigo, 60),
      nome: corta(om.equipamento.nome, 200),
      setorExibicao: corta(setorExibicao({ equipamento: om.equipamento, localDescricao: om.localDescricao }), 300),
    },
    solicitante: { nome: corta(om.solicitante.nome, 200) },
    responsavel: om.responsavel ? { nome: corta(om.responsavel.nome, 200) } : null,
    aprovadoPor: om.aprovador ? { nome: corta(om.aprovador.nome, 200), data: om.dataAprovacao?.toISOString() ?? null } : null,
    concluidoPor: final && om.concluidor ? { nome: corta(om.concluidor.nome, 200), data: om.concluidoEm?.toISOString() ?? null } : null,
    custoTipo: final ? om.custoTipo : null,
    centroCusto: final ? cortaN(om.centroCusto, 60) : null,
    apontamentos: apontamentos.map((a) => ({
      inicio: a.inicio.toISOString(),
      fim: a.fim?.toISOString() ?? null,
      observacao: cortaN(a.justificativa, 200),
      manual: a.origem === 'RETROATIVO',
    })),
    materiais: materiais.map((m) => ({
      quantidade: m.quantidade.toString().slice(0, 30), unidade: corta(m.unidade, 10), descricao: corta(m.descricao, 200),
      flagInterno: m.flagInterno, confNf: cortaN(m.confNf, 50),
    })),
  };

  // Teto de 64 KB (CHECK do banco): reduz os campos mais volumosos até caber. Nunca lança.
  if (tamanho(snap) > TAMANHO_MAX_SNAPSHOT) {
    const antes = tamanho(snap);
    snap.om.descricao = corta(snap.om.descricao, 500);
    for (const a of snap.apontamentos) a.observacao = cortaN(a.observacao, 60);
    for (const m of snap.materiais) m.descricao = corta(m.descricao, 80);
    while (tamanho(snap) > TAMANHO_MAX_SNAPSHOT && (snap.apontamentos.length > 20 || snap.materiais.length > 20)) {
      snap.apontamentos.length = Math.max(20, Math.floor(snap.apontamentos.length * 0.75));
      snap.materiais.length = Math.max(20, Math.floor(snap.materiais.length * 0.75));
    }
    log?.warn({ evento: 'ficha_snapshot_truncado', ordemId: ordemId.toString(), bytesAntes: antes, bytesDepois: tamanho(snap) });
  }
  return snap;
}

/** Grava o snapshot (único por OM e tipo; reexecução reaproveita o existente) e devolve o id para `outbox_email.anexo_id`. */
export async function gravarAnexo(db: Tx, ordemId: bigint, snapshot: FichaSnapshotV1): Promise<bigint> {
  await db.$executeRaw`
    INSERT INTO outbox_anexo (ordem_id, tipo_documento, snapshot_versao, snapshot)
    VALUES (${ordemId}, ${snapshot.tipoDocumento}, ${snapshot.versao}::smallint, ${JSON.stringify(snapshot)}::jsonb)
    ON CONFLICT (ordem_id, tipo_documento) DO NOTHING`;
  const r = await db.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM outbox_anexo WHERE ordem_id = ${ordemId} AND tipo_documento = ${snapshot.tipoDocumento}`;
  if (!r[0]) throw new Error('ficha: anexo não gravado');
  return r[0].id;
}
