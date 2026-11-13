import { z } from 'zod';

/**
 * Fase 35 (§3.2): snapshot JSONB da ficha, gravado NA transação do evento (outbox_anexo). É a única fonte do PDF.
 * Somente nomes de exibição: sem matrícula, PIN, hash, e-mail, token ou segredo (mesmo conteúdo da ficha impressa).
 */
const txt = (max: number) => z.string().max(max);
const iso = z.string().max(40);

export const apontamentoSnap = z.object({
  inicio: iso, fim: iso.nullable(), observacao: txt(200).nullable(), manual: z.boolean(),
}).strict();

export const materialSnap = z.object({
  quantidade: txt(30), unidade: txt(10), descricao: txt(200), flagInterno: z.boolean(), confNf: txt(50).nullable(),
}).strict();

export const fichaSnapshotV1 = z.object({
  versao: z.literal(1),
  tipoDocumento: z.enum(['FICHA_INICIAL', 'FICHA_FINAL']),
  geradoEm: iso,
  om: z.object({
    numeroFormatado: txt(30), titulo: txt(200), descricao: txt(2000), sintomas: z.array(txt(200)).max(20),
    prioridade: txt(20), categoria: txt(60), dataAbertura: iso, localDescricao: txt(200).nullable(),
    itemDescricao: txt(200).nullable(), tipoAtivo: txt(20).nullable(), tipoAtivoRotulo: txt(60).nullable(),
  }).strict(),
  equipamento: z.object({ codigo: txt(60), nome: txt(200), setorExibicao: txt(300) }).strict(),
  solicitante: z.object({ nome: txt(200) }).strict(),
  responsavel: z.object({ nome: txt(200) }).strict().nullable(),
  aprovadoPor: z.object({ nome: txt(200), data: iso.nullable() }).strict().nullable(),
  concluidoPor: z.object({ nome: txt(200), data: iso.nullable() }).strict().nullable(),
  custoTipo: z.enum(['INTERNO', 'CLIENTE']).nullable(),
  centroCusto: txt(60).nullable(),
  apontamentos: z.array(apontamentoSnap).max(200),
  materiais: z.array(materialSnap).max(100),
}).strict();

export type FichaSnapshotV1 = z.infer<typeof fichaSnapshotV1>;
export const TAMANHO_MAX_SNAPSHOT = 65_536;
