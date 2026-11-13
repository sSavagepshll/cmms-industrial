# CMMS Industrial — Gestão de Ordens de Manutenção

![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-React-000000?logo=next.js&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-API-000000?logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

Sistema de **Gerenciamento de Manutenção Assistido por Computador (CMMS)** para chão de fábrica: a abertura de Ordens de Manutenção (OM) acontece em um **totem de autoatendimento**, e o acompanhamento, a execução e a aprovação acontecem em um **Kanban** para técnicos e um **painel de gestão** com indicadores.

> ⚠️ **Aviso de produção.** Este repositório é um portfólio. A carga de demonstração cria usuários com PIN público (`1234`) e dados fictícios. **Não use como está em ambiente real.** Leia a seção [Aviso de produção](#aviso-de-produção) antes de qualquer uso fora de demonstração.

---

## Problema e solução

**Problema.** Em plantas industriais, pedidos de manutenção chegam por telefone, mensagem ou papel. Não há registro confiável de quem pediu, em qual equipamento, quanto tempo levou o atendimento e quais materiais foram usados. Isso dificulta medir MTTR, identificar ofensores e cobrar a conclusão.

**Solução.**

- O operador abre a OM no totem, identifica-se com matrícula e PIN e escolhe o equipamento.
- A OM recebe um número único anual (`OM-AAAA-NNNNNN`) e entra em uma fila visível no Kanban.
- O técnico assume, pausa, registra apontamentos de tempo, materiais e testes, e conclui a OM.
- Um supervisor aprova o atendimento; a OM só é encerrada após a baixa final pelo gestor.
- Cada transição de status é gravada em histórico e auditoria, e a ficha de manutenção pode ser gerada em PDF A4 e enviada por e-mail.

---

## Funcionalidades

### Kiosk-First (totem de autoatendimento)
- Fluxo em etapas (*stepper*): login por PIN, escolha de equipamento, detalhes, observação, revisão e confirmação.
- Teclado numérico para o PIN e teclado virtual para textos (com suporte a teclado físico).
- Sessão de totem com validade **absoluta** (padrão 900 s), sem renovação, vinculada ao Device ID do aparelho.
- Perfis de chão de fábrica entram pelo totem; perfis de gestão e técnicos são direcionados ao painel e ao portal técnico.

### Kanban de atendimento (`/tecnico`)
- Colunas reais: **Abertas**, **Em atendimento**, **Pausadas**, **Aguardando aprovação**, **Aguardando conclusão** e **Concluídas hoje**.
- Pausa com motivo pré-definido (aguardando peça, aguardando produção, aguardando suporte, refeição, troca de turno ou outro, com descrição obrigatória).
- Apontamento de tempo por cronômetro ou retroativo; materiais utilizados; testes de qualidade e de produção.
- Atualização em tempo real por *Server-Sent Events* (SSE), com *polling* de segurança.

### Painel de gestão (`/admin`)
- Dashboard de desempenho da equipe, com KPIs, MTTR, backlog, ofensores e pausas.
- **Modo TV**: período fixo de 7 dias, sem filtros editáveis, em tela cheia, para exibição em painéis no chão de fábrica.
- Fila de atribuição (delegação de OM a um técnico), aprovações, conclusões pendentes e auditoria.
- Exportação de dados em **CSV** para planilhas (auditoria e desempenho), com formatação compatível com o Excel.

### Ficha de Manutenção em PDF A4 (formulário APX-081)
- Gerada a partir de um **snapshot** imutável da OM no momento da ação.
- Layout em folha única A4, com páginas adicionais somente quando há transbordo real de apontamentos ou materiais (até 4 páginas).
- Texto simples: nenhum conteúdo do usuário é interpretado como HTML.
- Enviada como anexo no e-mail de notificação, dentro do limite de tamanho configurado.

### Transactional Outbox para e-mail
- O e-mail é gravado na **mesma transação** da ação de negócio; se a transação falhar, o e-mail não é enfileirado.
- Um consumidor envia com *lease* e `FOR UPDATE SKIP LOCKED`, com retentativas e *backoff* exponencial com jitter.
- Estados: `PENDENTE`, `PROCESSANDO`, `ENVIADO`, `MORTO` e `CANCELADO`.
- Detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Numeração Anual Atômica
- Formato `OM-AAAA-NNNNNN` (ex.: `OM-2026-000042`), com reinício a cada ano civil.
- O ano é calculado no fuso `America/Sao_Paulo`.
- Cada número sai de uma sequência por ano, incrementada dentro da própria transação de criação da OM. Um rollback desfaz o incremento.

### Acessibilidade e uso em campo
- Tema claro e escuro, com alternância pelo usuário.
- Controles com atributos ARIA e navegação por teclado no totem.
- Inatividade controlada: o totem volta à tela inicial após um período sem uso.
- Layout responsivo para telas de totem, tablets e desktop.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js (React, TypeScript, Tailwind CSS) |
| API | Node.js 20, Fastify, Zod, `@fastify/jwt`, `@fastify/helmet`, `@fastify/rate-limit` |
| Banco de dados | PostgreSQL 16 (migrations SQL versionadas + Prisma para o acesso pela API) |
| Autenticação | Matrícula + PIN de 4 a 6 dígitos com scrypt, para todos os perfis; JWT (HS256); bloqueio por tentativas; sessão de totem separada da sessão padrão |
| PDF | PDFKit |
| E-mail | Outbox em PostgreSQL + SMTP |
| Observabilidade | Logs estruturados (Pino), `X-Request-Id`, endpoint `/metrics` no formato Prometheus |
| Infraestrutura | Docker Compose (banco, migrations e seeds, API e web) |

---

## Quickstart

Pré-requisitos: Docker e Docker Compose.

```bash
# 1. Crie o .env a partir do modelo (se ainda não existir)
cp -n .env.example .env

# 2. No .env, defina JWT_SECRET (pelo menos 32 caracteres) e POSTGRES_PASSWORD

# 3. Suba os serviços
docker compose up -d
```

**Certificados TLS.** Os arquivos `certs/*.pem` não são versionados. Sem eles, a API e a web sobem em **HTTP**. Como o compose aponta `NEXT_PUBLIC_API_URL` para HTTPS por padrão, defina no `.env`, antes do `up`:

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Para HTTPS, gere os certificados conforme [docs/DEPLOYMENT.md, seção 3](docs/DEPLOYMENT.md#3-certificado-tls).

Serviços publicados no host:

| Serviço | Endereço padrão |
|---|---|
| Web (totem e painéis) | `http://localhost:3000` (ou `https` com certificados) |
| API | `http://localhost:4000` (ou `https`), com `/health` para verificação |
| PostgreSQL | `127.0.0.1:5432` (somente loopback) |

Ao subir, o serviço `migrate`:

1. aplica as migrations `V001` a `V029` de `db/migrations/`;
2. executa `db/seed.sql`, que cria o administrador `admin@om.com.br` (sem matrícula e sem PIN);
3. executa `db/seed_portfolio.sql`, que cria os **cinco usuários de demonstração** (PIN `1234`), equipamentos e ordens fictícias.

A API só inicia depois que `migrate` concluir com sucesso. Com a carga de demonstração, o login imediato usa as credenciais da tabela abaixo.

---

## Credenciais de demonstração

Criadas por `db/seed_portfolio.sql`. Todos os perfis entram com **matrícula + PIN**:

| Matrícula | PIN | Perfil | Nome | Onde entra |
|---|---|---|---|---|
| `333444` | `1234` | OPERADOR | Carlos Silva | Totem |
| `333333` | `1234` | LIDER_PRODUCAO | Marcos Lima | Totem |
| `222222` | `1234` | TECNICO | Lucas Ferreira | Portal técnico (`/tecnico`) |
| `111111` | `1234` | GERENTE | Roberto Mendes | Painel (`/admin`) |
| `999999` | `1234` | ADMIN | Eduardo Martins | Painel (`/admin`) |

O administrador de `db/seed.sql` (`admin@om.com.br`) não tem PIN e não entra por matrícula; ele serve de base para o [bootstrap de produção](docs/DEPLOYMENT.md#6-primeiro-acesso-administrador).

---

## Autenticação e sessões

- **PIN com scrypt:** o PIN é armazenado como hash scrypt (`N = 2^15`, `r = 8`, `p = 1`, com salt aleatório). Não há login por senha alfanumérica.
- **Bloqueio:** 5 falhas seguidas bloqueiam a matrícula por 15 minutos. Além disso, `/auth/*` aceita 10 tentativas por minuto por IP.
- **Sessão de totem:** quando o login vem de um totem (`totemId`), o token dura 900 segundos no máximo, sem renovação, e só vale no mesmo Device ID.
- **Sessão padrão:** o login pelo painel de `GERENTE` e `ADMIN` dura até 12 horas. Os demais perfis usam a duração padrão de 5 minutos, sem renovação.
- **Reconfirmação:** aceite, aprovação, reprovação e encerramento pedem o PIN de novo.

Detalhes em [docs/SECURITY_RBAC.md](docs/SECURITY_RBAC.md).

---

## Aviso de produção

Antes de usar em ambiente real:

- **Carga de demonstração.** Os cinco usuários com PIN `1234` são públicos. Para não carregar a carga, defina `SEED_PORTFOLIO=false` no `.env` antes do primeiro `up`: isso desativa `db/seed_portfolio.sql`. Ver [docs/DEPLOYMENT.md, seção 5.6](docs/DEPLOYMENT.md#56-desligar-a-carga-de-demonstração).
- **Alternativa.** Troque os PINs das contas demo e crie contas nominais, desativando as de demonstração com cuidado para manter ao menos um ADMIN ativo.
- **Certificados.** Gere certificados TLS próprios, a partir de `certs/openssl.cnf` como modelo (ajuste o nome de host antes), conforme [docs/DEPLOYMENT.md, seção 3](docs/DEPLOYMENT.md#3-certificado-tls).
- **Segredos.** Defina `JWT_SECRET`, `POSTGRES_PASSWORD` e, se possível, `CONFIG_ENCRYPTION_KEY`. Os valores padrão do compose são apenas para desenvolvimento.
- **Modo de execução.** O compose roda a API e a web em modo de desenvolvimento. Para produção, use os comandos de build e start descritos em [docs/DEPLOYMENT.md, seção 5](docs/DEPLOYMENT.md#5-recomendações-para-produção).

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitetura, fluxo de dados, ciclo de vida da OM, outbox e numeração |
| [docs/SECURITY_RBAC.md](docs/SECURITY_RBAC.md) | Matriz de perfis, autenticação, headers, sanitização de CSV e PDF |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Endpoints da API e exigências de perfil |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploy em Linux com Docker, TLS e aviso de produção |

---

## Estrutura do repositório

```
.
├── apps/
│   ├── api/          # API Fastify + Prisma (rotas, autenticação, outbox, PDF)
│   └── web/          # Frontend Next.js (totem, Kanban e painel)
├── db/
│   ├── migrations/   # Migrations SQL versionadas (V001 … V029)
│   ├── migrate.sh    # Runner de migrations e seeds (controle em schema_migrations)
│   ├── seed.sql      # Administrador inicial
│   └── seed_portfolio.sql  # Carga de demonstração (usuários, máquinas e OMs fictícias)
├── certs/            # Certificados TLS (*.pem não versionados; openssl.cnf é o modelo)
├── docs/             # Documentação técnica
└── docker-compose.yml
```
