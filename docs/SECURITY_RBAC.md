# Segurança e controle de acesso (RBAC)

Este documento descreve os controles de segurança implementados no código: perfis e matriz de permissões, autenticação por PIN, sessões, headers HTTP, sanitização de CSV e geração de PDF. Também registra as limitações conhecidas.

---

## 1. Perfis

| Perfil | Descrição operacional |
|---|---|
| `OPERADOR` | Abre OMs no totem e aprova ou reprova apenas as OMs que abriu. |
| `LIDER_PRODUCAO` | Decide sobre as próprias OMs e, após um prazo, sobre as OMs abertas por operadores. |
| `TECNICO` | Assume, executa, pausa, conclui OMs e registra apontamentos, materiais e testes. |
| `GERENTE` | Atribui (delega) OMs, acompanha indicadores, encerra a OM após a aprovação. Também executa OMs. |
| `ADMIN` | Administra usuários, configurações, setores, equipamentos, grupos e auditoria. Acesso a tudo. |

Cada `preHandler` lista explicitamente os perfis permitidos; o `ADMIN` aparece em todas as rotas de administração e também em todas as rotas operacionais, ao lado dos perfis que as executam.

---

## 2. Matriz RBAC

A autorização é feita **por rota**, no servidor, com `preHandler` (`apps/api/src/plugins/rbac.ts`). A camada de login por portal é complementar (ver seção 3.3).

Legenda: ✔ permitido · ✖ negado · ◐ permitido com regra adicional no handler.

| Ação | OPERADOR | LIDER_PRODUCAO | TECNICO | GERENTE | ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|
| Abrir OM (`POST /ordens`) | ◐ | ◐ | ◐ | ◐ | ◐ |
| Listar OMs (`GET /ordens`) | ◐ | ◐ | ✔ | ✔ | ✔ |
| Ver fila de atendimento (`GET /ordens/fila`) | ✖ | ✖ | ✔ | ✔ | ✔ |
| Assumir OM, play, pausar, concluir | ✖ | ✖ | ✔ | ✔ | ✔ |
| Recusar OM delegada | ✖ | ✖ | ✔ | ✔ | ✔ |
| Registrar materiais e apontamentos | ✖ | ✖ | ✔ | ✔ | ✔ |
| Testes de qualidade e de produção (criar) | ✖ | ✖ | ✔ | ✔ | ✔ |
| Atribuir / delegar OM (`POST /ordens/:id/atribuir`) | ✖ | ✖ | ✖ | ✔ | ✔ |
| Cancelar delegação, ver OMs devolvidas | ✖ | ✖ | ✖ | ✔ | ✔ |
| Listar aprovações pendentes | ◐ | ✔ | ✖ | ✖ | ✔ |
| Aprovar ou reprovar OM (com PIN) | ◐ | ◐ | ✖ | ✖ | ✔ |
| Listar conclusões pendentes e encerrar OM (com PIN) | ✖ | ✖ | ✖ | ✔ | ✔ |
| Gerar ficha PDF (`GET /ordens/:id/ficha.pdf`) | ✖ | ✖ | ✔ | ✔ | ✔ |
| Listar técnicos para delegação (`GET /usuarios/tecnicos`) | ✖ | ✖ | ✖ | ✔ | ✔ |
| Indicadores de desempenho (`/metricas/*`) | ✖ | ✖ | ✖ | ✔ | ✔ |
| Configurações e parâmetros (`/configuracoes/*`) | ✖ | ✖ | ✖ | ✖ | ✔ |
| Usuários (`/usuarios/*`) | ✖ | ✖ | ✖ | ✖ | ✔ |
| Setores, máquinas e grupos (`/setores/*`, `/grupos-ativos/*`, `/equipamentos` administrativo) | ✖ | ✖ | ✖ | ✖ | ✔ |
| Auditoria (`GET /auditoria`) | ✖ | ✖ | ✖ | ✖ | ✔ |

### 2.1 Regras adicionais dentro dos handlers

- **Listagem de OMs:** `OPERADOR` e `LIDER_PRODUCAO` precisam informar `equipamentoId`; sem ele, recebem `403 FILTRO_OBRIGATORIO`.
- **Abertura de OM:** o solicitante é sempre o usuário do token; um `solicitanteId` enviado no corpo é descartado pelo schema.
- **Aprovações (listagem):** `OPERADOR` vê apenas as OMs que abriu. Os demais perfis autorizados veem todas as OMs aguardando aprovação.
- **Dados de atendimento:** responsável, delegador, datas de delegação e motivo de recusa só são enviados a `TECNICO`, `GERENTE` e `ADMIN`. Operador e líder não recebem esses campos na listagem de OMs.

### 2.1.1 Regras de aprovação

- **Segregação (RN-24):** quem executou a OM nunca decide sobre ela, inclusive `ADMIN`. A resposta é `403 AUTOAPROVACAO_PROIBIDA`.
- **OPERADOR:** decide apenas sobre as OMs que abriu.
- **LIDER_PRODUCAO:** decide sobre as próprias OMs. Sobre OMs de operadores, só após um prazo (RN-21b), e nesse caso a decisão é registrada *em nome do operador*. Antes do prazo, a resposta é `403 AGUARDE_OPERADOR` com o tempo restante.
- **ADMIN:** decide sobre qualquer OM, sem espera.
- **GERENTE e TECNICO:** nunca aprovam. O gerente apenas encerra a OM depois da aprovação.

### 2.2 Revalidação no banco

`exigirPerfil` confere o perfil **e** o campo `ativo` no banco a cada chamada. Um usuário desativado perde o acesso na próxima requisição, mesmo com um JWT ainda válido.

### 2.3 Proteções de integridade administrativa

- Um `ADMIN` não pode desativar nem rebaixar a si mesmo (`409 AUTO_REBAIXAMENTO`).
- Deve restar ao menos um `ADMIN` ativo (`409 ULTIMO_ADMIN`).

---

## 3. Autenticação

### 3.1 PIN com scrypt (método em uso)

Todos os perfis entram por **matrícula + PIN numérico de 4 a 6 dígitos**, nas rotas `/auth/pin`, `/auth/login` e `/auth/totem` (mesmo handler).

| Parâmetro | Valor |
|---|---|
| Algoritmo | scrypt, `N = 2^15`, `r = 8`, `p = 1`, saída de 32 bytes |
| Salt | 16 bytes aleatórios por PIN |
| Formato armazenado | `scrypt$N$r$p$salt$hash` em `usuarios.pin_hash` |
| Comparação | `timingSafeEqual` |
| Anti-enumeração | Um hash descartável (`DUMMY_HASH`) é verificado quando a matrícula não existe, para igualar o tempo de resposta. A mensagem de erro é sempre `CREDENCIAIS_INVALIDAS`. |

O PIN nunca é registrado em log: o logger redige `req.body.pin`, `req.body.senha` e `req.body.novoPin`.

### 3.2 Proteção contra força bruta

| Controle | Regra |
|---|---|
| Limite por IP nas rotas de login | 10 requisições por minuto (`/auth/*`) |
| Limite global | 300 requisições por minuto por IP |
| Bloqueio por matrícula | 5 falhas consecutivas bloqueiam a matrícula por 15 minutos (resposta `429` com `Retry-After`) |
| Reconfirmação de PIN | Aceite da OM (assumir), decisão de aprovação ou reprovação e encerramento pedem o PIN do próprio usuário; as falhas usam o mesmo contador de bloqueio. A conclusão técnica (`concluir`) não pede PIN. |

> **Limitação:** o contador de bloqueio fica em memória. Com mais de uma instância da API, cada uma mantém o seu contador. Ver [ARCHITECTURE.md](ARCHITECTURE.md#6-decisões-técnicas).

### 3.3 Política de acesso por portal

O login informa o portal de origem. A regra é aplicada **depois** da verificação do PIN, para não criar um oráculo de perfil.

| Origem do login | Perfis permitidos |
|---|---|
| Totem (há `totemId`) | Perfis em `TOTEM_PERFIS_PERMITIDOS` (padrão: `OPERADOR`, `LIDER_PRODUCAO`, `ADMIN`) |
| Portal técnico (`portal: TECNICO`) | `TECNICO` e `ADMIN` |
| Padrão (painel `/admin`) | Sem restrição por portal |

Regras adicionais:

- `ADMIN` entra em qualquer portal.
- `TOTEM_OBRIGATORIO_PERFIS` define perfis que só podem entrar por um totem cadastrado. Sem totem, o login é recusado com `403 TOTEM_OBRIGATORIO`.
- `TOTENS_AUTORIZADOS` (lista de Device IDs) é verificado **antes** do PIN, sem consumir tentativas de PIN de ninguém.
- Tentativas bloqueadas por portal são auditadas (`LOGIN_PERFIL_BLOQUEADO`).

### 3.4 Autenticação única por PIN

Todos os perfis (`OPERADOR`, `LIDER_PRODUCAO`, `TECNICO`, `GERENTE` e `ADMIN`) entram com **matrícula + PIN de 4 a 6 dígitos**, pelo mesmo handler de `/auth/pin`, `/auth/login` e `/auth/totem`. Não existe login por e-mail ou senha alfanumérica.

Há ainda um resquício no código: `auth/password.ts` contém os helpers `hashSenha` e `verifySenha` (bcrypt, custo 12), e `senha_hash` existe na tabela `usuarios`. Nenhuma rota chama esses helpers nem lê `senha_hash`. A criptografia dedicada do sistema é a dos segredos de configuração (`crypto/segredo.ts`, seção 8).

A carga de demonstração (`db/seed_portfolio.sql`) grava `NULL` em `senha_hash`. Os usuários demo entram apenas com matrícula e PIN `1234` (scrypt).

### 3.5 Sessões: totem versus padrão

| Item | Valor |
|---|---|
| Algoritmo | HS256, com `iss = om-api` e `aud = om-kiosk`, verificados na leitura |
| Segredo | `JWT_SECRET` com pelo menos 32 caracteres (a aplicação não inicia com valor menor) |
| Sessão de totem | Duração **absoluta** de `KIOSK_TOKEN_TTL_S` (padrão 900 s), sem renovação, vinculada ao Device ID |
| Sessão de painel (`GERENTE`/`ADMIN`, portal padrão) | `ADMIN_SESSAO_TTL_S` (padrão 43 200 s = 12 h), absoluta |
| Demais sessões | `JWT_EXPIRES_IN` (padrão do compose: 5 minutos) |

**Vínculo ao totem.** Um token de totem só vale com o header `X-Totem-Id` idêntico ao `tid` do token. A duração do token também é conferida. Qualquer divergência retorna `401 SESSAO_TOTEM_INVALIDA`, sempre com a mesma mensagem, para não revelar o motivo.

**Sem renovação.** Não há endpoint de *refresh*. Ao expirar, o usuário entra de novo.

**Eventos em tempo real.** O `EventSource` não envia `Authorization`. O cliente troca o JWT por um ticket de 30 segundos e de uso único (`POST /eventos/ticket`). Um ticket de sessão de totem herda o Device ID e o fim absoluto do JWT.

---

## 4. Headers HTTP

### 4.1 API (`apps/api/src/app.ts`, via `@fastify/helmet`)

| Header | Valor |
|---|---|
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Resource-Policy` | `cross-origin` |
| `X-Request-Id` | Eco do cliente se válido (8–64 caracteres `A-Za-z0-9._-`); senão, UUID gerado. Evita injeção em logs. |

Outros controles da API:

- **CORS:** lista explícita (`CORS_ORIGIN`), requisições sem `Origin` (servidor a servidor) e origens de rede privada. Nunca `*`. A aceitação de origens de rede privada é uma decisão de intranet; em exposição pública, remova-a.
- **Limite de corpo:** 64 KB.
- **Erros:** erros 5xx retornam `ERRO_INTERNO` sem detalhes; erros de validação (Zod) retornam `400 VALIDACAO` com os campos.
- **Validação estrita:** os schemas usam `.strict()`, rejeitando campos não previstos.

### 4.2 Web (`apps/web/next.config.ts`)

| Header | Valor |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`; `img-src 'self' data: blob:`; `font-src 'self' data:` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

> **Limitação:** a política de scripts da web inclui `'unsafe-inline'` e `'unsafe-eval'`, exigidos pelo ambiente de desenvolvimento do Next.js. Para produção, o próximo passo é usar *nonces* ou *hashes* e remover essas diretivas.

---

## 5. Sanitização de CSV (injeção de fórmula)

O CSV é gerado **no navegador** por `apps/web/src/lib/csv.ts` (exportações de auditoria e de desempenho). Regras aplicadas:

| Regra | Efeito |
|---|---|
| Texto iniciado por `=`, `+`, `-`, `@`, TAB ou CR | Recebe `'` na frente, neutralizando a fórmula no Excel e no LibreOffice |
| Texto sempre entre aspas | Aspas internas são duplicadas (`""`); quebras de linha são preservadas |
| Separador `;` e diretiva `sep=;` | Compatível com o Excel em configurações regionais com vírgula decimal |
| Número | Sem aspas, com vírgula decimal |
| Data | `dd/MM/aaaa HH:mm:ss` |
| Booleano | `Sim` / `Não` |
| Nulo e indefinido | Célula vazia |
| Codificação | UTF-8 com BOM |
| Fim de linha | CRLF |

> **Limitação:** a sanitização ocorre na exportação. Os dados continuam armazenados como foram digitados. Quem consome o CSV em outra ferramenta deve tratar o arquivo como dado não confiável.

---

## 6. Geração de PDF (Ficha de Manutenção)

A ficha em PDF A4 (formulário APX-081) é gerada por `apps/api/src/ficha/pdf.ts` com PDFKit. Controles:

| Controle | Detalhe |
|---|---|
| Fonte dos dados | **Snapshot** da OM (`ficha/snapshot.ts`), validado pelo schema `ficha/schema.ts`. O PDF não consulta o banco. |
| Texto simples | Nenhum conteúdo é interpretado como HTML ou marcação. |
| Normalização | `NFC`. Caracteres de controle viram espaço. Caracteres fora do conjunto da fonte embutida (WinAnsi) viram `?`. A função não lança exceção. |
| Tamanho | Máximo de 4 páginas; a folha única cobre 5 apontamentos de horas e 4 materiais, com página adicional só em transbordo real. |
| Tempo | Renderização com timeout (`FICHA_PDF_TIMEOUT_MS`, padrão 10 s). |
| Anexo | Tamanho máximo de `OUTBOX_EMAIL_ANEXO_MAX_KB` (padrão 200 KB). Acima disso, o envio não é retentado. |
| Nome do arquivo | Restrito a `A-Za-z0-9_.-`; demais caracteres viram `_`. |
| Acesso | `GET /ordens/:id/ficha.pdf` exige `TECNICO`, `GERENTE` ou `ADMIN` e tem limite de 20 requisições por minuto. |

---

## 7. Auditoria

Ações administrativas e decisões de fluxo gravam uma linha na tabela `auditoria`, com ator, perfil do ator, ação, tipo e identificador do alvo e detalhe. Exemplos de ações registradas: `USUARIO_CRIADO`, `USUARIO_PERFIL_ALTERADO`, `USUARIO_DESATIVADO`, `LOGIN_PERFIL_BLOQUEADO`, `OM_DELEGACAO_CANCELADA`.

Falhas de autenticação geram log estruturado (`login_pin_falhou`, `login_totem_nao_autorizado`, `sessao_totem_rejeitada`) **sem** o PIN e sem o token.

---

## 8. Segredos

- `JWT_SECRET` e credenciais de banco são lidos do ambiente. O valor padrão no `docker-compose.yml` existe **somente para desenvolvimento** e deve ser substituído.
- Segredos salvos em `configuracoes_globais` (por exemplo, a senha SMTP) são cifrados por `crypto/segredo.ts`. A chave vem de `CONFIG_ENCRYPTION_KEY` (mínimo de 32 caracteres). Se ela não for definida, é derivada do `JWT_SECRET`; nesse caso, trocar o `JWT_SECRET` invalida os segredos já salvos. Em produção, defina uma chave própria.
- Os arquivos `.env` não devem ser versionados.

---

## 9. Resumo das limitações conhecidas

| # | Limitação | Mitigação recomendada |
|---|---|---|
| 1 | Bloqueio de PIN e barramento de eventos em memória | Instância única, ou Redis/Postgres compartilhado para múltiplas instâncias |
| 2 | Helpers bcrypt (`hashSenha`, `verifySenha`) e coluna `senha_hash` sem uso | Remover ou implementar com rota e testes; hoje não são funcionalidade |
| 7 | Carga demo com PIN público `1234` | Não carregar `seed_portfolio.sql` em produção (ver DEPLOYMENT, seção 5.6) |
| 3 | CSP da web com `unsafe-inline` e `unsafe-eval` | Nonces ou hashes em produção |
| 4 | CORS aceita origens de rede privada | Remover em exposição pública |
| 5 | PIN de 4 a 6 dígitos | Política de PIN mais longa ou segundo fator, conforme o risco do ambiente |
| 6 | Sem endpoint de renovação de sessão | Aceitável para sessões curtas; avaliar refresh se houver uso prolongado |
