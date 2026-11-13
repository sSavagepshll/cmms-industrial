"use client";
import Link from "next/link";
import { Brand, BrandStripe } from "../Brand";
import { BotaoTemaTotem } from "../ui/TemaToggle";

// Atalhos de serviço para /tecnico e /admin. Padrão: DESLIGADO (produção). Ligados só em desenvolvimento,
// via NEXT_PUBLIC_ATALHOS_PAINEL=true (apps/web/.env.development: o Next só carrega esse arquivo no `next dev`).
const ATALHOS = process.env.NEXT_PUBLIC_ATALHOS_PAINEL === "true";

// docs/ux/fase17-revisao-atalhos-totem.md + diretriz mais recente do Designer: alvo de luva (80px em ≥ md), alto contraste (preenchido brand-950, texto branco).
const atalho =
  "inline-flex min-h-14 md:min-h-tap-md items-center justify-center gap-3 rounded-2xl bg-strong px-6 text-xl md:text-2xl font-bold text-strong-on shadow-md ring-2 ring-primary-edge transition-transform active:scale-[0.97] active:bg-brand-800";

const IconChave = () => (
  <svg aria-hidden viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />
  </svg>
);
/** Tela de repouso do totem: o logotipo é o herói; um único alvo gigante (a tela inteira) inicia o chamado. */
export function StepIdle({ onStart, notice, aoAlternarTema }: { onStart: () => void; notice?: string; aoAlternarTema?: (efetivo: "light" | "dark") => boolean }) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-ink" suppressHydrationWarning>
      {/* Tema: só aqui (não no meio do fluxo do operador). Fora do <button> da tela: botão dentro de botão é inválido. */}
      <div className="absolute right-4 top-4 z-10"><BotaoTemaTotem aoAlternar={aoAlternarTema} /></div>
      <button type="button" onClick={onStart} aria-label="Toque para iniciar: abrir chamado de manutenção" suppressHydrationWarning className="flex w-full flex-1 flex-col touch-manipulation text-center">
        <span className="flex flex-col bg-panel shadow-sm">
          <span className="flex justify-center px-6 py-10 md:py-16 short:py-6">
            <Brand className="h-12 sm:h-20 lg:h-28 short:h-16" placa="lg" />
          </span>
          <BrandStripe />
        </span>

        <span className="flex flex-1 flex-col items-center justify-center gap-6 p-6 md:gap-8 md:p-8 short:gap-4 short:p-4">
          <span className="text-xl font-semibold uppercase tracking-widest text-muted md:text-3xl short:text-xl">Ordens de Manutenção</span>
          {notice && <span role="status" className="rounded-xl bg-amber-500 px-4 py-3 text-lg font-semibold text-black md:px-6 md:text-2xl">{notice}</span>}
          <span className="flex min-h-24 w-full max-w-3xl items-center justify-center rounded-3xl bg-brand-600 px-8 text-3xl font-extrabold text-white shadow-lg ring-4 ring-primary-edge sm:text-5xl md:min-h-tap-lg lg:text-6xl short:min-h-20 short:text-4xl">
            Toque para iniciar
          </span>
          <span className="text-xl text-muted md:text-3xl short:text-xl">Abrir chamado de manutenção</span>
          <span className="text-lg text-muted md:text-2xl short:text-base">Tenha sua <strong className="text-fg">matrícula</strong> e seu <strong className="text-fg">PIN</strong> à mão</span>
        </span>
      </button>

      {/* Fora do <button> (links dentro de botão são inválidos e acionariam o "iniciar"). Largura = área útil do CTA (p-6 / md:p-8) para alinhar as bordas. */}
      {ATALHOS && (
        <nav aria-label="Acesso da equipe de manutenção" className="mx-auto w-[calc(100%-3rem)] max-w-3xl border-t border-line/40 dark:border-line-soft px-0 pb-8 pt-6 md:w-[calc(100%-4rem)]">
          <p className="mb-4 text-center text-xl font-semibold uppercase tracking-widest text-muted">Equipe de manutenção</p>
          <div className="flex justify-center">
            <Link href="/tecnico" aria-label="Abrir painel do técnico" className={`${atalho} w-full max-w-sm`}>
              <IconChave /> Técnico
            </Link>
          </div>
        </nav>
      )}
    </div>
  );
}
