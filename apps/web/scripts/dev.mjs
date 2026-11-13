// Sobe o `next dev` em HTTPS quando o par de certificados existe; senão em HTTP (comportamento anterior).
// Caminhos: CERT_KEY_PATH / CERT_CERT_PATH (padrão /certs/key.pem e /certs/cert.pem, montados no container) ou ../../certs/ (execução local).
// Com HTTPS, o Next roda em porta interna (loopback) e a porta pública é um multiplexer: TLS é repassado, HTTP em texto claro é redirecionado.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { fileURLToPath } from "node:url";

const aqui = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const candidatos = [
  [process.env.CERT_KEY_PATH ?? "/certs/key.pem", process.env.CERT_CERT_PATH ?? "/certs/cert.pem"],
  [aqui("../../../certs/key.pem"), aqui("../../../certs/cert.pem")],
];
const par = candidatos.find(([k, c]) => existsSync(k) && existsSync(c));

const PORTA = Number(process.env.PORT ?? 3000); // porta pública (mapeada no compose)
const PORTA_INTERNA = Number(process.env.INTERNAL_PORT ?? 3001); // Next em HTTPS, só em loopback, quando há certificados

const args = ["dev", "-H", par ? "127.0.0.1" : "0.0.0.0", "-p", String(par ? PORTA_INTERNA : PORTA)];
if (par) {
  args.push("--experimental-https", "--experimental-https-key", par[0], "--experimental-https-cert", par[1]);
  console.log(`[dev] HTTPS ativo (key=${par[0]}, cert=${par[1]}); Next em 127.0.0.1:${PORTA_INTERNA}, porta pública ${PORTA} com redirecionamento HTTP->HTTPS`);
} else {
  console.log("[dev] certificados não encontrados: iniciando em HTTP");
}

const CRLF = "\r\n";
const HOST_OK = /^[A-Za-z0-9.\-[\]:]+$/;

/**
 * Multiplexer da porta pública: o 1º byte da conexão decide. 0x16 (22) = handshake TLS: repassa os bytes (inclui o WebSocket
 * do HMR) ao Next interno; qualquer outro = HTTP em texto claro: responde 307 para https://<host><url> em vez de derrubar a conexão.
 */
function iniciarMultiplexer() {
  const srv = net.createServer((cli) => {
    cli.on("error", () => cli.destroy());
    cli.once("data", (primeiro) => {
      if (primeiro[0] === 22) {
        const up = net.connect(PORTA_INTERNA, "127.0.0.1");
        up.on("error", () => cli.destroy());
        cli.on("close", () => up.destroy());
        up.write(primeiro);
        cli.pipe(up);
        up.pipe(cli);
        return;
      }
      let buf = primeiro;
      const responder = () => {
        const cab = buf.toString("latin1");
        const alvo = cab.split(CRLF, 1)[0].split(" ")[1];
        const url = alvo && alvo.startsWith("/") ? alvo : "/";
        const host = /^host:[ \t]*([^\r\n]+)/im.exec(cab)?.[1]?.trim();
        if (!host || !HOST_OK.test(host)) { cli.end(`HTTP/1.1 400 Bad Request${CRLF}Connection: close${CRLF}${CRLF}`); return; }
        cli.end(`HTTP/1.1 307 Temporary Redirect${CRLF}Location: https://${host}${url}${CRLF}Content-Length: 0${CRLF}Connection: close${CRLF}${CRLF}`);
      };
      const completo = () => buf.includes(CRLF + CRLF) || buf.length > 8192;
      if (completo()) { responder(); return; }
      cli.on("data", (d) => { buf = Buffer.concat([buf, d]); if (completo()) { cli.removeAllListeners("data"); responder(); } });
    });
  });
  srv.listen(PORTA, "0.0.0.0", () => console.log(`[dev] multiplexer ouvindo em 0.0.0.0:${PORTA}`));
}

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const filho = spawn(process.execPath, [next, ...args], { stdio: "inherit" });
if (par) iniciarMultiplexer();
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => filho.kill(s));
filho.on("exit", (code) => process.exit(code ?? 0));
