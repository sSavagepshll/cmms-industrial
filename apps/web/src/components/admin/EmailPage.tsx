"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, enviarEmailTeste, listarConfiguracoes, salvarConfiguracao } from "@/lib/api";
import { ehConfigEmail, ehVerdadeiro, mensagemErroConfig, temValor } from "@/lib/configuracoes";
import type { ConfiguracaoItem } from "@/lib/types";
import { CampoSecreto } from "../ui/CampoSecreto";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { btnPrim, btnSec, campo } from "../ui/estilos";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

type Resultado =
  | { tipo: "ok"; aceitos: string[]; resposta: string; quando: Date }
  | { tipo: "falha"; msg: string; quando: Date }
  | { tipo: "limite"; quando: Date };

/** Valida o valor digitado de uma chave (null = válido). A porta é gravada como texto no banco (tipo TEXTO). */
function validar(chave: string, v: string): string | null {
  const t = v.trim();
  if (chave === "SMTP_PORT" && t) {
    if (!/^\d{1,5}$/.test(t) || Number(t) < 1 || Number(t) > 65535) return "Informe uma porta entre 1 e 65535.";
  }
  return null;
}

/**
 * Aba E-mail (SMTP) do ADMIN. Usa as chaves que o back-end lê (SMTP_HOST/PORT/USER/PASS/FROM e EMAIL_ATIVO) e o
 * `POST /configuracoes/email/teste`, que envia com o SMTP JÁ GRAVADO: por isso, com alteração pendente, o botão
 * salva primeiro. Chaves que ainda não existem no banco aparecem desabilitadas (a API não cria parâmetros).
 */
export function EmailPage() {
  const [itens, setItens] = useState<ConfiguracaoItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [para, setPara] = useState("");
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const carregar = useCallback(() => {
    listarConfiguracoes()
      .then((l) => { setItens(l.filter(ehConfigEmail)); setErro(null); })
      .catch((e) => { if (e instanceof ApiError && e.status === 401) return; setItens((p) => p ?? []); setErro(mensagemErroConfig(e)); });
  }, []);
  useEffect(carregar, [carregar]);

  const por = useMemo(() => new Map((itens ?? []).map((c) => [c.chave, c])), [itens]);
  const sujo = Object.keys(edits).length > 0;
  const valor = (chave: string) => edits[chave] ?? (por.get(chave)?.tipo === "SECRETO" ? "" : por.get(chave)?.valor ?? "");

  function editar(chave: string, v: string) {
    const c = por.get(chave);
    if (!c) return;
    setAviso(null);
    setErros((p) => { const { [chave]: _, ...r } = p; return r; });
    setEdits((p) => {
      const { [chave]: _, ...resto } = p;
      const original = c.tipo === "SECRETO" ? "" : c.valor ?? "";
      const igual = c.tipo === "SECRETO" ? v === "" : c.tipo === "BOOLEANO" ? ehVerdadeiro(v) === ehVerdadeiro(original) : v.trim() === original.trim();
      return igual ? resto : { ...resto, [chave]: v };
    });
  }

  /** Grava só as chaves alteradas. Devolve true se tudo foi salvo. */
  async function salvar(): Promise<boolean> {
    const chaves = Object.keys(edits);
    if (chaves.length === 0) return true;
    const invalidos: Record<string, string> = {};
    for (const k of chaves) { const m = validar(k, edits[k]); if (m) invalidos[k] = m; }
    if (Object.keys(invalidos).length) { setErros((p) => ({ ...p, ...invalidos })); return false; }

    setSalvando(true); setAviso(null);
    const rs = await Promise.allSettled(chaves.map((k) => {
      const c = por.get(k)!;
      const bruto = edits[k];
      // SECRETO só chega aqui se foi digitado. Demais: vazio = limpar (null).
      const v = c.tipo === "SECRETO" ? bruto : c.tipo === "BOOLEANO" ? String(ehVerdadeiro(bruto)) : bruto.trim() === "" ? null : bruto.trim();
      return salvarConfiguracao(k, v);
    }));
    const salvos: ConfiguracaoItem[] = [];
    const novosErros: Record<string, string> = {};
    rs.forEach((r, i) => { if (r.status === "fulfilled") salvos.push(r.value); else novosErros[chaves[i]] = mensagemErroConfig(r.reason); });
    setItens((l) => l?.map((c) => salvos.find((s) => s.chave === c.chave) ?? c) ?? l);
    setEdits((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !salvos.some((s) => s.chave === k))));
    setErros((p) => ({ ...p, ...novosErros }));
    const falhas = Object.keys(novosErros).length;
    if (salvos.length && !falhas) setAviso("Configuração de e-mail salva.");
    else if (falhas) setAviso(null);
    setSalvando(false);
    return falhas === 0;
  }

  async function testar() {
    setResultado(null);
    if (sujo && !(await salvar())) return;
    setTestando(true);
    try {
      const r = await enviarEmailTeste(para.trim());
      setResultado(r.aceitos?.length
        ? { tipo: "ok", aceitos: r.aceitos, resposta: r.resposta, quando: new Date() }
        : { tipo: "falha", msg: `O servidor não aceitou o destinatário${r.rejeitados?.length ? ` (${r.rejeitados.join(", ")})` : ""}.`, quando: new Date() });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setResultado({ tipo: "limite", quando: new Date() });
      else setResultado({ tipo: "falha", msg: e instanceof ApiError ? (e.status === 0 ? "Sem conexão com o servidor." : e.message) : "Erro inesperado.", quando: new Date() });
    } finally { setTestando(false); }
  }

  const paraOk = EMAIL_RE.test(para.trim());
  const ocupado = salvando || testando;

  // Estado do envio (cabeçalho)
  const ativoRow = por.get("EMAIL_ATIVO");
  const ativo = ativoRow ? ehVerdadeiro(valor("EMAIL_ATIVO")) : true; // padrão do back-end: ativo
  const passRow = por.get("SMTP_PASS");
  const senhaDefinida = !!passRow && temValor(passRow); // SECRETO definido volta mascarado; não definido, nulo
  const completo = !!valor("SMTP_HOST").trim() && !!valor("SMTP_PORT").trim() && !!valor("SMTP_USER").trim() && (senhaDefinida || !!edits.SMTP_PASS);

  const ausente = (chave: string) => !!itens && !por.has(chave);
  const aviso404 = (chave: string, padrao: string) => (
    <span className="text-sm text-amber-900">Parâmetro <code className="rounded bg-brand-50 px-1">{chave}</code> ainda não existe no banco (padrão: {padrao}). Não dá para alterá-lo por aqui.</span>
  );

  // Função (não componente): um componente declarado aqui seria recriado a cada render e o campo perderia o foco a cada tecla.
  const campoTexto = ({ chave, rotulo, dica, tipo = "text", inputMode }: { chave: string; rotulo: string; dica?: string; tipo?: string; inputMode?: "numeric" | "email" }) => {
    const falta = ausente(chave);
    const alterado = chave in edits;
    const ring = erros[chave] ? "ring-danger-fg" : alterado ? "ring-amber-500" : "";
    return (
      <div key={chave} className="flex flex-col gap-1">
        <label htmlFor={`em-${chave}`} className="font-semibold">{rotulo}{alterado && <span aria-label="alterado" className="ml-1 text-amber-700">●</span>}</label>
        <input id={`em-${chave}`} type={tipo} inputMode={inputMode} value={valor(chave)} disabled={falta || !itens} onChange={(e) => editar(chave, e.target.value)}
          aria-invalid={!!erros[chave]} aria-describedby={`em-${chave}-dica`} className={`${campo} ${ring}`} />
        <span id={`em-${chave}-dica`} className={`text-sm ${erros[chave] ? "font-semibold text-red-800" : "text-muted"}`}>{erros[chave] ?? dica}</span>
      </div>
    );
  };

  return (
    <section aria-label="E-mail (SMTP)" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-extrabold">E-mail (SMTP)</h3>
          <p className="text-muted">Servidor usado para enviar os alertas do sistema. A senha é guardada cifrada e nunca é exibida.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {itens && (
            <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold ${!ativo ? "bg-amber-100 text-amber-900" : completo ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900"}`} role="status">
              <Icone nome={!ativo || !completo ? "alerta" : "check"} className="h-4 w-4" />
              {!ativo ? "Envio desativado" : completo ? "Ativo" : "Incompleto"}
            </span>
          )}
          {resultado && <span className="text-sm text-muted">Último teste nesta sessão: {resultado.tipo === "ok" ? "aceito" : resultado.tipo === "limite" ? "limite" : "falhou"} às {hora(resultado.quando)}</span>}
          <button onClick={carregar} disabled={ocupado} className={btnSec}><Icone nome="atualizar" />Recarregar</button>
        </div>
      </header>

      {erro && <Faixa tipo="erro">{erro}</Faixa>}
      {itens && !completo && ativo && <Faixa tipo="atencao">Faltam dados do servidor (host, porta, usuário ou senha): o sistema não consegue enviar e-mails.</Faixa>}
      {!itens && <p className="text-muted">Carregando…</p>}

      {itens && (
        <form onSubmit={(e) => { e.preventDefault(); void salvar(); }} className="flex flex-col gap-4 rounded-2xl bg-panel p-4 ring-1 ring-line md:p-5">
          <div className="flex flex-col gap-1">
            <label className="flex min-h-11 items-center gap-3 font-semibold">
              <input type="checkbox" checked={ativo} disabled={ausente("EMAIL_ATIVO")} onChange={(e) => editar("EMAIL_ATIVO", e.target.checked ? "true" : "false")} className="h-6 w-6 accent-brand-600" />
              Enviar alertas por e-mail{"EMAIL_ATIVO" in edits && <span aria-label="alterado" className="text-amber-700">●</span>}
            </label>
            {ausente("EMAIL_ATIVO") && aviso404("EMAIL_ATIVO", "ativo")}
          </div>

          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            {campoTexto({ chave: "SMTP_HOST", rotulo: "Servidor", dica: "Ex.: smtp.empresa.com.br" })}
            {campoTexto({ chave: "SMTP_PORT", rotulo: "Porta", inputMode: "numeric", dica: "587 = STARTTLS · 465 = TLS direto · 25 costuma ser bloqueada." })}
          </div>
          {campoTexto({ chave: "SMTP_USER", rotulo: "Usuário", dica: "Login de autenticação no servidor SMTP." })}
          <CampoSecreto id="em-SMTP_PASS" rotulo="Senha" valor={edits.SMTP_PASS ?? ""} onChange={(v) => editar("SMTP_PASS", v)}
            definido={senhaDefinida} alterado={"SMTP_PASS" in edits}
            erro={erros.SMTP_PASS} desabilitado={ausente("SMTP_PASS")} />
          <div className="flex flex-col gap-1">
            {campoTexto({ chave: "SMTP_FROM", rotulo: "Remetente", dica: "Opcional. Em branco, o remetente é o próprio usuário SMTP." })}
            {ausente("SMTP_FROM") && aviso404("SMTP_FROM", "o usuário SMTP")}
          </div>
          <p className="flex items-start gap-2 text-sm text-muted"><Icone nome="cadeado" className="mt-0.5 h-4 w-4" />O servidor exige conexão segura (TLS): servidores que só aceitam texto puro não funcionam.</p>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line/50 dark:border-line-soft pt-4">
            {sujo && <span className="mr-auto text-sm font-semibold text-amber-800">● {Object.keys(edits).length} alteração(ões) não salva(s)</span>}
            <button type="button" onClick={() => { setEdits({}); setErros({}); }} disabled={!sujo || ocupado} className={btnSec}>Descartar</button>
            <button type="submit" disabled={!sujo || ocupado} className={btnPrim}>{salvando ? "Salvando…" : "Salvar"}</button>
          </div>
        </form>
      )}

      {itens && (
        <div className="flex flex-col gap-3 rounded-2xl bg-panel p-4 ring-1 ring-line md:p-5">
          <h4 className="text-lg font-extrabold text-primary-fg">Testar envio</h4>
          <p className="text-sm text-muted">O teste usa o servidor <strong>gravado</strong>. {sujo ? "Há alterações pendentes: elas serão salvas antes do envio." : "Sem alterações pendentes."} Limite: 5 testes por minuto.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[16rem] flex-1">
              <span className="font-semibold">Enviar para</span>
              <input type="email" inputMode="email" autoComplete="off" value={para} onChange={(e) => setPara(e.target.value)} placeholder="seu.email@empresa.com.br" className={`${campo} mt-1`} />
            </label>
            <button type="button" onClick={() => void testar()} disabled={!paraOk || ocupado || (!completo && !sujo)} className={btnPrim}>
              <Icone nome="enviar" />{testando ? "Enviando…" : salvando ? "Salvando…" : sujo ? "Salvar e enviar teste" : "Enviar teste"}
            </button>
          </div>
          {!completo && !sujo && <p className="text-sm text-amber-900">Preencha servidor, porta, usuário e senha para poder testar.</p>}

          {resultado?.tipo === "ok" && (
            <Faixa tipo="ok">Aceito pelo servidor SMTP para {resultado.aceitos.join(", ")}. {resultado.resposta && <span className="font-normal">({resultado.resposta}) </span>}
              <span className="font-normal">“Aceito” não garante a caixa de entrada: a entrega final depende do provedor do destinatário; confira também o spam.</span></Faixa>
          )}
          {resultado?.tipo === "falha" && <Faixa tipo="erro">Falhou: {resultado.msg}</Faixa>}
          {resultado?.tipo === "limite" && (
            <p role="status" className="flex items-start gap-2 rounded-xl bg-amber-100 p-3 font-semibold text-amber-900"><Icone nome="relogio" className="mt-0.5 h-5 w-5" />Aguarde 1 minuto: máximo de 5 testes por minuto.</p>
          )}
        </div>
      )}
      {aviso && <Faixa tipo="ok">{aviso}</Faixa>}
    </section>
  );
}
