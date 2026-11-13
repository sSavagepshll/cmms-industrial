# Referência da API

Documentação dos endpoints da API (`apps/api`), derivada das rotas em `apps/api/src/routes/`. A autorização de cada rota está descrita em [SECURITY_RBAC.md](SECURITY_RBAC.md).

> **Formato.** Respostas em JSON. Erros seguem o formato `{ "error": "CODIGO", "message": "..." }`. Erros de validação retornam `400` com `error: "VALIDACAO"` e a lista `detalhes` por campo.
>
> **Autenticação.** Rotas protegidas exigem `Authorization: Bearer <token>`. Sessões de totem exigem também `X-Totem-Id` com o mesmo Device ID do token.
>
> **Identificadores.** IDs são inteiros positivos enviados como string. Campos de corpo não previstos são rejeitados.
>
> **Base.** Os exemplos usam `https://localhost:4000`. Ajuste conforme o ambiente.

Legenda de acesso:

| Marca | Significado |
|---|---|
| Público | Sem autenticação |
| JWT | Qualquer usuário autenticado |
| Perfis | Lista de perfis permitidos (ADMIN incluído em todas as listas) |

---

## 1. Saúde e métricas

| Método | Caminho | Acesso | Descrição |
|---|---|---|---|
| GET | `/health` | Público | Estado geral da API |
| GET | `/health/live` | Público | *Liveness probe*: o processo está respondendo |
| GET | `/health/ready` | Público | *Readiness probe*: a API consegue atender (inclui banco) |
| GET | `/metrics` | Público | Métricas no formato Prometheus |

```bash
curl -s https://localhost:4000/health/live
```

---

## 2. Autenticação

| Método | Caminho | Acesso | Descrição |
|---|---|---|---|
| POST | `/auth/pin` | Público (10/min por IP) | Login com matrícula e PIN |
| POST | `/auth/login` | Público (10/min por IP) | Mesmo handler de `/auth/pin` |
| POST | `/auth/totem` | Público (10/min por IP) | Mesmo handler de `/auth/pin`, usado pelo totem: com `totemId`, a sessão é de totem |
| GET | `/auth/me` | JWT | Dados da sessão atual |

**Corpo de `/auth/pin`, `/auth/login` e `/auth/totem`:**

```json
{
  "matricula": "333444",
  "pin": "1234",
  "totemId": "TOTEM-01",
  "portal": "TECNICO"
}
```

- `pin`: 4 a 6 dígitos.
- `totemId`: opcional. Com ele, o login gera sessão de totem (900 s absolutos, vinculada ao dispositivo). Também aceito no header `X-Totem-Id`; se os dois forem enviados, precisam coincidir.
- `portal`: opcional, valor `TECNICO`. Mutuamente exclusivo com `totemId`.

**Resposta de sucesso:**

```json
{
  "token": "eyJhbGciOi...",
  "tipo": "Bearer",
  "sessao": "TOTEM",
  "totemId": "TOTEM-01",
  "expiraEm": "900s",
  "expiraEmSegundos": 900,
  "usuario": { "id": "12", "nome": "Carlos Silva", "perfil": "OPERADOR" }
}
```

**Erros comuns:**

| HTTP | `error` | Situação |
|---|---|---|
| 400 | `TOTEM_ID_DIVERGENTE` | `totemId` do corpo e header `X-Totem-Id` diferentes |
| 401 | `CREDENCIAIS_INVALIDAS` | Matrícula ou PIN incorretos (mensagem única) |
| 403 | `TOTEM_NAO_AUTORIZADO` | Device ID fora de `TOTENS_AUTORIZADOS` |
| 403 | `PERFIL_NAO_PERMITIDO_NO_TOTEM` | Perfil não habilitado para totem |
| 403 | `PERFIL_NAO_PERMITIDO_NO_PORTAL_TECNICO` | Perfil não habilitado para o portal técnico |
| 403 | `TOTEM_OBRIGATORIO` | Perfil que só pode entrar por totem |
| 429 | `CONTA_BLOQUEADA_TEMPORARIAMENTE` | Matrícula bloqueada após 5 falhas (15 min); inclui `Retry-After` |

**Sessão de totem inválida** (`401 SESSAO_TOTEM_INVALIDA`): retornada em qualquer rota protegida quando o `X-Totem-Id` não confere com o token, a duração do token é inválida ou o totem foi revogado.

---

## 3. Eventos em tempo real (SSE)

| Método | Caminho | Acesso | Descrição |
|---|---|---|---|
| POST | `/eventos/ticket` | Perfis: TECNICO, GERENTE, ADMIN (30/min) | Emite ticket de uso único, válido por 30 s |
| GET | `/eventos?ticket=<ticket>` | Ticket (20/min) | Stream SSE de eventos de OM |

O `EventSource` do navegador não envia cabeçalho `Authorization`, por isso o fluxo é: obter o ticket com o JWT e abrir o stream com o ticket na query. Um ticket usado uma vez não é aceito de novo.

**Tipos de evento publicados** (`apps/api/src/events.ts`): `om.criada`, `om.assumida`, `om.delegada`, `om.delegacao_cancelada`, `om.recusada`, `om.liberada`, `om.reserva_aviso`, `om.reserva_expirada`, `om.play`, `om.pause`, `om.concluida`, `om.aprovada`, `om.encerrada`, `om.reprovada`, `om.nota`, `om.material`, `om.apontamento` e `om.teste`. Os eventos de OM trazem `ordemId` e `statusKanban`.

```bash
TICKET=$(curl -s -X POST https://localhost:4000/eventos/ticket \
  -H "Authorization: Bearer $TOKEN" | jq -r .ticket)
curl -N "https://localhost:4000/eventos?ticket=$TICKET"
```

---

## 4. Configuração pública

| Método | Caminho | Acesso | Descrição |
|---|---|---|---|
| GET | `/config/publica` | Público (60/min) | Parâmetros mínimos para o totem em repouso |

---

## 5. Ordens de manutenção

### 5.1 Criação e consulta

| Método | Caminho | Acesso | Descrição |
|---|---|---|---|
| POST | `/ordens` | JWT | Abre uma OM. O solicitante é o usuário do token. |
| GET | `/ordens` | JWT (OPERADOR e LIDER exigem `equipamentoId`) | Lista OMs com filtros e paginação |
| GET | `/ordens/:id` | JWT | Detalhe da OM |
| GET | `/ordens/:id/historico` | Perfis: TECNICO, GERENTE, ADMIN | Histórico de transições de status |
| GET | `/ordens/:id/ficha.pdf` | Perfis: TECNICO, GERENTE, ADMIN (20/min) | Ficha de manutenção em PDF A4 |
| POST | `/ordens/:id/notas` | JWT | Adiciona nota à OM (bloqueado em OM concluída ou cancelada) |
| GET | `/ordens/:id/notas` | JWT | Lista as notas da OM |

**Filtros de `GET /ordens`:** `status`, `equipamentoId`, `localDescricao`, `itemDescricao`, `setor`, `prioridade` (`BAIXA`, `MEDIA`, `ALTA`, `CRITICA`), `busca` (número da OM, título, TAG ou nome do equipamento). A paginação usa `limit` e `cursor` (cursor opaco) e devolve `X-Next-Cursor`; a contagem total vem em `X-Total-Count` quando disponível.

**Campos principais de `POST /ordens`** (o corpo é `.strict()`: campos não previstos são rejeitados):

| Campo | Obrigatório | Observação |
|---|:-:|---|
| `equipamentoId` | Sim | ID do equipamento ativo |
| `maquinaParada` | Sim | Define a severidade da OM (RN-03) |
| `categoria` | Sim | `MECANICO`, `ELETRICO`, `PNEUMATICO_HIDRAULICO`, `INSTRUMENTACAO`, `SEGURANCA`, `CIVIL_PREDIAL` ou `OUTROS` |
| `sintomas` | Sim | Lista de 1 a 10 textos, cada um de até 80 caracteres, sem `;` |
| `tipoAtivo` | Não | `MOLDE`, `MAQUINA`, `ROBO` ou `OUTRO`; se omitido, é derivado do grupo do equipamento |
| `tipoAtivoOutro` | Se `tipoAtivo` = `OUTRO` | Até 30 caracteres |
| `localDescricao` | Se o equipamento for predial | Texto livre |
| `itemDescricao` | Se o equipamento for item livre | Texto do pseudo-ativo OUTROS |
| `observacao` | Não | Até 250 caracteres |
| `totemIdOrigem` | Não | Identificador do totem ou posto de origem |
| `confirmarDuplicidade` | Não | `true` confirma a abertura quando já existe OM semelhante aberta (RN-04) |

O custo não é definido na abertura (campos `custoTipo` e `tipoCusto` são aceitos por compatibilidade e descartados); ele é informado no encerramento.

```bash
curl -s -X POST https://localhost:4000/ordens \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
        "equipamentoId": 42,
        "maquinaParada": true,
        "categoria": "MECANICO",
        "sintomas": ["Vazamento de óleo", "Ruído no rolamento"],
        "observacao": "Vazamento visível no cilindro"
      }'
```

> O corpo não aceita `solicitanteId`; ele é sempre obtido do token.

### 5.2 Atendimento (Kanban do técnico)

| Método | Caminho | Acesso | Descrição |
|---|---|---|---|
| GET | `/ordens/fila` | Perfis: TECNICO, GERENTE, ADMIN | Dados do Kanban de atendimento (OMs abertas, reservadas, em execução, pausadas e aguardando aprovação ou baixa) |
| POST | `/ordens/:id/assumir` | Perfis: TECNICO, GERENTE, ADMIN (15/min) | Assume a OM. Exige o PIN do próprio usuário, verificado somente depois da checagem de permissão. |
| POST | `/ordens/:id/atribuir` | Perfis: GERENTE, ADMIN | Delega a OM a um técnico (status `RESERVADA`) |
| POST | `/ordens/:id/recusar` | Perfis: TECNICO, GERENTE, ADMIN | Recusa a OM delegada (volta a `ABERTA` com motivo) |
| POST | `/ordens/:id/cancelar-delegacao` | Perfis: GERENTE, ADMIN | Cancela a delegação e devolve a OM para `ABERTA` |
| GET | `/ordens/devolvidas` | Perfis: GERENTE, ADMIN | OMs recusadas ou devolvidas |
| POST | `/ordens/:id/play` | Perfis: TECNICO, GERENTE, ADMIN | Retoma a OM pausada |
| POST | `/ordens/:id/pause` | Perfis: TECNICO, GERENTE, ADMIN | Pausa a OM com motivo pré-definido |
| POST | `/ordens/:id/concluir` | Perfis: TECNICO, GERENTE, ADMIN | Envia a OM para aprovação (`AGUARDANDO_APROVACAO`) |

**Motivos de pausa:** `AGUARDANDO_PECA`, `AGUARDANDO_PRODUCAO`, `REFEICAO`, `TROCA_TURNO`, `AGUARDANDO_SUPORTE`, `OUTRO`. O motivo `OUTRO` exige o campo `detalhe`.

```bash
curl -s -X POST https://localhost:4000/ordens/1001/pause \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"motivo": "AGUARDANDO_PECA", "detalhe": "Rolamento 6205 em falta"}'
```

### 5.3 Aprovação e encerramento

| Método | Caminho | Acesso | Descrição |
|---|---|---|---|
| GET | `/ordens/aprovacoes` | Perfis: OPERADOR, LIDER_PRODUCAO, ADMIN | OMs aguardando aprovação (OPERADOR vê apenas as que abriu) |
| POST | `/ordens/:id/aprovar` | Perfis: OPERADOR, LIDER_PRODUCAO, ADMIN (15/min) | Aprova (`AGUARDANDO_BAIXA`). Exige PIN. |
| POST | `/ordens/:id/reprovar` | Perfis: OPERADOR, LIDER_PRODUCAO, ADMIN (15/min) | Reprova com `motivo` (volta a `EM_ANDAMENTO`). Exige PIN. |
| GET | `/ordens/conclusoes-pendentes` | Perfis: GERENTE, ADMIN | OMs aguardando baixa final |
| POST | `/ordens/:id/encerrar` | Perfis: GERENTE, ADMIN (15/min) | Conclui a OM (`CONCLUIDA`). Exige PIN. |

Regras de decisão (quem executou não decide, LIDER só após o prazo para OMs de operadores): ver [SECURITY_RBAC.md, seção 2.1.1](SECURITY_RBAC.md#211-regras-de-aprovação).

```bash
curl -s -X POST https://localhost:4000/ordens/1001/aprovar \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pin": "1234"}'
```

---

## 6. Apontamentos, materiais e testes (ficha)

| Método | Caminho | Acesso | Descrição |
|---|---|---|---|
Todas as rotas desta seção exigem perfil TECNICO, GERENTE ou ADMIN (o mesmo conjunto de `soTecnico`), exceto as de leitura, que usam `painelManutencao` (mesmo conjunto).

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/ordens/:id/apontamentos` | Lista apontamentos de tempo |
| POST | `/ordens/:id/apontamentos` | Lança apontamento (cronômetro ou retroativo) |
| DELETE | `/ordens/:id/apontamentos/:apId` | Exclui apontamento com `motivo` (3 a 250 caracteres); registra quem excluiu |
| GET | `/ordens/:id/testes-qualidade` | Lista testes de qualidade |
| POST | `/ordens/:id/testes-qualidade` | Cria teste de qualidade |
| PATCH | `/ordens/:id/testes-qualidade/:itemId` | Atualiza item de teste de qualidade |
| DELETE | `/ordens/:id/testes-qualidade/:itemId` | Exclui item de teste de qualidade |
| GET | `/ordens/:id/testes-producao` | Lista testes de produção |
| POST | `/ordens/:id/testes-producao` | Cria teste de produção |
| PATCH | `/ordens/:id/testes-producao/:itemId` | Atualiza item de teste de produção |
| DELETE | `/ordens/:id/testes-producao/:itemId` | Exclui item de teste de produção |
| GET | `/ordens/:id/materiais` | Lista materiais utilizados |
| POST | `/ordens/:id/materiais` | Registra material utilizado |
| DELETE | `/ordens/:id/materiais/:materialId` | Remove material registrado |

> A edição da ficha só é permitida enquanto a OM está em `EM_ANDAMENTO`, `PAUSADA` ou `AGUARDANDO_PECA`. Testes de qualidade também podem ser editados em `AGUARDANDO_APROVACAO`. Materiais não podem ser alterados em OM concluída, cancelada, aguardando aprovação ou aguardando baixa.

**Formas aceitas de apontamento** (corpo de `POST /ordens/:id/apontamentos`):

- Grade da ficha: `data` (AAAA-MM-DD) + `horaInicio` + `horaFim` (HH:MM, horário local).
- Instantes com fuso: `inicio` + `fim` (ISO 8601 com offset).
- Lançamentos retroativos exigem `justificativa` (ou `observacao`/`obsCod`), de 1 a 250 caracteres. A janela de retroativos é limitada pela política configurada (`RETROATIVO_MAX_DIAS`, padrão 30).

```bash
curl -s -X POST https://localhost:4000/ordens/1001/apontamentos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"inicio": "2026-11-12T08:00:00-03:00", "fim": "2026-11-12T09:30:00-03:00", "justificativa": "Lançado após o turno"}'
```

---

## 7. Equipamentos

| Método | Caminho | Acesso | Descrição |
|---|---|---|---|
| GET | `/equipamentos` | JWT | Lista equipamentos |
| GET | `/equipamentos/grupos` | JWT | Grupos de ativos (macro-categorias do totem) |
| GET | `/equipamentos/locais` | JWT | Locais de equipamentos prediais |
| GET | `/equipamentos/setores` | JWT | Setores disponíveis |
| GET | `/equipamentos/:ref` | JWT | Detalhe de equipamento ativo, por ID numérico ou por TAG (sem diferenciar maiúsculas) |
| PUT | `/equipamentos/:id` | Perfis: ADMIN | Atualiza equipamento |
| DELETE | `/equipamentos/:id` | Perfis: ADMIN | Exclui equipamento. Se houver OMs vinculadas, retorna `409 EQUIPAMENTO_COM_HISTORICO`: nesse caso, inative a máquina. |

---

## 8. Setores, máquinas e grupos (administração)

| Método | Caminho | Acesso | Descrição |
|---|---|---|---|
| GET | `/setores` | Perfis: ADMIN | Lista setores |
| GET | `/setores/opcoes` | Perfis: GERENTE, ADMIN | Opções de setor para formulários |
| POST | `/setores` | Perfis: ADMIN | Cria setor |
| PUT | `/setores/:id` | Perfis: ADMIN | Atualiza setor |
| DELETE | `/setores/:id` | Perfis: ADMIN | Remove setor |
| GET | `/setores/:id/locais` | Perfis: ADMIN | Lista locais do setor |
| POST | `/setores/:id/locais` | Perfis: ADMIN | Cria local |
| PUT | `/setores/:id/locais/ordem` | Perfis: ADMIN | Reordena locais |
| PUT | `/setores/:id/locais/:localId` | Perfis: ADMIN | Atualiza local |
| DELETE | `/setores/:id/locais/:localId` | Perfis: ADMIN | Remove local |
| GET | `/setores/:id/equipamentos` | Perfis: ADMIN | Máquinas do setor |
| POST | `/setores/:id/equipamentos` | Perfis: ADMIN | Cadastra máquina no setor |
| GET | `/grupos-ativos` | Perfis: ADMIN | Lista grupos de ativos |
| PUT | `/grupos-ativos/:id` | Perfis: ADMIN | Atualiza grupo de ativos |
| GET | `/grupos-ativos/:id/equipamentos` | Perfis: ADMIN | Equipamentos do grupo |
| POST | `/grupos-ativos/:id/equipamentos` | Perfis: ADMIN | Cadastra equipamento no grupo |

---

## 9. Usuários

Todas as rotas exigem perfil ADMIN.

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/usuarios` | Lista usuários (nunca retorna `pin_hash` nem `senha_hash`) |
| POST | `/usuarios` | Cria usuário |
| PUT | `/usuarios/:id` | Atualiza dados e perfil. Protegido contra auto-rebaixamento e contra remoção do último ADMIN. |
| DELETE | `/usuarios/:id` | Exclui usuário (30 por minuto). Bloqueia a auto-exclusão (`409 AUTO_EXCLUSAO`) e a remoção do último ADMIN ativo. |
| PUT | `/usuarios/:id/credenciais` | Define o PIN do usuário (4 a 6 dígitos) (30/min) |
| POST | `/usuarios/:id/desbloquear` | Limpa o bloqueio de PIN da matrícula do usuário e registra auditoria. Resposta `204`. |
| GET | `/usuarios/tecnicos` | Lista técnicos para delegação. Perfis: GERENTE, ADMIN. |

---

## 10. Configurações e e-mail

Todas as rotas exigem perfil ADMIN.

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/configuracoes` | Lista configurações globais (segredos são mascarados) |
| PUT | `/configuracoes/:chave` | Altera uma configuração |
| POST | `/configuracoes/email/teste` | Envia e-mail de teste (5/min) |

---

## 11. Indicadores e desempenho

Perfis: GERENTE e ADMIN.

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/metricas/kpis` | KPIs do período |
| GET | `/metricas/meta` | Metas e zonas de atendimento |
| GET | `/metricas/equipe` | Desempenho por técnico |
| GET | `/metricas/backlog` | Backlog de OMs abertas |
| GET | `/metricas/atencao` | Até 5 alertas: crítica sem responsável, reserva sem aceite e OM aberta há mais de 8 horas |
| GET | `/metricas/mttr` | Tempo médio de reparo |
| GET | `/metricas/ofensores` | Equipamentos com mais ocorrências |
| GET | `/metricas/pausas` | Análise de pausas por motivo |

---

## 12. Auditoria

| Método | Caminho | Acesso | Descrição |
|---|---|---|---|
| GET | `/auditoria` | Perfis: ADMIN | Consulta a trilha de auditoria por período (`de`, `ate`; padrão: últimos 7 dias), com paginação por `cursor` ou `offset` (não os dois) |

---

## 13. Códigos de erro recorrentes

| HTTP | `error` | Significado |
|---|---|---|
| 400 | `VALIDACAO` | Corpo ou parâmetros inválidos (detalhes por campo) |
| 401 | `NAO_AUTENTICADO` | Sessão ausente, inválida ou expirada |
| 401 | `SESSAO_TOTEM_INVALIDA` | Sessão de totem não confere com o dispositivo |
| 401 | `PIN_INVALIDO` | PIN incorreto em ação que exige reconfirmação |
| 403 | `ACESSO_NEGADO` | Perfil sem permissão para a ação |
| 403 | `FILTRO_OBRIGATORIO` | Listagem exige `equipamentoId` para o perfil |
| 403 | `AUTOAPROVACAO_PROIBIDA` | Quem executou a OM tentou decidir sobre ela |
| 403 | `AGUARDE_OPERADOR` | LIDER tentou decidir antes do prazo |
| 404 | `OM_NAO_ENCONTRADA` | OM inexistente |
| 409 | `OM_NAO_DISPONIVEL` | OM mudou de status durante a requisição (corrida) |
| 409 | `STATUS_INVALIDO` | Transição não permitida no status atual |
| 409 | `OM_ENCERRADA` | Ação em OM concluída ou cancelada |
| 409 | `AUTO_REBAIXAMENTO` | Tentativa de desativar ou rebaixar o próprio ADMIN |
| 409 | `AUTO_EXCLUSAO` | Tentativa de excluir o próprio usuário |
| 409 | `EQUIPAMENTO_COM_HISTORICO` | Máquina com OMs vinculadas; deve ser inativada |
| 409 | `ULTIMO_ADMIN` | Operação deixaria o sistema sem ADMIN ativo |
| 429 | `CONTA_BLOQUEADA_TEMPORARIAMENTE` | Muitas tentativas de PIN |
| 429 | (genérico) | Limite de requisições excedido (`Retry-After`) |
| 500 | `ERRO_INTERNO` | Erro interno (sem detalhes ao cliente) |

> Os códigos acima são os principais. As rotas podem retornar outros códigos específicos do domínio (por exemplo, `SETOR_NAO_ENCONTRADO`, `EQUIPAMENTO_NAO_ENCONTRADO`); consulte o código da rota para o conjunto completo.
