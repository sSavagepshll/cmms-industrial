import type { NextConfig } from "next";

/**
 * Origens (hosts, sem porta) autorizadas a carregar os recursos de desenvolvimento (`next dev`) quando o web é aberto por outro
 * computador da rede. Sem isso o Next bloqueia /_next/* de origem cruzada e a página renderiza, mas NÃO hidrata (botões sem clique).
 * Acrescente outros IPs/hosts em DEV_ORIGINS (separados por vírgula). Não afeta `next build`/`next start`.
 */
const extras = (process.env.DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' http: https: ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Fase 36 / RN-83 (camada L1): sem o indicador de desenvolvimento do Next (bolinha "N") no `next dev`. Reiniciar o `next dev` após mudar.
  // Camada L2: regra CSS em globals.css (o indicador vive no Shadow DOM de <nextjs-portal>). Em `next start` nada disso existe.
  devIndicators: false,
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*", "*.local", ...extras],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
