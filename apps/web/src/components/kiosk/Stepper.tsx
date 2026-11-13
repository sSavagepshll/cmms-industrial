import { Icone } from "../ui/Icones";

export type PassoTotem = 1 | 2 | 3 | 4 | 5;
export const PASSOS_TOTEM = ["Login", "Ação", "Equipamento", "Detalhes", "Sucesso"] as const;

// Longa só com largura >= 640 e altura > 800 (em `short`, 1366x768, a compacta poupa altura do teclado e dos botões).
const LONGA = "[@media(min-width:640px)_and_(min-height:801px)]";

/**
 * Progresso da abertura de chamado no Totem (docs/ui/primitivos-e-stepper-totem.md §5). Não interativo (nenhum ponto é botão/link),
 * sem estado próprio: o passo é uma constante de cada tela. `compacto` força a versão de 1 linha (telas com teclado virtual).
 * `concluido` marca os 5 passos como feitos (tela de sucesso).
 */
export function StepperTotem({ passo, compacto = false, concluido = false }: { passo: PassoTotem; compacto?: boolean; concluido?: boolean }) {
  const atual = PASSOS_TOTEM[passo - 1];
  return (
    <nav aria-label="Progresso do chamado" className="print:hidden">
      {/* Compacta: "Passo 3 de 5 · Equipamento" + 5 segmentos */}
      <div role="img" aria-label={concluido ? "Passo 5 de 5: Sucesso, concluído" : `Passo ${passo} de 5: ${atual}`}
        className={`flex flex-col gap-1 ${compacto ? "" : `${LONGA}:hidden`}`}>
        <p aria-hidden className="text-body font-semibold text-muted">Passo {passo} de 5 · <span className="text-fg">{atual}</span></p>
        <div aria-hidden className="grid grid-cols-5 gap-1">
          {PASSOS_TOTEM.map((n, i) => (
            <span key={n} className={`h-1.5 rounded-full transition-colors duration-(--duration-media) motion-reduce:transition-none ${i < passo || concluido ? "bg-primary-fg" : "bg-line-soft"}`} />
          ))}
        </div>
      </div>

      {/* Longa: 5 pontos com rótulos */}
      {!compacto && (
        <ol className={`hidden grid-cols-5 ${LONGA}:grid`}>
          {PASSOS_TOTEM.map((nome, i) => {
            const n = i + 1;
            const feito = concluido || n < passo, ehAtual = !concluido && n === passo;
            return (
              <li key={nome} aria-current={ehAtual ? "step" : undefined} className="relative flex flex-col items-center gap-0.5 leading-tight">
                {i > 0 && <span aria-hidden className={`absolute left-0 right-1/2 top-[0.4375rem] h-0.5 transition-colors duration-(--duration-media) motion-reduce:transition-none ${n <= passo || concluido ? "bg-primary-fg" : "bg-line-soft"}`} />}
                {i < 4 && <span aria-hidden className={`absolute left-1/2 right-0 top-[0.4375rem] h-0.5 transition-colors duration-(--duration-media) motion-reduce:transition-none ${n < passo || concluido ? "bg-primary-fg" : "bg-line-soft"}`} />}
                <span aria-hidden className={`relative z-10 grid h-4 w-4 place-items-center rounded-full ${
                  feito ? "bg-primary text-primary-on" : ehAtual ? "bg-primary ring-[3px] ring-primary-fg" : "bg-ink ring-2 ring-line"}`}>
                  {feito && <Icone nome="check" className="h-3 w-3" />}
                </span>
                <span className={`text-lead ${ehAtual ? "font-extrabold text-fg" : feito ? "font-semibold text-fg" : "text-muted"}`}>{nome}</span>
                <span className="sr-only">{feito ? "concluído" : ehAtual ? "passo atual" : "pendente"}</span>
              </li>
            );
          })}
        </ol>
      )}
    </nav>
  );
}
