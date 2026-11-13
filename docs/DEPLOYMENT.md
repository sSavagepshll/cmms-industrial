# Guia de deploy

Este guia descreve como colocar o CMMS Industrial em execução em um servidor Linux com Docker, com TLS. Ele separa o que o repositório já faz do que deve ser decidido pela equipe de infraestrutura.

> **Importante:** o `docker-compose.yml` da raiz foi escrito para **desenvolvimento**. A API roda `npm run dev` (`tsx watch`) e a web roda `next dev`. Para produção, use as recomendações da seção 5.

> ⚠️ **Aviso de produção.** O `up` padrão carrega a demonstração: cinco usuários com PIN público `1234` (`db/seed_portfolio.sql`) e dados fictícios. Antes de um uso real:
> 1. Desligue a carga de demonstração com `SEED_PORTFOLIO=false` no `.env`, ou troque as contas demo (seção 5.6).
> 2. Gere certificados TLS próprios (seção 3).
> 3. Troque `JWT_SECRET` e `POSTGRES_PASSWORD`.
> 4. Faça o bootstrap do administrador (seção 6), sem depender das contas demo.

---

## 1. Pré-requisitos

| Item | Mínimo recomendado |
|---|---|
| Sistema operacional | Linux com systemd (Debian, Ubuntu ou similar) |
| Docker Engine | 24 ou superior |
| Docker Compose | Plugin v2 (`docker compose`) |
| Memória | 4 GB |
| Disco | 20 GB livres (banco, imagens e logs) |
| Rede | Porta 443 (ou as portas configuradas) acessível pela rede dos totens e dos painéis |
| Certificado TLS | Certificado para o nome de host usado pelos totens (ver seção 3) |

Instale o Docker seguindo a documentação oficial da distribuição. Depois, confirme:

```bash
docker --version
docker compose version
```

---

## 2. Obter o código e configurar o ambiente

```bash
git clone <url-do-repositorio> cmms-industrial-portfolio
cd cmms-industrial-portfolio

cp -n .env.example .env
```

Edite o `.env` e defina, no mínimo:

| Variável | Obrigatória | Descrição |
|---|:-:|---|
| `JWT_SECRET` | Sim | Segredo de assinatura dos tokens, com **pelo menos 32 caracteres**. Gere com `openssl rand -base64 48`. |
| `CONFIG_ENCRYPTION_KEY` | Recomendada | Chave que cifra segredos guardados no banco (ex.: senha SMTP), com pelo menos 32 caracteres. Se vazia, é derivada do `JWT_SECRET`. |
| `POSTGRES_PASSWORD` | Sim | Senha do banco. O padrão `troque_esta_senha` é apenas para desenvolvimento. |
| `CORS_ORIGIN` | Sim | Origens do front, separadas por vírgula, por exemplo `https://cmms.exemplo.local`. |
| `NEXT_PUBLIC_API_URL` | Sim | URL da API **como o navegador a enxerga**, por exemplo `https://cmms.exemplo.local:4000`. |
| `API_INTERNAL_URL` | Sim | URL da API dentro da rede do compose (padrão `https://api:4000`). |
| `TOTENS_AUTORIZADOS` | Recomendada | Lista de Device IDs de totens autorizados. Vazia = sem restrição. |
| `TOTEM_OBRIGATORIO_PERFIS` | Recomendada | Perfis que só podem entrar por totem cadastrado. |
| `TOTEM_PERFIS_PERMITIDOS` | Não | Padrão: `OPERADOR,LIDER_PRODUCAO,ADMIN`. |
| `SSL_KEY_PATH`, `SSL_CERT_PATH` | Sim (TLS) | Caminhos **dentro do contêiner** da API. Padrão: `/certs/key.pem` e `/certs/cert.pem`. |
| `EMAIL_REMETENTE_NOME` | Não | Nome exibido como remetente dos e-mails. |
| `SEED_PORTFOLIO` | Não | Padrão `true`: carrega `db/seed_portfolio.sql` (contas demo com PIN `1234`). Com `false`, a carga é ignorada no `docker compose up -d` (seção 5.6). |
| `NEXT_PUBLIC_API_URL` | Sim | Sem certificados, use `http://localhost:4000` (o padrão do compose é HTTPS). |

Valores de `.env` com caracteres especiais devem ser entre aspas quando necessário.

---

## 3. Certificado TLS

A API e a web só sobem em HTTPS quando `SSL_KEY_PATH` e `SSL_CERT_PATH` apontam para arquivos existentes. Caso contrário, a API inicia em HTTP e registra um aviso no log.

Os arquivos devem estar na pasta `certs/` da raiz, que é montada como `/certs` (somente leitura) nos contêineres da API e da web. Os `*.pem` estão no `.gitignore` e não vão ao Git; apenas `certs/openssl.cnf` é versionado, como modelo.

### 3.1 Certificado autoassinado (rede interna, testes)

Use `certs/openssl.cnf` como modelo. Antes de gerar, edite a seção `[dn]` (campo `CN`) e a seção `[alt_names]` (`DNS.*` e `IP.*`) para o nome de host e o IP que os totens e navegadores usarão:

```bash
openssl req -x509 -config certs/openssl.cnf -extensions v3_req \
  -newkey rsa:2048 -sha256 -days 825 -nodes \
  -keyout certs/key.pem -out certs/cert.pem
chmod 600 certs/key.pem
```

Depois, reinicie a API e a web (`docker compose up -d`). Os dispositivos precisarão confiar nesse certificado (instalar a CA interna) para não exibir aviso.

Os totens e os navegadores precisarão confiar nesse certificado (instalar a CA interna no dispositivo) para não exibir aviso.

### 3.2 Certificado de uma autoridade confiável

Para produção, use um certificado emitido por uma CA pública ou pela CA interna da organização, para o nome de host que os totens acessam. Copie `fullchain.pem` para `certs/cert.pem` e a chave privada para `certs/key.pem`. Não versione a chave privada.

---

## 4. Subir o sistema

```bash
docker compose up -d
docker compose ps
```

A ordem de inicialização é controlada pelo compose:

1. `db` (PostgreSQL 16): aguarda o `pg_isready`.
2. `migrate`: executa `db/migrate.sh`, que aplica as migrations `V001` a `V029` de `db/migrations/` em ordem, registra cada uma em `schema_migrations`, executa `db/seed.sql` (administrador inicial) e `db/seed_portfolio.sql` (contas demo, equipamentos e OMs fictícias). Sai com código 0 em caso de sucesso.
3. `api`: só inicia depois que `migrate` concluir com sucesso.
4. `web`: inicia depois da `api`.

Verifique a saúde da API:

```bash
curl -sk https://localhost:4000/health/ready
docker compose logs --tail=50 migrate
docker compose logs --tail=50 api
```

> A opção `-k` ignora a validação do certificado e deve ser usada apenas para testes com certificado autoassinado.

### 4.1 Migrations

- Cada arquivo em `db/migrations/` é aplicado uma única vez.
- O `migrate.sh` compara o checksum de cada arquivo já aplicado. Se um arquivo **foi alterado** após ser aplicado, a execução falha com erro. Para mudar o schema, crie uma nova versão (`V030__...sql`) em vez de editar uma existente.
- Rodar `docker compose up` de novo é seguro: migrations já aplicadas são ignoradas.

### 4.2 Reexecução dos seeds

Os seeds rodam **a cada `up`**. O comportamento de cada um:

| Carga | Comportamento ao repetir |
|---|---|
| `db/seed.sql` | Insere o administrador apenas se `admin@om.com.br` não existir. |
| `db/seed_portfolio.sql`, usuários demo | `ON CONFLICT (matricula) DO NOTHING`: PINs já alterados são preservados. |
| `db/seed_portfolio.sql`, equipamentos | `ON CONFLICT (codigo) DO UPDATE`: **os dados demo de equipamentos são sobrescritos a cada `up`**. |
| `db/seed_portfolio.sql`, OMs e notas | Inserções com `WHERE NOT EXISTS`: não são duplicadas. |

Portanto, não edite equipamentos demo esperando que a alteração persista.

---

## 5. Recomendações para produção

Os itens abaixo **não** estão no `docker-compose.yml` atual e precisam ser aplicados pela equipe antes de um uso produtivo.

### 5.1 Comandos de produção

| Serviço | Desenvolvimento (atual) | Produção (recomendado) |
|---|---|---|
| API | `npm install && npm run dev` | `npm ci`, `npm run build`, `npm start` (executa `node dist/server.js`) |
| Web | `npm install && npm run dev` | `npm ci`, `npm run build`, `npm start` (o script já usa `-H 0.0.0.0 -p 3000`) |

Crie um arquivo `docker-compose.prod.yml` com esses comandos e com volumes de código somente leitura, e suba com:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### 5.2 Reverso e TLS na borda

- Use um proxy reverso (Nginx, Caddy ou Traefik) na frente da web e da API, com o certificado público.
- Se o proxy estiver na frente da API, defina `TRUST_PROXY=true` para que o IP real do cliente seja usado no rate limit e nos logs. Só faça isso quando **somente** o proxy puder alcançar a API.
- Mantenha o HSTS habilitado (já configurado nos headers da API e da web).

### 5.3 Rede e exposição

- O PostgreSQL já é publicado apenas em `127.0.0.1`. Não altere essa configuração.
- Exponha apenas as portas da web e da API (ou apenas a porta do proxy).
- Restrinja o acesso aos painéis `/admin` e à API de administração por rede, quando possível.
- Configure o firewall do host para aceitar somente as portas necessárias.

### 5.4 Backup do banco

O repositório não traz rotina de backup. Um mínimo recomendado é um `pg_dump` diário, com retenção e teste periódico de restauração:

```bash
docker compose exec -T db pg_dump -U om_user -d ordens_manutencao -Fc > backup-$(date +%F).dump
```

Guarde os backups fora do servidor. Teste a restauração em outro ambiente antes de depender deles.

### 5.5 Limitações de instância única

Os seguintes mecanismos são **em memória** e exigem uma única instância da API:

- Bloqueio de PIN por matrícula.
- Barramento de eventos do Kanban (SSE).

Para escalar horizontalmente, esses pontos precisam ser migrados (ver [ARCHITECTURE.md](ARCHITECTURE.md#6-decisões-técnicas)).

---

### 5.6 Desligar a carga de demonstração

Para não carregar `db/seed_portfolio.sql`, defina no `.env`:

```
SEED_PORTFOLIO=false
```

Depois, suba normalmente com `docker compose up -d`. O serviço `migrate` repassa a variável ao `migrate.sh`, que pula a carga demo. O padrão é `true`.

Para confirmar que a variável chega ao serviço `migrate`, use `docker compose config | grep SEED_PORTFOLIO`. A linha `SEED_PORTFOLIO: ${SEED_PORTFOLIO:-true}` aparece no bloco `environment` do serviço `migrate`.

Se a carga demo já foi aplicada antes, desligar o flag não remove as contas. Use uma destas alternativas:

- **Trocar as contas demo.** Defina um PIN novo para cada matrícula com `PUT /usuarios/:id/credenciais`, pelo painel de um ADMIN.
- **Desativar as contas demo.** Faça pelo painel (`PUT /usuarios/:id`), e não por SQL direto: a API impede desativar o último ADMIN ativo, e uma alteração direta no banco não tem essa proteção. Antes de desativar a conta `999999`, crie e teste outro ADMIN.

Lembre que a carga de equipamentos demo é sobrescrita a cada `up` enquanto o flag estiver `true` (seção 4.2).

## 6. Primeiro acesso: administrador

Esta seção vale para **produção**, sem carga de demonstração. O `db/seed.sql` cria o usuário `admin@om.com.br` (perfil ADMIN), **sem matrícula e sem PIN**. Como o login é feito por PIN, é preciso definir esses dados diretamente no banco na primeira vez.

Com a carga de demonstração, o ADMIN `999999` (PIN `1234`) já entra, mas **troque esse PIN antes de qualquer uso real**.

### 6.1 Gerar o hash do PIN

O PIN deve ter de 4 a 6 dígitos. O hash é gerado pelo script da API (nunca grave o PIN em texto puro):

```bash
docker compose exec api npm run hash-pin -- 4821
```

O comando imprime um valor no formato `scrypt$32768$8$1$...`. Copie-o.

### 6.2 Gravar matrícula e PIN

Escolha uma matrícula que ainda não exista (até 30 caracteres, única). Substitua `<HASH>` pelo valor do passo anterior:

```bash
docker compose exec db psql -U om_user -d ordens_manutencao -c \
  "UPDATE usuarios SET matricula = '000001', pin_hash = '<HASH>' WHERE email = 'admin@om.com.br';"
```

### 6.3 Entrar e trocar credenciais

1. Acesse o painel (`/admin`) e entre com a matrícula `000001` e o PIN definido.
2. Crie os usuários reais pela tela de **Usuários** (ou por `POST /usuarios`).
3. Defina os PINs deles (`PUT /usuarios/:id/credenciais`).
4. Desative ou troque o PIN do administrador inicial, se ele não for mais necessário.

> Se o ADMIN errar o PIN cinco vezes, a matrícula fica bloqueada por 15 minutos. O bloqueio é apagado com `POST /usuarios/:id/desbloquear` por outro ADMIN, ou pelo reinício da API (o contador fica em memória).

---

## 7. Cadastro de totens

1. Cadastre o Device ID de cada totem em `TOTENS_AUTORIZADOS` (no `.env`) e reinicie a API:

   ```bash
   docker compose up -d api
   ```

2. Configure o navegador do totem para abrir a web em modo tela cheia, com o `NEXT_PUBLIC_TOTEM_ID` correspondente.
3. Teste o login de um operador no totem. A sessão expira após `KIOSK_TOKEN_TTL_S` segundos (padrão 900) e não é renovada: o operador faz login de novo.

---

## 8. Operação do dia a dia

| Tarefa | Comando |
|---|---|
| Ver logs da API | `docker compose logs -f api` |
| Ver logs da web | `docker compose logs -f web` |
| Ver estado dos serviços | `docker compose ps` |
| Reiniciar um serviço | `docker compose restart api` |
| Aplicar mudança de `.env` | `docker compose up -d` (recria os contêineres afetados) |
| Métricas Prometheus | `curl -sk https://localhost:4000/metrics` |
| Verificar a fila de e-mails | `docker compose exec db psql -U om_user -d ordens_manutencao -c "SELECT status, count(*) FROM outbox_email GROUP BY status;"` |

Os estados da fila de e-mail estão descritos em [ARCHITECTURE.md, seção 3](ARCHITECTURE.md#3-transactional-outbox-para-e-mail). Linhas em `MORTO` indicam falha permanente ou tentativas esgotadas e merecem investigação.

---

## 9. Atualização

```bash
git pull
docker compose up -d --build
docker compose logs --tail=50 migrate
```

Antes de atualizar, faça um backup do banco (seção 5.4). Leia o histórico de commits e as migrations novas antes de aplicar em produção.

---

## 10. Solução de problemas

| Sintoma | Causa provável | Ação |
|---|---|---|
| `migrate` sai com erro de checksum | Migration já aplicada foi editada | Restaure o arquivo original e crie uma nova versão |
| API não sobe e loga `JWT_SECRET deve ter ao menos 32 caracteres` | Segredo curto ou ausente | Ajuste o `.env` e recrie o contêiner |
| API responde em HTTP mesmo com certificado | Caminhos de `SSL_KEY_PATH`/`SSL_CERT_PATH` incorretos ou arquivos ausentes | Confira `certs/` e os caminhos dentro do contêiner |
| Totem recebe `TOTEM_NAO_AUTORIZADO` | Device ID fora de `TOTENS_AUTORIZADOS` | Inclua o ID e reinicie a API |
| Totem recebe `SESSAO_TOTEM_INVALIDA` | Token reutilizado em outro dispositivo, ou sessão expirada | Faça login de novo no totem |
| Navegador bloqueia chamadas à API | Origem não listada em `CORS_ORIGIN` | Inclua a origem e reinicie a API |
| E-mails não chegam | SMTP mal configurado ou fila em `MORTO` | Verifique as configurações de e-mail e a tabela `outbox_email` |
| Ficha em PDF não é gerada | Timeout de renderização | Aumente `FICHA_PDF_TIMEOUT_MS` e verifique a carga do servidor |
| Login demo falha com `CREDENCIAIS_INVALIDAS` | `seed_portfolio.sql` não foi executado, ou um erro de SQL interrompeu o `migrate` | Veja `docker compose logs migrate`; confirme as matrículas com `SELECT matricula, perfil FROM usuarios;` |
| Navegador tenta `https://` e falha sem `certs/` | `NEXT_PUBLIC_API_URL` continua apontando para HTTPS | Defina `NEXT_PUBLIC_API_URL=http://localhost:4000` ou gere os certificados (seção 3) |
