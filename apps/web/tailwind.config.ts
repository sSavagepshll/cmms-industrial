import type { Config } from "tailwindcss";

/**
 * Tema corporativo - Apex Industrial Technologies, claro e escuro (docs/ux/fase17-tema-escuro.md).
 * Cores extraídas do logotipo (public/logo-apex.svg, amostragem de pixels):
 *   azul  #1438A3  (marca "R") -> escala `brand` (600 = cor exata no claro)
 *   vermelho #CF2426 (nome)    -> `accent` (só identidade: filete/realce; NUNCA para erro/parada)
 * Tailwind v4: carregado por `@config` em src/app/globals.css.
 *
 * As cores que mudam com o tema NÃO têm hex aqui: apontam para variáveis CSS definidas em globals.css
 * (:root = claro; :root[data-theme="dark"] = escuro). Só `paper` (placa do logotipo / ficha impressa),
 * `accent` e os sólidos de estado (danger/ok/warn DEFAULT) são iguais nos dois temas.
 * Estado nunca só por cor: sempre ícone/texto/aro ao lado. Vermelho de perigo = danger, distinto do `accent`.
 */
const v = (nome: string) => `var(--${nome})`;
const brand = Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, v(`color-brand-${n}`)]));

const config = {
  theme: {
    extend: {
      colors: {
        brand,
        accent: { DEFAULT: v("c-accent"), dark: "#a81b1d" }, // vermelho do logotipo (só identidade); #e5383b no escuro

        // Superfícies, texto e linhas (3 níveis de elevação por luminosidade: ink < panel < panel-2).
        ink: v("c-ink"), // fundo da página
        panel: v("c-panel"), // cartões, tabelas
        "panel-2": v("c-panel-2"), // modais, menus, drawer
        line: v("c-line"), // contorno de controles (>= 3:1)
        "line-soft": v("c-line-soft"), // divisores decorativos
        fg: v("c-fg"), // texto principal
        muted: v("c-muted"), // texto secundário
        paper: "#ffffff", // placa do logo e ficha impressa: SEMPRE branco nos dois temas
        scrim: v("c-scrim"), // fundo de modal

        primary: {
          DEFAULT: v("c-primary"), on: v("c-on-primary"), edge: v("c-primary-edge"),
          fg: v("c-primary-fg"), soft: v("c-primary-soft"), "soft-fg": v("c-primary-soft-fg"),
        },
        strong: { DEFAULT: v("c-strong"), on: v("c-on-strong") },
        danger: { DEFAULT: "#b91c1c", fg: v("c-danger-fg"), soft: v("c-danger-soft"), "soft-fg": v("c-danger-soft-fg") },
        ok: { DEFAULT: "#15803d", fg: v("c-ok-fg"), soft: v("c-ok-soft"), "soft-fg": v("c-ok-soft-fg") },
        warn: { DEFAULT: "#f59e0b", fg: v("c-warn-fg"), soft: v("c-warn-soft"), "soft-fg": v("c-warn-soft-fg") },
        info: { soft: v("c-info-soft"), "soft-fg": v("c-info-soft-fg") },
        // gráficos (paleta categórica 1..8, rampa ordinal ord-1..4, trilho, grade): ver globals.css e docs/ux/fase17-dashboard-paleta.md
        viz: {
          1: v("viz-1"), 2: v("viz-2"), 3: v("viz-3"), 4: v("viz-4"), 5: v("viz-5"), 6: v("viz-6"), 7: v("viz-7"), 8: v("viz-8"),
          "ord-1": v("viz-ord-1"), "ord-2": v("viz-ord-2"), "ord-3": v("viz-ord-3"), "ord-4": v("viz-ord-4"),
          track: v("viz-track"), grid: v("viz-grid"), axis: v("viz-axis"), "warn-mark": v("viz-warn-mark"),
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '"Segoe UI"', "Roboto", "sans-serif"],
      },
    },
  },
} satisfies Config;

export default config;
