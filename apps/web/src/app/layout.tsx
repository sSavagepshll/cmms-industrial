import type { Metadata, Viewport } from "next";
import { EMPRESA, SISTEMA } from "@/lib/brand";
import { SCRIPT_TEMA } from "@/lib/tema";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${EMPRESA} · ${SISTEMA}`, template: `%s · ${EMPRESA}` },
  description: `Sistema de ${SISTEMA.toLowerCase()} da ${EMPRESA}: abertura de chamados no totem e Kanban da manutenção.`,
  applicationName: `${EMPRESA} · ${SISTEMA}`,
  authors: [{ name: EMPRESA }],
  creator: EMPRESA,
  publisher: EMPRESA,
  robots: { index: false, follow: false }, // sistema interno
};

// Sem maximumScale/userScalable=false: o zoom por pinça fica liberado (acessibilidade em celular/tablet).
// O bloqueio de zoom por duplo toque do totem vem do CSS (touch-action) escopado em [data-app="kiosk"].
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // ativa env(safe-area-inset-*) em celulares com notch
  interactiveWidget: "resizes-content", // Android: o teclado nativo redimensiona o layout (alturas em dvh acompanham)
  // barra do navegador: claro #070f26, escuro #0a1226 (= ink escuro)
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#070f26" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1226" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: o script do <head> define data-theme antes da hidratação (evita piscar o tema errado)
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
