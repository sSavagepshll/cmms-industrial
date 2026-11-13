"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, criarUsuario, desbloquearUsuario, editarUsuario, listarUsuarios, redefinirPin, removerUsuario } from "@/lib/api";
import { PERFIS, rotuloPerfil, type Operador, type PerfilUsuario, type Usuario } from "@/lib/types";
import { ConfirmarAcao } from "../ui/ConfirmarAcao";
import { Dialogo } from "../ui/Dialogo";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { btnPerigo, btnPrim, btnSec, campo } from "../ui/estilos";

const MATRICULA_RE = /^\d{1,12}$/; // o teclado do totem digita só números (até 12)
const soDigitos = (v: string) => v.replace(/\D/g, "");
// E-mail é opcional: vazio vale; preenchido precisa ter formato válido (a API revalida).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailOk = (v: string) => v.trim() === "" || (v.trim().length <= 254 && EMAIL_RE.test(v.trim()));
const pinOk = (pin: string, confirma: string) => /^\d{4,6}$/.test(pin) && pin === confirma;

function mensagemErro(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "Sem conexão com o servidor.";
    if (e.status === 403) return "Apenas administradores podem gerenciar usuários.";
    if (e.status >= 500) return "Erro no servidor. Tente novamente em instantes.";
    return e.message; // 404/409/422/400: a API já devolve texto legível (ex.: ULTIMO_ADMIN, EMAIL_DUPLICADO)
  }
  return "Erro inesperado.";
}

/** Gerenciador de Usuários (ADMIN): tabela + diálogos "Novo usuário" e "Editar / Redefinir PIN". */
export function UsuariosPage({ user }: { user: Operador }) {
  const [lista, setLista] = useState<Usuario[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [inativos, setInativos] = useState(true);
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [desativando, setDesativando] = useState<Usuario | null>(null);
  const [excluindo, setExcluindo] = useState<Usuario | null>(null);
  const [alternando, setAlternando] = useState(false);
  const [desbloqueando, setDesbloqueando] = useState<string | null>(null);
  const [erroDesativar, setErroDesativar] = useState<string | null>(null);

  const carregar = useCallback(() => {
    listarUsuarios()
      .then((l) => { setLista(l); setErro(null); })
      .catch((e) => { if (e instanceof ApiError && e.status === 401) return; setLista((p) => p ?? []); setErro(mensagemErro(e)); });
  }, []);
  useEffect(carregar, [carregar]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (lista ?? [])
      .filter((u) => (inativos || u.ativo) && (!q || u.nome.toLowerCase().includes(q) || (u.matricula ?? "").toLowerCase().includes(q)))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [lista, busca, inativos]);

  async function desbloquear(u: Usuario) {
    setDesbloqueando(u.id); setAviso(null);
    try { await desbloquearUsuario(u.id); setAviso(`${u.nome} foi desbloqueado e já pode tentar o PIN de novo.`); setErro(null); carregar(); }
    catch (e) { setErro(mensagemErro(e)); }
    finally { setDesbloqueando(null); }
  }

  async function alternarAtivo(u: Usuario): Promise<boolean> {
    setAlternando(true); setAviso(null);
    try {
      const novoEstado = await editarUsuario(u.id, { ativo: !u.ativo });
      setLista((l) => l?.map((x) => (x.id === u.id ? { ...x, ...novoEstado } : x)) ?? l);
      setAviso(`${u.nome} foi ${u.ativo ? "desativado" : "reativado"}.`);
      setErro(null);
      return true;
    } catch (e) {
      const m = mensagemErro(e);
      if (u.ativo) setErroDesativar(m); else setErro(m);
      return false;
    } finally { setAlternando(false); }
  }

  return (
    <section aria-label="Usuários" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-extrabold">Usuários</h3>
          <p className="text-muted">Quem acessa o totem, o Kanban e este painel. O acesso é por matrícula + PIN.</p>
        </div>
        <button onClick={() => { setAviso(null); setNovo(true); }} className={btnPrim}><Icone nome="mais" />Novo usuário</button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="min-w-[16rem] flex-1">
          <span className="sr-only">Buscar usuário</span>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou matrícula…" className={campo} />
        </label>
        <label className="flex min-h-11 items-center gap-2 font-semibold">
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} className="h-5 w-5 accent-brand-600" />
          Mostrar inativos
        </label>
        <button onClick={carregar} className={btnSec}><Icone nome="atualizar" />Atualizar</button>
      </div>

      {aviso && <Faixa tipo="ok">{aviso}</Faixa>}
      {erro && <Faixa tipo="erro">{erro}</Faixa>}

      <div className="overflow-x-auto rounded-2xl bg-panel ring-1 ring-line">
        <table className="w-full min-w-[50rem] text-left">
          <caption className="sr-only">Lista de usuários</caption>
          <thead className="bg-brand-50 text-sm uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="p-3">Nome</th>
              <th scope="col" className="p-3">Matrícula</th>
              <th scope="col" className="p-3">Perfil</th>
              <th scope="col" className="p-3">PIN</th>
              <th scope="col" className="p-3">Status</th>
              <th scope="col" className="p-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/40 dark:divide-line-soft">
            {!lista && <tr><td colSpan={6} className="p-6 text-muted">Carregando…</td></tr>}
            {lista && visiveis.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-muted">{lista.length === 0 ? "Nenhum usuário cadastrado." : "Nenhum usuário encontrado para o filtro."}</td></tr>
            )}
            {visiveis.map((u) => {
              const eu = u.id === user.id;
              const bloqueadoAte = u.bloqueadoAte && new Date(u.bloqueadoAte).getTime() > Date.now() ? new Date(u.bloqueadoAte) : null;
              return (
                <tr key={u.id} className={u.ativo ? "" : "bg-ink/60 text-muted"}>
                  <td className="p-3 font-semibold">{u.nome}{eu && <span className="ml-2 rounded bg-brand-100 px-2 py-0.5 text-xs font-bold text-primary-fg">você</span>}</td>
                  <td className="p-3 tabular-nums">{u.matricula ?? "—"}</td>
                  <td className="p-3"><span className="rounded-full bg-brand-100 px-3 py-1 text-sm font-bold text-primary-fg">{rotuloPerfil(u.perfil)}</span></td>
                  <td className="p-3">
                    {u.temPin === undefined ? "—" : u.temPin
                      ? <span className="inline-flex items-center gap-1 font-semibold text-green-800"><Icone nome="check" className="h-4 w-4" />Definido</span>
                      : <span className="inline-flex items-center gap-1 font-semibold text-red-800" title="Sem PIN o usuário não consegue entrar"><Icone nome="alerta" className="h-4 w-4" />Sem PIN</span>}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-col items-start gap-1">
                      {u.ativo ? <span className="font-semibold text-green-800">● Ativo</span> : <span className="font-semibold text-red-800">○ Inativo</span>}
                      {bloqueadoAte && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-sm font-bold text-amber-900" title="Bloqueado por tentativas erradas de PIN">
                          <Icone nome="cadeado" className="h-4 w-4" />Bloqueado até {bloqueadoAte.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      {bloqueadoAte && (
                        <button onClick={() => void desbloquear(u)} disabled={desbloqueando === u.id} aria-label={`Desbloquear ${u.nome}`}
                          className={`${btnSec} !min-h-11 !px-3 text-sm`}><Icone nome="cadeado" className="h-4 w-4" />{desbloqueando === u.id ? "…" : "Desbloquear"}</button>
                      )}
                      <button onClick={() => { setAviso(null); setEditando(u); }} aria-label={`Editar ou redefinir PIN de ${u.nome}`} className={`${btnSec} !min-h-11 !px-3 text-sm`}><Icone nome="editar" className="h-4 w-4" />Editar / PIN</button>
                      {u.ativo ? (
                        <button onClick={() => { setErroDesativar(null); setDesativando(u); }} disabled={eu} title={eu ? "Você não pode desativar a si mesmo" : undefined}
                          aria-label={`Desativar ${u.nome}`} className={`${btnPerigo} !min-h-11 !px-3 text-sm ring-1`}>Desativar</button>
                      ) : (
                        <button onClick={() => void alternarAtivo(u)} disabled={alternando} aria-label={`Reativar ${u.nome}`}
                          className="inline-flex min-h-11 items-center rounded-xl bg-panel px-3 text-sm font-semibold text-green-800 ring-1 ring-ok-fg hover:bg-green-50 disabled:opacity-40">Reativar</button>
                      )}
                      {!eu && (
                        <button onClick={() => { setAviso(null); setExcluindo(u); }} aria-label={`Excluir ${u.nome}`} title="Excluir usuário"
                          className={`${btnPerigo} !min-h-11 !px-3 text-sm ring-1`}><Icone nome="lixeira" className="h-4 w-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {lista && <p className="text-sm text-muted">{visiveis.length} de {lista.length} usuário(s)</p>}

      {novo && <NovoUsuarioModal onFechar={() => setNovo(false)} onCriado={(u) => { setNovo(false); setAviso(`Usuário ${u.nome} criado.`); carregar(); }} />}
      {editando && (
        <EditarUsuarioModal usuario={editando} euMesmo={editando.id === user.id} onFechar={() => setEditando(null)}
          onSalvo={(msg) => { setEditando(null); setAviso(msg); carregar(); }} />
      )}
      {desativando && (
        <ConfirmarAcao titulo={`Desativar ${desativando.nome}?`} rotuloConfirmar="Desativar usuário" busy={alternando} erro={erroDesativar}
          onCancelar={() => setDesativando(null)}
          onConfirmar={async () => { if (await alternarAtivo(desativando)) setDesativando(null); }}>
          <p><strong>{desativando.nome}</strong> não poderá mais entrar no totem, no Kanban nem neste painel. Você pode reativá-lo depois.</p>
          <p className="mt-2">Se ele tiver OMs reservadas ou em atendimento, reatribua-as no <strong>Despacho</strong> para não ficarem paradas.</p>
        </ConfirmarAcao>
      )}
      {excluindo && (
        <ExcluirUsuarioModal usuario={excluindo} onFechar={() => setExcluindo(null)}
          onExcluido={(nome) => { setExcluindo(null); setErro(null); setAviso(`Usuário ${nome} excluído.`); carregar(); }}
          onDesativar={alternarAtivo} />
      )}
    </section>
  );
}

const ROTULO_REF: Record<string, string> = {
  ordens: "OM(s)", apontamentos: "apontamento(s) de tempo", notas: "nota(s)", materiais: "material(is)",
  historico: "registro(s) de histórico", auditoria: "registro(s) de auditoria", outros: "outro(s) vínculo(s)",
};
function resumoReferencias(corpo: unknown): string {
  const ref = (corpo as { referencias?: Record<string, number> } | undefined)?.referencias;
  return Object.entries(ref ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${ROTULO_REF[k] ?? k}`).join(", ");
}

/** Exclusão física (DELETE /usuarios/:id). Com histórico a API devolve 409 USUARIO_COM_HISTORICO: o modal passa a oferecer desativar. */
function ExcluirUsuarioModal({ usuario, onFechar, onExcluido, onDesativar }: {
  usuario: Usuario; onFechar: () => void; onExcluido: (nome: string) => void; onDesativar: (u: Usuario) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [historico, setHistorico] = useState<string | null>(null);

  async function excluir() {
    setBusy(true); setErro(null);
    try { await removerUsuario(usuario.id); onExcluido(usuario.nome); }
    catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "USUARIO_COM_HISTORICO") setHistorico(resumoReferencias(e.body));
      else setErro(mensagemErro(e));
      setBusy(false);
    }
  }
  async function desativar() {
    setBusy(true);
    const ok = await onDesativar(usuario);
    if (ok) onFechar(); else { setErro("Não foi possível desativar o usuário."); setBusy(false); }
  }

  if (historico !== null) {
    return (
      <ConfirmarAcao titulo={`${usuario.nome} não pode ser excluído`} rotuloConfirmar={usuario.ativo ? "Desativar usuário" : "Entendi"} perigoso={false}
        busy={busy} erro={erro} onCancelar={onFechar} onConfirmar={usuario.ativo ? desativar : onFechar}>
        <p>Este usuário tem histórico{historico && <> ({historico})</>} e não pode ser excluído, para preservar a rastreabilidade.</p>
        {usuario.ativo ? <p className="mt-2">Deseja <strong>desativá-lo</strong>? Ele não poderá mais entrar, e você pode reativá-lo depois.</p>
          : <p className="mt-2">Ele já está inativo e não consegue entrar no sistema.</p>}
      </ConfirmarAcao>
    );
  }
  return (
    <ConfirmarAcao titulo="Excluir usuário?" rotuloConfirmar="Excluir" busy={busy} erro={erro} onCancelar={onFechar} onConfirmar={excluir}>
      <p><strong>{usuario.nome}</strong> · matrícula <span className="tabular-nums">{usuario.matricula ?? "—"}</span> · {rotuloPerfil(usuario.perfil)}</p>
      <p className="mt-2 font-semibold">Esta ação não pode ser desfeita.</p>
    </ConfirmarAcao>
  );
}

function ResumoPerfil({ perfil }: { perfil: PerfilUsuario }) {
  const p = PERFIS.find((x) => x.key === perfil);
  if (!p) return null;
  return (
    <div className="flex gap-2 rounded-xl bg-brand-50 p-3 text-sm text-primary-fg" aria-live="polite">
      <Icone nome="info" className="mt-0.5 h-5 w-5" />
      <p><strong>{p.label}:</strong> {p.resumo}{p.aviso && <> <strong className="inline-flex items-center gap-1 text-amber-900"><Icone nome="alerta" className="h-4 w-4" />{p.aviso}</strong></>}</p>
    </div>
  );
}

function SeletorPerfil({ valor, onChange, desabilitado, dica }: { valor: PerfilUsuario; onChange: (p: PerfilUsuario) => void; desabilitado?: boolean; dica?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Perfil</span>
        <select value={valor} onChange={(e) => onChange(e.target.value as PerfilUsuario)} disabled={desabilitado} className={campo}>
          {PERFIS.map((p) => <option key={p.key} value={p.key}>{p.label} — {p.desc}</option>)}
        </select>
        {dica && <span className="text-sm text-muted">{dica}</span>}
      </label>
      <ResumoPerfil perfil={valor} />
    </div>
  );
}

function CamposPin({ pin, confirma, onPin, onConfirma, rotulo = "PIN" }: { pin: string; confirma: string; onPin: (v: string) => void; onConfirma: (v: string) => void; rotulo?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1"><span className="font-semibold">{rotulo} (4 a 6 dígitos)</span>
        <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={(e) => onPin(soDigitos(e.target.value))} className={campo} /></label>
      <label className="flex flex-col gap-1"><span className="font-semibold">Confirmar {rotulo}</span>
        <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={confirma} onChange={(e) => onConfirma(soDigitos(e.target.value))} className={campo} /></label>
      {confirma.length > 0 && pin !== confirma && <p className="text-sm font-semibold text-red-800 sm:col-span-2">Os PINs não conferem.</p>}
    </div>
  );
}

function CampoEmail({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const invalido = !emailOk(valor);
  return (
    <label className="flex flex-col gap-1">
      <span className="font-semibold">E-mail <span className="font-normal text-muted">(Opcional - Para alertas)</span></span>
      <input type="email" inputMode="email" autoComplete="off" maxLength={254} value={valor} onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalido} aria-describedby="email-dica" className={`${campo} ${invalido ? "ring-danger-fg" : ""}`} />
      <span id="email-dica" className={`text-sm ${invalido ? "font-semibold text-red-800" : "text-muted"}`}>
        {invalido ? "Informe um e-mail válido ou deixe em branco." : "Usado só para enviar alertas a técnicos e gerentes. Pode ficar em branco."}
      </span>
    </label>
  );
}

function NovoUsuarioModal({ onFechar, onCriado }: { onFechar: () => void; onCriado: (u: Usuario) => void }) {
  const [nome, setNome] = useState("");
  const [matricula, setMatricula] = useState("");
  const [perfil, setPerfil] = useState<PerfilUsuario>("OPERADOR");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [confirma, setConfirma] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ok = nome.trim().length >= 2 && MATRICULA_RE.test(matricula) && pinOk(pin, confirma) && emailOk(email);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setErro(null);
    try { onCriado(await criarUsuario({ nome: nome.trim(), matricula, perfil, pin, ...(email.trim() && { email: email.trim() }) })); }
    catch (err) { setErro(mensagemErro(err)); setBusy(false); }
  }

  return (
    <Dialogo titulo="Novo usuário" onFechar={onFechar} travado={busy}>
      <form onSubmit={salvar} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1"><span className="font-semibold">Nome completo</span>
          <input autoFocus maxLength={150} value={nome} onChange={(e) => setNome(e.target.value)} className={campo} /></label>
        <label className="flex flex-col gap-1"><span className="font-semibold">Matrícula</span>
          <input inputMode="numeric" maxLength={12} value={matricula} onChange={(e) => setMatricula(soDigitos(e.target.value))} className={campo} />
          <span className="text-sm text-muted">Só números (até 12 dígitos): é o que o teclado do totem digita.</span></label>
        <SeletorPerfil valor={perfil} onChange={setPerfil} />
        <CampoEmail valor={email} onChange={setEmail} />
        <CamposPin pin={pin} confirma={confirma} onPin={setPin} onConfirma={setConfirma} />
        {erro && <Faixa tipo="erro">{erro}</Faixa>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onFechar} disabled={busy} className={btnSec}>Cancelar</button>
          <button type="submit" disabled={!ok || busy} className={btnPrim}>{busy ? "Salvando…" : "Criar usuário"}</button>
        </div>
      </form>
    </Dialogo>
  );
}

/** Texto do impacto ao mudar de/para ADMIN ou TECNICO (U7); null = mudança sem confirmação. */
function impactoPerfil(nome: string, de: PerfilUsuario, para: PerfilUsuario): ReactNode | null {
  const sensivel = (p: PerfilUsuario) => p === "ADMIN" || p === "TECNICO";
  if (de === para || !(sensivel(de) || sensivel(para))) return null;
  const novo = PERFIS.find((p) => p.key === para);
  return (
    <div className="flex flex-col gap-2">
      <p><strong>{nome}</strong> passará de <strong>{rotuloPerfil(de)}</strong> para <strong>{rotuloPerfil(para)}</strong>.</p>
      <ul className="list-disc space-y-1 pl-5">
        {para === "ADMIN" && <li>Ganha acesso total, inclusive a usuários, e-mail e parâmetros.</li>}
        {de === "ADMIN" && <li>Perde o acesso às Configurações do Sistema.</li>}
        {para === "TECNICO" && <li>Deixa de poder abrir OM e passa a atender OMs no Kanban.</li>}
        {de === "TECNICO" && <li>Deixa de atender OMs no Kanban.</li>}
        {novo && <li>{novo.resumo}</li>}
      </ul>
    </div>
  );
}

function EditarUsuarioModal({ usuario, euMesmo, onFechar, onSalvo }: { usuario: Usuario; euMesmo: boolean; onFechar: () => void; onSalvo: (msg: string) => void }) {
  const [nome, setNome] = useState(usuario.nome);
  const [perfil, setPerfil] = useState<PerfilUsuario>(usuario.perfil);
  const [email, setEmail] = useState(usuario.email ?? "");
  const [pin, setPin] = useState("");
  const [confirma, setConfirma] = useState("");
  const [confirmando, setConfirmando] = useState<null | "pin" | "perfil">(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const emailMudou = email.trim() !== (usuario.email ?? "");
  const mudou = nome.trim() !== usuario.nome || perfil !== usuario.perfil || emailMudou;
  const dadosOk = mudou && nome.trim().length >= 2 && emailOk(email);
  const impacto = impactoPerfil(nome.trim() || usuario.nome, usuario.perfil, perfil);

  async function gravarDados() {
    setBusy(true); setErro(null);
    try {
      await editarUsuario(usuario.id, {
        ...(nome.trim() !== usuario.nome && { nome: nome.trim() }),
        ...(perfil !== usuario.perfil && { perfil }),
        // preenchido = envia; apagado (tinha e-mail) = null remove; igual ao atual = não envia
        ...(emailMudou && { email: email.trim() || null }),
      });
      onSalvo(`Dados de ${nome.trim()} atualizados.`);
    } catch (err) { setErro(mensagemErro(err)); setBusy(false); }
  }

  async function gravarPin() {
    setBusy(true); setErro(null);
    try { await redefinirPin(usuario.id, pin); onSalvo(`PIN de ${usuario.nome} redefinido.`); }
    catch (err) { setErro(mensagemErro(err)); setBusy(false); }
  }

  const pedirSalvarDados = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dadosOk || busy) return;
    if (impacto) { setErro(null); setConfirmando("perfil"); } else void gravarDados();
  };
  const pedirRedefinirPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinOk(pin, confirma) || busy) return;
    setErro(null); setConfirmando("pin");
  };
  const cancelar = () => { setConfirmando(null); setErro(null); };

  return (
    <Dialogo titulo={`Editar · ${usuario.nome}`} onFechar={onFechar} travado={busy}>
      <div className="flex flex-col gap-6">
        <form onSubmit={pedirSalvarDados} className="flex flex-col gap-4" aria-label="Dados do usuário">
          <p className="text-sm text-muted">Matrícula <strong className="tabular-nums text-fg">{usuario.matricula ?? "—"}</strong> (não editável)</p>
          <label className="flex flex-col gap-1"><span className="font-semibold">Nome completo</span>
            <input autoFocus maxLength={150} value={nome} onChange={(e) => setNome(e.target.value)} className={campo} /></label>
          <SeletorPerfil valor={perfil} onChange={setPerfil} desabilitado={euMesmo} dica={euMesmo ? "Você não pode alterar o próprio perfil." : undefined} />
          <CampoEmail valor={email} onChange={setEmail} />
          <div className="flex justify-end"><button type="submit" disabled={!dadosOk || busy} className={btnPrim}>{busy && confirmando === null ? "Salvando…" : "Salvar dados"}</button></div>
        </form>

        <form onSubmit={pedirRedefinirPin} className="flex flex-col gap-4 border-t border-line/50 dark:border-line-soft pt-5" aria-label="Redefinir PIN">
          <div>
            <h3 className="text-lg font-extrabold">Redefinir PIN</h3>
            <p className="text-sm text-muted">{usuario.temPin === false ? "Este usuário ainda não tem PIN e não consegue entrar." : "Use quando o usuário esquecer o PIN."}</p>
          </div>
          <CamposPin pin={pin} confirma={confirma} onPin={setPin} onConfirma={setConfirma} rotulo="Novo PIN" />
          <div className="flex justify-end"><button type="submit" disabled={!pinOk(pin, confirma) || busy} className={btnPerigo}><Icone nome="chave" />Redefinir PIN…</button></div>
        </form>

        {erro && !confirmando && <Faixa tipo="erro">{erro}</Faixa>}
        <div className="flex justify-end"><button type="button" onClick={onFechar} disabled={busy} className={btnSec}>Fechar</button></div>
      </div>

      {confirmando === "pin" && (
        <ConfirmarAcao titulo={`Redefinir o PIN de ${usuario.nome}?`} rotuloConfirmar="Redefinir PIN" busy={busy} erro={erro}
          onCancelar={cancelar} onConfirmar={gravarPin}>
          <p>O PIN atual de <strong>{usuario.nome}</strong> deixa de funcionar agora. Avise-o pessoalmente do novo PIN.</p>
        </ConfirmarAcao>
      )}
      {confirmando === "perfil" && (
        <ConfirmarAcao titulo={`Alterar o perfil de ${usuario.nome}?`} rotuloConfirmar="Alterar perfil" busy={busy} erro={erro}
          onCancelar={cancelar} onConfirmar={gravarDados}>
          {impacto}
        </ConfirmarAcao>
      )}
    </Dialogo>
  );
}
