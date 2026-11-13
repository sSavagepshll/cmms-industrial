import PDFDocument from 'pdfkit';
import type { FichaSnapshotV1 } from './schema.js';

/**
 * Fase 35 (§3.5): renderiza a Ficha de Manutenção (Formulário: APX-081) a partir do snapshot. PURA: sem banco, sem relógio, sem rede.
 * Fase 37: FOLHA ÚNICA (5 linhas de horas e 4 de materiais). Só há página 2 em transbordo real (teto: 4 páginas). Texto simples apenas: nada interpreta HTML.
 * Fidelidade ESTRUTURAL e TEXTUAL ao formulário físico (blocos, rótulos e ordem); não é pixel-idêntico ao FichaOm.tsx.
 */
export const FORMULARIO = 'Formulário: APX-081';
const MAX_PAGINAS = 4;
const ML = 24; // margem lateral e superior
const LARGURA = 595.28 - ML * 2;
const BAIXO = 800; // limite inferior do conteúdo (rodapé abaixo)
export const LINHAS_HORAS_P1 = 5; // Fase 37 (RN-90): apontamentos na página 1
export const LINHAS_MATERIAIS_P1 = 4; // Fase 37 (RN-90): materiais na página 1
/** Altura da página 1 cheia (5 horas + 4 materiais + legenda), somada dos blocos; o teste exige ALTURA_P1_CHEIA + ML <= BAIXO - 36. */
export const ALTURA_P1_CHEIA = 721;
export const LIMITE_BAIXO = BAIXO;
export const MARGEM = ML;

/** Política de capacidade da página 1 (RN-90). Página 2 só existe se houver excedente real. */
export function planejarPaginas(nApont: number, nMat: number): { cabeUmaPagina: boolean; horasP1: number; horasP2: number; matP1: number; matP2: number } {
  const horasP1 = Math.min(nApont, LINHAS_HORAS_P1);
  const horasP2 = nApont - horasP1;
  const matP1 = horasP2 > 0 ? 0 : Math.min(nMat, LINHAS_MATERIAIS_P1);
  return { cabeUmaPagina: nApont <= LINHAS_HORAS_P1 && nMat <= LINHAS_MATERIAIS_P1, horasP1, horasP2, matP1, matP2: nMat - matP1 };
}

// Helvetica embutida = WinAnsi. Mapeia o que a tela usa e troca o resto por '?'. Nunca lança.
const SUBST: Record<string, string> = { '✕': 'X', '✎': '*', '▶': '>', '→': '->', '←': '<-', '‑': '-', ' ': ' ' };
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));
export function texto(v: string | null | undefined): string {
  let out = '';
  for (const ch of (v ?? '').normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\n') out += '\n';
    else if (cp < 0x20 || cp === 0x7f) out += ' ';
    else if (SUBST[ch] !== undefined) out += SUBST[ch];
    else if (cp <= 0xff || WINANSI_EXTRA.has(ch)) out += ch;
    else out += '?';
  }
  return out;
}

export interface OpcoesPdf { tz?: string }

export function renderFichaPdf(s: FichaSnapshotV1, op: OpcoesPdf = {}): Promise<Buffer> {
  const tz = op.tz ?? 'America/Sao_Paulo';
  const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const fDia = (iso: string) => dia.format(new Date(iso));
  const fHora = (iso: string) => hora.format(new Date(iso));
  const fDH = (iso?: string | null) => (iso ? `${fDia(iso)} ${fHora(iso)}` : '');
  const horasDec = (seg: number) => (Math.round((seg / 3600) * 100) / 100).toFixed(2).replace('.', ',');
  const seg = (a: { inicio: string; fim: string | null }) => (a.fim ? Math.max(0, (Date.parse(a.fim) - Date.parse(a.inicio)) / 1000) : 0);

  return new Promise<Buffer>((resolve, reject) => {
    const geradoEm = new Date(s.geradoEm);
    const doc = new PDFDocument({
      size: 'A4', margins: { top: ML, left: ML, right: ML, bottom: 0 }, bufferPages: true, autoFirstPage: true,
      info: {
        Title: texto(`Ficha de Manutenção ${s.om.numeroFormatado}`), Author: 'Apex Industrial Technologies', Subject: FORMULARIO,
        CreationDate: geradoEm, ModDate: geradoEm,
      },
    });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    try {
      let paginas = 1;
      const cinza = '#475569';
      const linha = '#94a3b8';

      const caixa = (x: number, y: number, w: number, h: number, fundo?: string) => {
        if (fundo) doc.save().rect(x, y, w, h).fill(fundo).restore();
        doc.save().lineWidth(0.7).strokeColor(linha).rect(x, y, w, h).stroke().restore();
      };
      const campo = (x: number, y: number, w: number, h: number, rotulo: string, valor: string, tam = 10) => {
        caixa(x, y, w, h);
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(cinza).text(texto(rotulo).toUpperCase(), x + 4, y + 3, { width: w - 8, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(tam).fillColor('#0f172a').text(texto(valor), x + 4, y + 13, { width: w - 8, height: h - 15, ellipsis: true });
      };
      const marca = (x: number, y: number, on: boolean, rotulo: string) => {
        doc.save().lineWidth(1).strokeColor('#334155').rect(x, y, 10, 10).stroke().restore();
        if (on) doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('X', x + 2.2, y + 1.4, { lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e293b').text(texto(rotulo), x + 15, y + 1.5, { width: 120, lineBreak: false, ellipsis: true });
      };
      const titulo = (y: number, t: string) => {
        caixa(ML, y, LARGURA, 14, '#f1f5f9');
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e293b').text(texto(t).toUpperCase(), ML, y + 3.5, { width: LARGURA, align: 'center', lineBreak: false });
        return y + 14;
      };

      /** Tabela com cabeçalho; continua em página extra (teto MAX_PAGINAS). Devolve o y final. */
      const tabela = (
        y0: number, cols: { t: string; w: number; al?: 'left' | 'right' | 'center' }[], dados: string[][], minLinhas: number, altura: number,
      ): number => {
        const cab = (y: number) => {
          let x = ML;
          for (const c of cols) {
            caixa(x, y, c.w, 14, '#f8fafc');
            doc.font('Helvetica-Bold').fontSize(7).fillColor('#334155').text(texto(c.t).toUpperCase(), x + 2, y + 4, { width: c.w - 4, align: 'center', lineBreak: false });
            x += c.w;
          }
          return y + 14;
        };
        let y = cab(y0);
        const total = Math.max(dados.length, minLinhas);
        for (let i = 0; i < total; i++) {
          if (y + altura > BAIXO) {
            if (paginas >= MAX_PAGINAS) {
              doc.font('Helvetica-Oblique').fontSize(8).fillColor(cinza).text(`... mais ${total - i} linha(s) no sistema`, ML, Math.min(y + 4, BAIXO), { width: LARGURA, lineBreak: false });
              return y + 14;
            }
            doc.addPage(); paginas++;
            y = cab(ML);
          }
          let x = ML;
          const linhaDados = dados[i] ?? [];
          cols.forEach((c, k) => {
            caixa(x, y, c.w, altura);
            const v = linhaDados[k];
            if (v) doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a').text(texto(v), x + 3, y + (altura - 8.5) / 2 - 0.5, { width: c.w - 6, height: altura - 4, align: c.al ?? 'left', lineBreak: false, ellipsis: true });
            x += c.w;
          });
          y += altura;
        }
        return y;
      };

      // ---------------- PÁGINA 1 (folha única) ----------------
      let y = ML;
      caixa(ML, y, 150, 34);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f4c81').text('MANUTENÇÃO', ML + 8, y + 11, { width: 134, lineBreak: false });
      caixa(ML + 150, y, LARGURA - 150, 34);
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a').text('APEX INDUSTRIAL', ML + 150, y + 10, { width: LARGURA - 150, align: 'center', lineBreak: false });
      y += 34;
      caixa(ML, y, LARGURA * 0.62, 24);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e293b').text('ORDEM DE MANUTENÇÃO (OM)', ML + 6, y + 8, { width: LARGURA * 0.62 - 12, lineBreak: false });
      caixa(ML + LARGURA * 0.62, y, LARGURA * 0.38, 24);
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#b45309').text(texto(s.om.numeroFormatado), ML + LARGURA * 0.62, y + 5, { width: LARGURA * 0.38, align: 'center', lineBreak: false });
      y += 24;

      // tipo de ativo + identificação do equipamento (62)
      const wTipo = 150;
      caixa(ML, y, wTipo, 62);
      const ta = s.om.tipoAtivo;
      marca(ML + 8, y + 5, ta === 'MOLDE', 'Molde');
      marca(ML + 8, y + 21, ta === 'MAQUINA', 'Máquina');
      const outroOn = ta === 'OUTRO' || ta === 'ROBO';
      marca(ML + 8, y + 37, outroOn, outroOn ? (s.om.tipoAtivoRotulo ?? 'Outro') : '');
      if (!outroOn) doc.save().lineWidth(0.7).strokeColor('#334155').moveTo(ML + 23, y + 47).lineTo(ML + 100, y + 47).stroke().restore();
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1e293b').text(`C. CUSTO: ${texto(s.centroCusto)}`, ML + 8, y + 52, { width: wTipo - 12, lineBreak: false, ellipsis: true });
      caixa(ML + wTipo, y, LARGURA - wTipo, 62);
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(cinza).text('IDENTIFICAÇÃO DO EQUIPAMENTO', ML + wTipo + 4, y + 3, { lineBreak: false });
      const ident = s.om.itemDescricao ?? s.equipamento.nome;
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text(texto(ident), ML + wTipo + 4, y + 13, { width: LARGURA - wTipo - 8, height: 30, ellipsis: true });
      const sub = s.om.itemDescricao ? 'Item não cadastrado' : `${s.equipamento.codigo} · ${s.equipamento.setorExibicao}`;
      doc.font('Helvetica').fontSize(9).fillColor('#334155').text(texto(sub), ML + wTipo + 4, y + 47, { width: LARGURA - wTipo - 8, height: 12, ellipsis: true, lineBreak: false });
      y += 62;

      caixa(ML, y, LARGURA, 20);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(cinza).text('CUSTO:', ML + 8, y + 6, { lineBreak: false });
      marca(ML + 55, y + 5, s.custoTipo === 'INTERNO', 'Interno');
      marca(ML + 160, y + 5, s.custoTipo === 'CLIENTE', 'Cliente');
      y += 20;

      const servicos = s.om.descricao || s.om.sintomas.join(', ') || s.om.titulo;
      campo(ML, y, LARGURA, 72, 'Serviços a executar', servicos, 9);
      y += 72;

      const w4 = LARGURA / 4;
      const executouEm = s.tipoDocumento === 'FICHA_FINAL' ? s.apontamentos.filter((a) => a.fim).map((a) => a.fim as string).sort().at(-1) : undefined;
      campo(ML, y, w4, 30, 'Solicitante · Data / Hora', fDH(s.om.dataAbertura), 8.5);
      campo(ML + w4, y, w4, 30, 'Solicitante · Visto', s.solicitante.nome, 8.5);
      campo(ML + w4 * 2, y, w4, 30, 'Executante · Data / Hora', fDH(executouEm), 8.5);
      campo(ML + w4 * 3, y, w4, 30, 'Executante · Visto', s.responsavel?.nome ?? '', 8.5);
      y += 30;
      campo(ML, y, LARGURA / 2, 30, 'Aprovado por · Data / Hora', s.aprovadoPor ? `${s.aprovadoPor.nome} · ${fDH(s.aprovadoPor.data)}` : '', 8.5);
      campo(ML + LARGURA / 2, y, LARGURA / 2, 30, 'Concluído por · Data / Hora', s.concluidoPor ? `${s.concluidoPor.nome} · ${fDH(s.concluidoPor.data)}` : '', 8.5);
      y += 30;

      const NUM4 = [['01'], ['02'], ['03'], ['04']];
      const w7 = [28, 70, 80, 120, 80, 80, LARGURA - 458];
      y = tabela(y + 6, ['Nº', 'Teste S/N', 'Data / Hora', 'Programação', 'Aprovado S/N', 'Data / Hora', 'Ciente executante'].map((t, i) => ({ t, w: w7[i]! })),
        NUM4, 4, 14);
      y = titulo(y, 'Teste (Produção) Resp.');
      y = tabela(y, ['Nº', 'Data / Hora', 'Recebido', 'Início', 'Final', 'Tempo total (H)', 'Devolvido'].map((t, i) => ({ t, w: w7[i]! })),
        NUM4, 4, 14); // linhas em branco como no papel; só o número (01..04) vem preenchido

      const obsY = y + 6;
      caixa(ML, obsY, LARGURA * 0.66, 48);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(cinza).text('OBS.:', ML + 4, obsY + 4, { lineBreak: false });
      caixa(ML + LARGURA * 0.66, obsY, LARGURA * 0.34, 48);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(cinza).text('USO INTERNO', ML + LARGURA * 0.66 + 4, obsY + 4, { lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(FORMULARIO, ML + LARGURA * 0.66 + 4, obsY + 36, { lineBreak: false });
      y = obsY + 48;

      // ---------------- horas e materiais (RN-90: capacidade 5/4; página 2 só com excedente real) ----------------
      const aps = s.apontamentos.map((a) => [
        fDia(a.inicio), fHora(a.inicio), a.fim ? fHora(a.fim) : '> em andamento', `${a.manual ? '* ' : ''}${a.observacao ?? ''}`, a.fim ? horasDec(seg(a)) : '',
      ]);
      const mats = s.materiais.map((m) => [m.quantidade.replace('.', ','), m.unidade, m.descricao, m.flagInterno ? 'X' : '', m.confNf ? 'X' : '']);
      const plano = planejarPaginas(aps.length, mats.length);
      const wH = [80, 60, 80, LARGURA - 300, 80];
      const colsH = ['Data', 'Início', 'Término', 'Observações (cód)', 'Tempo total (H)'].map((t, i) => ({ t, w: wH[i]!, ...(i === 4 && { al: 'right' as const }) }));
      const wM = [60, 60, LARGURA - 200, 40, 40];
      const colsM = ['Qde', 'Unidade', 'Descrição', 'Inter.', 'Conf. N.F.'].map((t, i) => ({ t, w: wM[i]!, ...(i >= 3 && { al: 'center' as const }) }));
      const novaPagina = () => { doc.addPage(); paginas++; return ML; };

      let yv = titulo(y + 6, 'Horas trabalhadas');
      yv = tabela(yv, colsH, aps.slice(0, plano.horasP1), LINHAS_HORAS_P1, 17);
      if (plano.horasP2 > 0 && paginas < MAX_PAGINAS) {
        doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(cinza).text('continua na página 2', ML, yv + 3, { width: LARGURA, align: 'right', lineBreak: false });
        yv = titulo(novaPagina(), 'Horas trabalhadas (continuação)');
        yv = tabela(yv, colsH, aps.slice(plano.horasP1), 0, 17);
      }
      const totalSeg = s.apontamentos.reduce((t, a) => t + seg(a), 0);
      if (yv + 18 > BAIXO) { yv = paginas < MAX_PAGINAS ? novaPagina() : BAIXO - 18; } // o total sempre cabe
      caixa(ML, yv, LARGURA - 80, 18, '#f8fafc');
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e293b').text('TOTAL GERAL', ML, yv + 5, { width: LARGURA - 88, align: 'right', lineBreak: false });
      caixa(ML + LARGURA - 80, yv, 80, 18);
      if (s.apontamentos.length) doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(horasDec(totalSeg), ML + LARGURA - 80, yv + 4, { width: 76, align: 'right', lineBreak: false });
      yv += 18;
      if (yv + 10 <= BAIXO) doc.font('Helvetica').fontSize(7).fillColor('#64748b').text('* = lançamento manual. Início e término de cada lançamento (I = início, T = término no formulário físico).', ML, yv + 2, { width: LARGURA, lineBreak: false });
      yv += 10;

      if (plano.horasP2 > 0) {
        // materiais inteiros na página 2 (página 1 já foi encerrada)
        if (mats.length) {
          if (yv + 6 + 14 + 17 > BAIXO && paginas < MAX_PAGINAS) yv = novaPagina() - 6;
          tabela(yv + 6, colsM, mats, 0, 17);
        }
      } else {
        const fimP1 = tabela(yv + 6, colsM, mats.slice(0, plano.matP1), LINHAS_MATERIAIS_P1, 17);
        if (plano.matP2 > 0 && paginas < MAX_PAGINAS) {
          void fimP1;
          const yc = titulo(novaPagina(), 'Materiais (continuação)');
          tabela(yc, colsM, mats.slice(plano.matP1), 0, 17);
        }
      }

      // ---------------- rodapé em todas as páginas ----------------
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.font('Helvetica').fontSize(8).fillColor('#64748b')
          .text(`${FORMULARIO}  ·  ${texto(s.om.numeroFormatado)}${s.tipoDocumento === 'FICHA_FINAL' ? '  ·  versão final' : '  ·  dados da abertura'}`, ML, 812, { width: LARGURA - 80, lineBreak: false });
        doc.text(`Página ${i + 1}/${range.count}`, ML + LARGURA - 80, 812, { width: 80, align: 'right', lineBreak: false });
      }
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
