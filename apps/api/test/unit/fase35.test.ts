import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ALTURA_P1_CHEIA, LIMITE_BAIXO, MARGEM, planejarPaginas, renderFichaPdf, texto } from '../../src/ficha/pdf.js';
import { fichaSnapshotV1, type FichaSnapshotV1 } from '../../src/ficha/schema.js';
import { setorExibicao } from '../../src/setorExibicao.js';
import { ANEXO_POR_TIPO, EMAIL_TIPOS_VITAIS, ehTipoVital } from '../../src/mail/catalogo.js';
import { derivarTipoAtivo } from '../../src/tipoAtivo.js';

/** Extrai o texto de um PDF do pdfkit (streams Flate; Helvetica grava strings hexadecimais WinAnsi). */
function textoDoPdf(buf: Buffer): string {
  const raw = buf.toString('latin1');
  let out = '';
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let conteudo: string;
    try { conteudo = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1'); } catch { conteudo = m[1]!; }
    for (const h of conteudo.matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1]!, 'hex').toString('latin1');
    out += '\n';
  }
  return out;
}

const snap = (final: boolean, extra: Partial<FichaSnapshotV1> = {}): FichaSnapshotV1 => ({
  versao: 1, tipoDocumento: final ? 'FICHA_FINAL' : 'FICHA_INICIAL', geradoEm: '2026-11-05T12:00:00.000Z',
  om: { numeroFormatado: 'OM-2026-000123', titulo: 't', descricao: 'Vazamento na prensa ✕ 😀', sintomas: ['Vazamento'], prioridade: 'CRITICA', categoria: 'MECANICO',
    dataAbertura: '2026-11-05T10:00:00.000Z', localDescricao: null, itemDescricao: null, tipoAtivo: 'MAQUINA', tipoAtivoRotulo: 'Máquina' },
  equipamento: { codigo: 'INJ-01', nome: 'Prensa 03', setorExibicao: 'Injeção' },
  solicitante: { nome: 'Operador Teste' },
  responsavel: final ? { nome: 'Tecnico Teste' } : null,
  aprovadoPor: final ? { nome: 'Lider Teste', data: '2026-11-05T13:00:00.000Z' } : null,
  concluidoPor: final ? { nome: 'Gerente Teste', data: '2026-11-05T14:00:00.000Z' } : null,
  custoTipo: final ? 'INTERNO' : null, centroCusto: null,
  apontamentos: final ? [{ inicio: '2026-11-05T10:30:00.000Z', fim: '2026-11-05T11:30:00.000Z', observacao: 'Troca de vedação', manual: false }] : [],
  materiais: final ? [{ quantidade: '2', unidade: 'UN', descricao: 'Vedação', flagInterno: true, confNf: null }] : [],
  ...extra,
});

describe('Fase 35: catálogo vital', () => {
  it('tem exatamente 4 tipos e o PDF só na abertura e na conclusão', () => {
    expect([...EMAIL_TIPOS_VITAIS]).toEqual(['OM_ABERTURA', 'OM_FINALIZADA_TECNICO', 'OM_APROVADA_SOLICITANTE', 'OM_CONCLUIDA_GESTOR']);
    expect(ANEXO_POR_TIPO.OM_ABERTURA).toBe('FICHA_INICIAL');
    expect(ANEXO_POR_TIPO.OM_CONCLUIDA_GESTOR).toBe('FICHA_FINAL');
    expect(ANEXO_POR_TIPO.OM_FINALIZADA_TECNICO).toBeNull();
    expect(ANEXO_POR_TIPO.OM_APROVADA_SOLICITANTE).toBeNull();
    for (const t of ['OM_CRIADA', 'OM_ATRIBUIDA', 'OM_RESERVADA', 'OM_RECUSADA', 'OM_LIBERADA', 'RESERVA_AVISO', 'RESERVA_EXPIRADA']) expect(ehTipoVital(t)).toBe(false);
  });
});

describe('Fase 35: setorExibicao e tipo de ativo', () => {
  it('predial mostra o local, item avulso tem rótulo próprio, demais usam o setor do equipamento', () => {
    expect(setorExibicao({ equipamento: { setor: 'Geral', predial: true }, localDescricao: 'RH' })).toBe('Predial · Local: RH');
    expect(setorExibicao({ equipamento: { setor: 'Outros', predial: true }, localDescricao: null })).toBe('Predial');
    expect(setorExibicao({ equipamento: { setor: 'Geral', itemLivre: true } })).toBe('Item avulso');
    expect(setorExibicao({ equipamento: { setor: 'Injeção' }, localDescricao: 'ignorado' })).toBe('Injeção');
  });
  it('MOLDES -> MOLDE; PREDIAL_OUTROS -> OUTRO/Outros; predial vence o grupo', () => {
    expect(derivarTipoAtivo({ predial: false }, 'MOLDES')).toEqual({ tipoAtivo: 'MOLDE', tipoAtivoOutro: null });
    expect(derivarTipoAtivo({ predial: false }, 'PREDIAL_OUTROS')).toEqual({ tipoAtivo: 'OUTRO', tipoAtivoOutro: 'Outros' });
    expect(derivarTipoAtivo({ predial: true }, 'PREDIAL_OUTROS')).toEqual({ tipoAtivo: 'OUTRO', tipoAtivoOutro: 'Predial' });
  });
});

describe('Fase 35: PDF da ficha (APX-081)', () => {
  it('snapshot de exemplo respeita o schema estrito', () => {
    expect(fichaSnapshotV1.safeParse(snap(true)).success).toBe(true);
    expect(fichaSnapshotV1.safeParse({ ...snap(true), matricula: '123' }).success).toBe(false);
  });
  it('ficha inicial: %PDF, folha única (1 página), rótulos do formulário, sem 086 nem norma', async () => {
    const buf = await renderFichaPdf(snap(false));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
    const t = textoDoPdf(buf);
    for (const r of ['Formulário: APX-081', 'OM-2026-000123', 'ORDEM DE MANUTENÇÃO', 'SERVIÇOS A EXECUTAR', 'HORAS TRABALHADAS', 'TOTAL GERAL', 'Operador Teste', 'Injeção']) {
      expect(t, r).toContain(r);
    }
    expect(t).toContain('dados da abertura');
    expect(t).not.toContain('086');
    expect(t.toLowerCase()).not.toContain('norma');
    expect(t).not.toContain('Tecnico Teste'); // a abertura não mostra executor
  });
  it('ficha final: aprovado/concluído por, horas e materiais', async () => {
    const t = textoDoPdf(await renderFichaPdf(snap(true)));
    for (const r of ['Lider Teste', 'Gerente Teste', 'Tecnico Teste', 'Troca de vedação', '1,00', 'Vedação', 'versão final']) expect(t, r).toContain(r);
  });
  it('muitos apontamentos continuam em páginas extras (teto de 4) sem lançar', async () => {
    const aps = Array.from({ length: 120 }, (_, i) => ({ inicio: '2026-11-05T10:00:00.000Z', fim: '2026-11-05T10:10:00.000Z', observacao: `l${i}`, manual: i % 2 === 0 }));
    const buf = await renderFichaPdf(snap(true, { apontamentos: aps }));
    expect((buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeLessThanOrEqual(4);
  });
  it('texto(): mapeia ✕/▶ e troca o que o WinAnsi não cobre, sem lançar', () => {
    expect(texto('a ✕ ▶ 😀 é')).toBe('a X > ? é');
    expect(texto('x\u0007y')).toBe('x y');
  });
});

describe('Fase 37: ficha em folha única (RN-89/RN-90)', () => {
  const paginas = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
  const aps = (n: number) => Array.from({ length: n }, (_, i) => ({ inicio: '2026-11-05T10:00:00.000Z', fim: '2026-11-05T10:10:00.000Z', observacao: `l${i}`, manual: false }));
  const mats = (n: number) => Array.from({ length: n }, (_, i) => ({ quantidade: '1', unidade: 'UN', descricao: `Mat ${i}`, flagInterno: true, confNf: null }));
  it('planejarPaginas: política 5/4', () => {
    expect(planejarPaginas(5, 4)).toMatchObject({ cabeUmaPagina: true, horasP2: 0, matP2: 0 });
    expect(planejarPaginas(6, 0)).toMatchObject({ cabeUmaPagina: false, horasP1: 5, horasP2: 1, matP1: 0 });
    expect(planejarPaginas(5, 5)).toMatchObject({ cabeUmaPagina: false, matP1: 4, matP2: 1 });
  });
  it('a página 1 cheia cabe na geometria com folga de 36 pt', () => {
    expect(ALTURA_P1_CHEIA + MARGEM).toBeLessThanOrEqual(LIMITE_BAIXO - 36);
  });
  it('casos de página: 1, 1, 1, 2, 2, 2', async () => {
    const caso = async (a: number, m: number) => paginas(await renderFichaPdf(snap(true, { apontamentos: aps(a), materiais: mats(m) })));
    expect(await caso(2, 1)).toBe(1);
    expect(await caso(5, 4)).toBe(1);
    expect(await caso(0, 0)).toBe(1);
    expect(await caso(8, 6)).toBe(2);
    expect(await caso(6, 0)).toBe(2);
    expect(await caso(5, 5)).toBe(2);
  });
  it('rodapé com Página i/N real e continuação', async () => {
    expect(textoDoPdf(await renderFichaPdf(snap(true)))).toContain('1/1');
    const dois = textoDoPdf(await renderFichaPdf(snap(true, { apontamentos: aps(8) })));
    for (const x of ['1/2', '2/2', 'CONTINUAÇÃO', 'TOTAL GERAL']) expect(dois, x).toContain(x);
  });
  it('ficha de abertura pesa menos de 50 KB', async () => {
    expect((await renderFichaPdf(snap(false))).length).toBeLessThan(50 * 1024);
  });
});

describe('Fase 35: teste de contrato da mensageria (§2.4-4)', () => {
  it('nenhum módulo em routes/ ou jobs/ importa enfileirarEmail ou mailer (exceto configuracoes.ts)', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const checarDir = (dir: string) => {
      const arquivos = readdirSync(dir, { withFileTypes: true });
      for (const a of arquivos) {
        const full = join(dir, a.name);
        if (a.isDirectory()) checarDir(full);
        else if (a.name.endsWith('.ts')) {
          const conteudo = readFileSync(full, 'utf-8');
          expect(conteudo, `enfileirarEmail em ${full}`).not.toContain('enfileirarEmail');
          if (/from\s+['"].*\/mailer(\.js)?['"]/.test(conteudo)) {
            expect(full.endsWith('configuracoes.ts'), `mailer importado indevidamente em ${full}`).toBe(true);
          }
        }
      }
    };
    checarDir(resolve(import.meta.dirname, '../../src/routes'));
    checarDir(resolve(import.meta.dirname, '../../src/jobs'));
  });
});
