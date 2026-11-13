import type { ReactNode } from "react";
import { BrandBar } from "../Brand";
import { Dialogo } from "../ui/Dialogo";
import { StepperTotem, type PassoTotem } from "./Stepper";

// Alvos de toque FLUIDOS (Fase 33 / US-18): os tokens min-h-tap-* escalam com a altura útil (56 -> 96 px), então valem em celular,
// tablet, notebook 1366x768 e Totem 1080x1920 sem saltos de breakpoint. Gap entre alvos >= 8 px (Totem >= 12).
/** @deprecated Use `<Botao tamanho="toque">` (ui/Botao). Mantido até o QA aprovar a migração (Fase 34). */
export const btnBase = "min-h-tap-md rounded-card px-4 md:px-6 text-xl md:text-2xl font-bold transition-transform";
/** @deprecated Use `<Botao tamanho="totem">` (ui/Botao). Mantido até o QA aprovar a migração (Fase 34). */
export const btnPrimary = "min-h-tap-lg rounded-card px-5 md:px-8 text-2xl md:text-3xl font-extrabold transition-transform";
// Teclas do VirtualKeyboard/NumericKeypad NÃO migram para Botao (layout próprio por container queries, já homologado).
export const keyBase = "min-h-tap-sm min-w-0 md:min-w-[72px] rounded-xl text-2xl md:text-3xl font-bold select-none";

/**
 * Moldura de toda tela do Totem. `passo` (1..5) exibe o StepperTotem acima do título; sem `passo` (Aprovar OM, ver OM existente,
 * portal do técnico) não há stepper. `passoCompacto`: versão de 1 linha para telas com teclado virtual.
 */
export function Screen({ title, subtitle, children, onBack, right, passo, passoCompacto, selo }: {
  title: string; subtitle?: string; children: ReactNode; onBack?: () => void; right?: ReactNode; passo?: PassoTotem; passoCompacto?: boolean; selo?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
    <BrandBar />
    <main className="mx-auto flex w-full flex-1 max-w-6xl flex-col gap-3 p-4 md:gap-5 md:p-6 tall:max-w-[56rem] short:gap-2 short:p-3">
      {passo && <div className="-mb-1 md:-mb-2"><StepperTotem passo={passo} compacto={passoCompacto} /></div>}
      <header className="flex items-center gap-3 md:gap-4">
        {onBack && (
          <button onClick={onBack} aria-label="Voltar"
            className="min-h-tap-sm min-w-tap-sm rounded-card bg-panel text-3xl md:text-4xl font-bold ring-1 ring-line">←</button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-title font-extrabold leading-tight short:text-2xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-lead text-muted short:text-base">{subtitle}</p>}
          {selo}
        </div>
        {right}
      </header>
      {children}
    </main>
    </div>
  );
}

/** Setor do equipamento em destaque (Fase 36): uma linha, forte, com contraste AA nos dois temas. */
export function SeloSetor({ texto }: { texto: string }) {
  if (!texto) return null;
  return <p title={`Setor: ${texto}`} className="mt-1 truncate text-xl font-extrabold text-primary-fg short:text-lg">Setor: {texto}</p>;
}

/**
 * Alias fino do `Dialogo` unificado (Fase 34): mesmo contrato (foco preso, bottom sheet < 640, rodapé fixo, `--vvh`), variante Totem,
 * tom de alerta e `alertdialog`. `label` vira o aria-label; o cabeçalho visível é o do próprio conteúdo (como antes), e não há Esc
 * nem clique no fundo (`travado`): o modal só sai por uma de suas ações.
 */
export function Modal({ children, label, rodape }: { children: ReactNode; label: string; rodape?: ReactNode }) {
  return (
    <Dialogo titulo={label} onFechar={() => {}} travado variante="totem" tom="alerta" papel="alertdialog" semCabecalho largura="max-w-2xl" rodape={rodape}>
      {children}
    </Dialogo>
  );
}

/**
 * Teclado virtual ancorado na base do viewport (RN-64): o conteúdo rola por cima, a ação principal (`acao`, ex.: "Continuar")
 * fica logo acima do teclado e o teclado nunca passa de 45 % da altura. Use como último filho de `Screen`.
 */
export function DockTeclado({ acao, children }: { acao?: ReactNode; children: ReactNode }) {
  return (
    <div className="safe-b sticky bottom-0 z-10 -mx-4 mt-auto flex flex-col gap-2 border-t border-line/40 bg-ink px-4 pt-2 md:-mx-6 md:px-6">
      {acao}
      <div className="max-h-[45dvh] overflow-y-auto overscroll-contain">{children}</div>
    </div>
  );
}
