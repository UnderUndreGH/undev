Ага, понял идею. DevOps-аппа крутится в Docker-контейнере на сервере, и логично, чтобы она видела свой собственный хост как "localhost" сервер без SSH. Нужно разобраться в архитектуре проекта, прежде чем предлагать план.

Давай сначала посмотрю, что за проект и как он устроен.

Ладно, давай прошерстим проект на предмет DevOps Dashboard. Запускаю параллельный поиск по всем направлениям.

Хорошо, нашёл основу. Теперь давай копнём глубже — структуру `devops-app/`, фронтенд-компоненты, Dockerfile, docker-compose, и серверные маршруты.

Теперь прочитаю ключевые файлы параллельно:

Прочитаю ещё несколько ключевых файлов для полноты картины:

Исчерпывающая картина собрана. Вот полный разбор.

---

## DevOps Dashboard -- полная структура приложения

Приложение живёт в [devops-app/](file:///c:/Repositories/underundre/helpers/undev/devops-app). Это self-hosted DevOps-дашборд для управления VPS-серверами, деплоями Docker-приложений, бэкапами, мониторингом здоровья и TLS-сертификатами через браузер.

---

### 1. Корневые конфигурационные файлы

| Файл | Назначение |
|------|-----------|
| [package.json](file:///c:/Repositories/underundre/helpers/undev/devops-app/package.json) | `devops-dashboard` v0.1.0. Скрипты: `dev` (concurrently tsx watch + vite), `build` (vite build + tsc), `start`, `test`, `db:generate`, `db:migrate` |
| [Dockerfile](file:///c:/Repositories/underundre/helpers/undev/devops-app/Dockerfile) | 3-stage multi-stage build: `deps` (npm ci), `build` (vite + tsc), `production` (node:20-alpine, порт 3000) |
| [docker-compose.yml](file:///c:/Repositories/underundre/helpers/undev/devops-app/docker-compose.yml) | 2 сервиса: `devops-db` (postgres:16-alpine) + `dashboard` (app). Внешняя сеть `ai-twins-network` для caddy-docker-proxy |
| [vite.config.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/vite.config.ts) | Vite конфиг для клиента |
| [drizzle.config.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/drizzle.config.ts) | Drizzle ORM конфиг для PostgreSQL |
| [.env.example](file:///c:/Repositories/underundre/helpers/undev/devops-app/.env.example) | Шаблон переменных окружения |

**Стек зависимостей:**

- **Backend**: Express 5, ws (WebSocket), ssh2, drizzle-orm + postgres (porsager), pino, zod, bcrypt, AI SDK (anthropic/openai)
- **Frontend**: React 19, react-router-dom 7, @tanstack/react-query 5, Tailwind CSS 4, Vite 8
- **Тесты**: Vitest 4, Playwright

---

### 2. Dockerfile (multi-stage)

```dockerfile
# Stage 1: deps — npm ci
FROM node:20-alpine AS deps

# Stage 2: build — vite build + tsc
FROM node:20-alpine AS build

# Stage 3: production — node dist/server/index.js
FROM node:20-alpine AS production
# Копирует: node_modules, dist/, migrations, scripts/
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
```

Контекст сборки -- корень репо (`..`), чтобы скопировать `scripts/` для runtime-выполнения через SSH.

---

### 3. docker-compose.yml

```yaml
services:
  devops-db:        # postgres:16-alpine, healthcheck pg_isready
  dashboard:        # app, depends_on devops-db (healthy)
                    # volumes: logs + SSH keys (read-only)
                    # env: DATABASE_URL, DASHBOARD_KEY, DASHBOARD_MASTER_KEY, TELEGRAM_*
networks:
  caddy:            # external: ai-twins-network (для caddy-docker-proxy)
```

---

### 4. Backend (server/)

Точка входа: [server/index.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/index.ts#L1-L347)

**Startup-последовательность:**

1. Auto-migrate (Drizzle)
2. Interrupted deploys cache (blue/green)
3. Deploy-lock pool-safety check
4. Scripts manifest validation
5. Caddy drift cron + orphan cleanup
6. Bootstrap reconciler
7. AI archiver + push dedup
8. Zombie deploy/script_runs triage
9. SSH pool restore from DB
10. Boot checks (master key)
11. Notification preferences seed

**Маршруты (routes/):**

| Файл | Путь | Функционал |
|------|------|-----------|
| [servers.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/servers.ts) | `/api/servers` | CRUD серверов, verify SSH, setup VPS, probe + onboard (feature 011) |
| [apps.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/apps.ts) | `/api/servers/:id/apps`, `/api/apps/:id` | CRUD приложений |
| [deployments.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/deployments.ts) | `/api/apps/:id/deploy`, `/api/deployments` | Deploy, rollback, cancel |
| [docker.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/docker.ts) | `/api/servers/:id/docker` | Docker disk usage, containers list, cleanup (safe/aggressive) |
| [health.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/health.ts) | `/api/servers/:id/health` | Server health snapshots (CPU, RAM, disk, swap, docker containers) |
| [app-health.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/app-health.ts) | `/api/apps/:id/health` | Per-app health monitoring (container/HTTP/cert probes) |
| [backups.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/backups.ts) | `/api/servers/:id/backups` | Database backup/restore |
| [scan.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/scan.ts) | `/api/servers/:id/scan` | Scan server for git repos + Docker apps |
| [bootstrap.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/bootstrap.ts) | `/api/bootstrap` | Bootstrap app from GitHub |
| [blue-green.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/blue-green.ts) | `/api/blue-green` | Blue/green deploy orchestration |
| [domain.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/domain.ts) | `/api/apps/:id/domain` | Domain attach/detach + Caddy config |
| [certs.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/certs.ts) | `/api/certs` | TLS certificate lifecycle |
| [scripts.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/scripts.ts) | `/api/scripts` | Universal script runner manifest |
| [github.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/github.ts) | `/api/github` | GitHub PAT integration |
| [ai-*.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/ai-settings.ts) | `/api/ai/*` | AI Incident Copilot (settings, providers, conversations, tool calls, compose review, spend) |
| [audit.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/audit.ts) | `/api/audit` | Security audit trail |
| [settings.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/settings.ts) | `/api/settings` | Global settings (ACME email, etc.) |

**Ключевые сервисы (services/):**

| Файл | Назначение |
|------|-----------|
| [ssh-pool.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-pool.ts) | SSH connection pool (ssh2). Connect/disconnect/exec/reconnect с retry |
| [ssh-executor.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-executor.ts) | Script runner over SSH |
| [job-manager.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/job-manager.ts) | Async job lifecycle (start, stream, complete) |
| [deploy-lock.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/deploy-lock.ts) | Per-server advisory lock (PostgreSQL) |
| [health-poller.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/health-poller.ts) | Server health polling |
| [app-health-poller.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/app-health-poller.ts) | Per-app health probes |
| [scanner.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/scanner.ts) | Server scan for git repos + Docker compose stacks |
| [server-onboarding.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/server-onboarding.ts) | Zero-touch VPS onboarding (probe, create, compatibility) |
| [blue-green-orchestrator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/blue-green-orchestrator.ts) | Blue/green deploy state machine |
| [caddy-admin-client.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/caddy-admin-client.ts) | Caddy reverse proxy admin API |
| [notifier.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/notifier.ts) | Telegram notifications |
| [ai/incident-analyzer.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ai/incident-analyzer.ts) | AI incident analysis (Anthropic/OpenAI) |

**Probes (services/probes/):**

- [container.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/probes/container.ts) -- `docker inspect` health status
- [http.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/probes/http.ts) -- HTTP endpoint probe
- [cert-expiry.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/probes/cert-expiry.ts) -- TLS cert expiry check
- [caddy-admin.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/probes/caddy-admin.ts) -- Caddy admin API probe

**WebSocket** ([ws/handler.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/ws/handler.ts)): real-time log streaming для деплоев, скриптов, bootstrap.

---

### 5. Database (server/db/)

[schema.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/db/schema.ts) -- Drizzle ORM schema, PostgreSQL 16.

**Основные таблицы:**

- `servers` -- SSH-серверы (host, port, user, auth, status, cloud provider, setup state, AI access)
- `applications` -- приложения на серверах (repo, branch, path, health, domain, TLS, deploy strategy, bootstrap state)
- `deployments` -- история деплоев (status, branch, commit, logs)
- `backups` -- бэкапы БД
- `health_snapshots` -- снимки здоровья серверов (CPU, RAM, disk, swap, docker containers)
- `app_health_probes` -- результаты проб здоровья приложений
- `app_certs` / `app_cert_events` -- TLS-сертификаты и их lifecycle
- `app_bootstrap_events` -- события bootstrap state machine
- `github_connection` -- GitHub PAT (singleton)
- `deploy_locks` -- advisory locks для деплоев
- `script_runs` -- история запусков скриптов
- `audit_log` -- аудит-трейл
- AI-таблицы: `ai_settings`, `ai_providers`, `ai_conversations`, `ai_messages`, `ai_tool_calls`, `ai_spend_log`

**14 миграций** (0000-0014) покрывают эволюцию от начальной схемы до AI Incident Copilot.

---

### 6. Frontend (client/)

Точка входа: [client/App.tsx](file:///c:/Repositories/underundre/helpers/undev/devops-app/client/App.tsx)

**Роутинг (react-router-dom):**

| Путь | Страница | Компонент |
|------|----------|-----------|
| `/` | Dashboard (список серверов) | [DashboardPage](file:///c:/Repositories/underundre/helpers/undev/devops-app/client/pages/DashboardPage.tsx) |
| `/servers/:serverId` | Детали сервера (табы) | [ServerPage](file:///c:/Repositories/underundre/helpers/undev/devops-app/client/pages/ServerPage.tsx) |
| `/apps/:appId` | Детали приложения | [AppPage](file:///c:/Repositories/underundre/helpers/undev/devops-app/client/pages/AppPage.tsx) |
| `/apps/:appId/edit` | Редактирование приложения | [EditAppPage](file:///c:/Repositories/underundre/helpers/undev/devops-app/client/pages/EditAppPage.tsx) |
| `/audit` | Аудит-лог | [AuditPage](file:///c:/Repositories/underundre/helpers/undev/devops-app/client/pages/AuditPage.tsx) |
| `/audit/query` | Аудит-запросы | [AuditQueryPage](file:///c:/Repositories/underundre/helpers/undev/devops-app/client/pages/AuditQueryPage.tsx) |
| `/runs` | Script runs | [RunsPage](file:///c:/Repositories/underundre/helpers/undev/devops-app/client/pages/RunsPage.tsx) |
| `/incidents` | AI-инциденты | [IncidentsListPage](file:///c:/Repositories/underundre/helpers/undev/devops-app/client/pages/IncidentsListPage.tsx) |
| `/settings` | Настройки | [SettingsPage](file:///c:/Repositories/underundre/helpers/undev/devops-app/client/pages/SettingsPage.tsx) |
| `/login` | Авторизация | [LoginPage](file:///c:/Repositories/underundre/helpers/undev/devops-app/client/pages/LoginPage.tsx) |

**ServerPage** -- центральная страница управления сервером. Табы:

- **Apps** -- список приложений с health-агрегатом, bulk delete, scan, bootstrap, migrate, add
- **Scripts** -- universal script runner
- **Health** -- метрики сервера (CPU, RAM, disk, swap)
- **Backups** -- бэкапы БД
- **Logs** -- просмотр логов
- **Docker** -- disk usage, containers, cleanup
- **AI Policy** -- AI access settings per server

**Компоненты (client/components/):**

| Директория | Компоненты |
|-----------|-----------|
| `servers/` | [AddServerForm](file:///c:/Repositories/underundre/helpers/undev/devops-app/client/components/servers/AddServerForm.tsx) (probe-then-onboard flow), CompatibilityReport, InitialiseWizard, SetupWizard |
| `apps/` | AddAppForm, ApplicationDetail, DeployStrategySection, DomainTlsSection, EnvVarsEditor, HealthDot, HealthSparkline, HardDeleteWizard, MigrateExistingAppWizard, и др. |
| `docker/` | [DockerPanel](file:///c:/Repositories/underundre/helpers/undev/devops-app/client/components/docker/DockerPanel.tsx) -- disk usage, container list, safe/aggressive cleanup |
| `deploy/` | DeployLog, BlueGreenDeployLog, BlueGreenPhaseIndicator, DrainCountdown, AbortDuringDrainDialog |
| `health/` | HealthPanel |
| `backups/` | BackupsPanel |
| `logs/` | LogViewer |
| `scan/` | ScanModal, GitCandidateRow, DockerCandidateRow |
| `bootstrap/` | BootstrapWizard, BootstrapHistoryPanel, BootstrapStateBadge, ComposeDetectionView |
| `scripts/` | ScriptsTab, RunDialog, RunDetail |
| `github/` | RepoSearch, BranchSelect, CommitList |
| `ai/` | AnalyzeButton, AiBadge, AiServerPolicySection, ComposeReviewPanel, CostDashboard, HypothesisPanel, IncidentView, KillSwitchBanner, ToolCallApprovalDialog |
| `audit/` | AuditFilters, AuditResults, AuditTable |
| `settings/` | AiSettingsSection, NotificationsSection, SshKeysSection, TlsAcmeSection |
| `layout/` | Layout (sidebar + main content) |

---

### 7. Тесты (tests/)

~60 unit-тестов + ~50 integration-тестов. Покрытие:

- Blue/green deploy (happy path, abort, caddy failure, restart recovery, volume ack)
- Bootstrap (happy path, clone failure, compose failure, hard delete, PAT leak)
- Deploy dispatch, lock, health monitoring
- Scanner (scenarios, perf, dedup)
- Domain attach/detach, cert expiry
- AI tool registry, compose review
- SSH key rotation, envelope cipher

---

### 8. Feature-спецификации (specs/)

Проект развивается через пронумерованные фичи:

| # | Slug | Описание |
|---|------|----------|
| 001 | [devops-app](file:///c:/Repositories/underundre/helpers/undev/specs/001-devops-app/spec.md) | Базовый дашборд: серверы, приложения, деплои, бэкапы, health, Docker |
| 002 | [gh-integration](file:///c:/Repositories/underundre/helpers/undev/specs/002-gh-integration/spec.md) | GitHub PAT интеграция |
| 003 | [scan-for-repos](file:///c:/Repositories/underundre/helpers/undev/specs/003-scan-for-repos/spec.md) | Сканирование сервера на git-репо и Docker-стеки |
| 005 | [universal-script-runner](file:///c:/Repositories/underundre/helpers/undev/specs/005-universal-script-runner/spec.md) | Универсальный запуск скриптов через SSH |
| 011 | [zero-touch-onboarding](file:///c:/Repositories/underundre/helpers/undev/specs/011-zero-touch-onboarding/spec.md) | Zero-touch VPS onboarding (probe, compatibility, auto-setup) |
| 012 | [blue-green-deploy](file:///c:/Repositories/underundre/helpers/undev/specs/012-blue-green-deploy/spec.md) | Blue/green deploy с connection drain |

---

### 9. Скрипты (scripts/)

Bash-скрипты, которые бандлятся в Docker-образ и выполняются через SSH:

- [scripts/deploy/server-deploy.sh](file:///c:/Repositories/underundre/helpers/undev/scripts/deploy/server-deploy.sh) -- основной деплой-скрипт (git fetch, docker compose up, healthcheck, cleanup)
- [scripts/docker/cleanup.sh](file:///c:/Repositories/underundre/helpers/undev/scripts/docker/cleanup.sh) -- Docker cleanup
- `scripts/server/setup-vps.sh` -- bootstrap VPS

---

### Итого: архитектурная схема

```
┌─────────────────────────────────────────────────────┐
│                   Browser (React SPA)                │
│  DashboardPage → ServerPage → AppPage               │
│  Tabs: Apps | Scripts | Health | Backups | Logs | Docker | AI │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP + WebSocket (/ws)
┌──────────────────────▼──────────────────────────────┐
│              Express + ws (Node.js 20)               │
│  Routes: servers, apps, deployments, docker, health  │
│          backups, scan, bootstrap, blue-green, ai    │
│  Services: ssh-pool, job-manager, deploy-lock,       │
│            health-poller, scanner, caddy-admin,      │
│            blue-green-orchestrator, notifier          │
└──────────────────────┬──────────────────────────────┘
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │PostgreSQL│  │ SSH Pool │  │  Caddy   │
   │   16     │  │  (ssh2)  │  │  Admin   │
   │ Drizzle  │  │ → VPS    │  │  API     │
   └──────────┘  └──────────┘  └──────────┘
                      │
              ┌───────▼───────┐
              │  Target VPS   │
              │  docker compose│
              │  git repos    │
              │  bash scripts │
              └───────────────┘
```

Всё упаковано в один Docker-контейнер (app) + PostgreSQL. SSH-пул держит постоянные соединения к управляемым серверам. WebSocket стримит логи деплоев в реальном времени. Caddy-docker-proxy на внешней сети обеспечивает TLS и reverse proxy.

Отлично, картина ясна. Сейчас вся работа с серверами идёт через SSH (ssh2). Аппа крутится в Docker-контейнере, но чтобы управлять своим же хостом — подключается к нему по SSH, что абсурдно.

Идея: добавить "local" тип сервера, который выполняет команды напрямую через `child_process.exec` вместо SSH. Нужно глубже копнуть, как устроен SSH executor и серверная модель.

Читаю все запрошенные файлы параллельно.

Файлы не найдены по указанным путям. Ищу реальную структуру проекта.

Нашёл — файлы лежат в `devops-app/server/`. Читаю все нужные файлы параллельно.

Нашёл все файлы. Теперь читаю ssh-pool.ts, ssh-executor.ts, routes/servers.ts и health-related файлы параллельно.

Все файлы прочитаны полностью. Вот исчерпывающий отчёт.

---

## Полный отчёт по запрошенным файлам

Все файлы найдены и прочитаны целиком. Ниже -- ключевые интерфейсы, функции и связи между ними.

---

### 1. ssh-pool.ts -- [ssh-pool.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-pool.ts)

Синглтон-пул SSH-соединений на базе библиотеки `ssh2`. Один экземпляр на процесс, экспортируется как `sshPool`.

**Интерфейсы:**

```typescript
// Конфиг для подключения к серверу
export interface ServerConfig {
  id: string;
  host: string;
  port: number;
  sshUser: string;
  sshAuthMethod: "key" | "password";
  sshPrivateKey?: string | null;
  sshPassword?: string | null;
}

// Результат выполнения команды
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

**Внутренняя структура пула** ([PoolEntry](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-pool.ts#L20-L26)):

```typescript
interface PoolEntry {
  client: Client;        // ssh2 Client
  config: ServerConfig;
  connected: boolean;
  reconnecting: boolean;
  retryCount: number;
}
```

**Ключевые методы класса `SSHPool`:**

| Метод | Сигнатура | Назначение |
|-------|-----------|------------|
| [connect](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-pool.ts#L34-L52) | `connect(server: ServerConfig): Promise<void>` | Подключение к серверу. Если уже подключён -- no-op. Настраивает keepalive (30s, max 3 пропуска), readyTimeout 10s. |
| [exec](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-pool.ts#L139-L190) | `exec(serverId, command, timeoutMs?): Promise<ExecResult>` | Выполнение команды с таймаутом (по умолчанию 60s). Собирает stdout/stderr в строки. |
| [execStream](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-pool.ts#L192-L213) | `execStream(serverId, command): Promise<{stream, kill}>` | Стриминговое выполнение -- возвращает `ClientChannel` + функцию `kill()` (SIGKILL + close). |
| [openTunnel](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-pool.ts#L242-L300) | `openTunnel(serverId, {remoteHost, remotePort}): Promise<{localPort, close}>` | TCP-туннель через SSH (Feature 006). Создаёт локальный TCP-сервер на ephemeral порту, каждое входящее соединение пробрасывает через `forwardOut`. |
| [disconnect](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-pool.ts#L215-L222) | `disconnect(serverId): void` | Отключение + удаление из пула. Ставит `reconnecting = true` чтобы подавить авто-реконнект. |
| [disconnectAll](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-pool.ts#L224-L228) | `disconnectAll(): void` | Отключение всех серверов. |
| [isConnected](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-pool.ts#L230-L232) | `isConnected(serverId): boolean` | Проверка наличия активного соединения. |

**Реконнект** ([scheduleReconnect](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-pool.ts#L111-L137)): экспоненциальный backoff от 1s до 30s. При реконнекте создаётся свежий `Client`. Срабатывает автоматически на `error` и `close` события ssh2.

**Аутентификация** ([connectClient](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-pool.ts#L54-L109)): два режима:

- `sshAuthMethod === "key"` -- передаёт `privateKey` в ConnectConfig
- `sshAuthMethod === "password"` -- передаёт `password`
- Если ни то ни другое -- reject с "No SSH credentials configured"

---

### 2. ssh-executor.ts -- [ssh-executor.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-executor.ts)

Обёртка над `sshPool` для выполнения скриптов с интеграцией в `jobManager` (job tracking, WebSocket events).

**Интерфейсы:**

```typescript
export interface RunScriptOptions {
  json?: boolean;       // парсить NDJSON (default: true)
  timeoutMs?: number;   // default: 20 min
  raw?: boolean;        // true = команда as-is, без bash-обёртки
  onEvent?: JobEventCallback;
}

export interface RunScriptResult {
  jobId: string;
}

export interface ExecuteWithStdinOptions {
  signal?: AbortSignal;
  rawLogging?: boolean;
}
```

**Ключевые методы класса `SshExecutor`:**

| Метод | Назначение |
|-------|------------|
| [runScript](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-executor.ts#L25-L60) | Запуск скрипта на удалённом сервере. Два режима: `raw` (команда as-is) и script (bash + shQuote экранирование аргументов). Создаёт job через `jobManager`, выполняет асинхронно, возвращает `{jobId}` немедленно. |
| [executeWithStdin](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-executor.ts#L74-L137) | FR-017: выполнение команды с передачей данных через stdin (секреты не попадают в argv). Поддерживает `AbortSignal` для отмены. Используется `scripts-runner` (Feature 005). |
| [executeScript](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-executor.ts#L139-L204) | Приватный метод -- стриминговое выполнение с таймаутом и NDJSON-парсингом. |
| [handleJsonLine](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-executor.ts#L206-L234) | Обработка NDJSON-строк: `log` -> appendLog, `progress` -> emitEvent, `result` -> emitEvent. |

Экспортируется как `sshExecutor` + backward-compat alias `scriptRunner`.

---

### 3. schema.ts -- таблица `servers` -- [schema.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/db/schema.ts#L14-L53)

Drizzle ORM, PostgreSQL. Полная структура таблицы `servers`:

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | text PK | UUID |
| `label` | text NOT NULL | Человекочитаемое имя |
| `host` | text NOT NULL | Хост/IP |
| `port` | integer NOT NULL default 22 | SSH порт |
| `sshUser` | text NOT NULL | SSH пользователь |
| `sshAuthMethod` | text NOT NULL default "key" | `"key"` или `"password"` |
| `sshPrivateKey` | text nullable | PEM ключ (plaintext, legacy) |
| `sshPassword` | text nullable | Пароль (plaintext, legacy) |
| `sshPrivateKeyEncrypted` | text nullable | Envelope-encrypted PEM (Feature 011) |
| `sshPasswordEncrypted` | text nullable | Envelope-encrypted пароль (Feature 011) |
| `sshKeyFingerprint` | text nullable | SHA256 fingerprint клиентского ключа |
| `sshKeyRotatedAt` | text nullable | Время последней ротации |
| `hostKeyFingerprint` | text nullable | SHA256 fingerprint хост-ключа целевого сервера (MITM detection) |
| `cloudProvider` | text nullable | `gcp`, `aws`, `do`, `hetzner`, `vanilla` |
| `setupState` | text NOT NULL default "unknown" | `unknown`, `needs_initialisation`, `initialising`, `ready` |
| `scriptsPath` | text NOT NULL | Путь к скриптам на удалённом сервере |
| `status` | text NOT NULL default "unknown" | `online`, `offline`, `unknown` |
| `lastHealthCheck` | text nullable | ISO timestamp последней проверки |
| `scanRoots` | jsonb NOT NULL default `["/opt","/srv","/var/www","/home"]` | Корни для сканирования приложений |
| `aiReadAccess` | boolean NOT NULL default true | Feature 013: AI read access |
| `aiWriteAccess` | text NOT NULL default "enabled" | `enabled`, `sandbox-only`, `disabled` |
| `createdAt` | text NOT NULL | ISO timestamp |

**Индекс**: `idx_servers_status_setup_state` на `(status, setupState)`.

---

### 4. routes/servers.ts -- определение типа подключения -- [servers.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/servers.ts)

**Как определяется тип подключения:**

Тип подключения задаётся полем `sshAuthMethod` при создании/обновлении сервера. Zod-схема ([createServerSchema](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/servers.ts#L14-L39)):

```typescript
sshAuthMethod: z.enum(["key", "password"]).default("key"),
sshPrivateKey: z.string().optional(),
sshPassword: z.string().optional(),
```

При подключении через `sshPool.connect()` значение кастится: `(server.sshAuthMethod as "key" | "password") ?? "key"` -- это паттерн повторяется во всех местах вызова (verify, ensure-ssh, health-poller).

**Ключевые эндпоинты:**

| Эндпоинт | Метод | Назначение |
|----------|-------|------------|
| `GET /api/servers` | GET | Список всех серверов (через `serializeServers` -- маскирует секреты) |
| `POST /api/servers` | POST | Создание сервера (legacy путь) |
| `GET /api/servers/:id` | GET | Один сервер |
| `PUT /api/servers/:id` | PUT | Обновление |
| `DELETE /api/servers/:id` | DELETE | Удаление + `sshPool.disconnect(id)` |
| `POST /api/servers/:id/verify` | POST | **Health check / verify** -- см. ниже |
| `POST /api/servers/:id/setup` | POST | Запуск setup-vps.sh через `scriptRunner` |
| `POST /api/servers/probe` | POST | Feature 011: stateless probe (SSH + cloud + compat) |
| `POST /api/servers/onboard` | POST | Feature 011: создание сервера через onboarding flow |
| `POST /api/servers/:id/compatibility` | POST | Re-run compatibility probes |
| `POST /api/servers/:id/initialise` | POST | Feature 011: VPS initialisation wizard |
| `POST /api/servers/:id/rotate-key` | POST | Feature 011: SSH key rotation |

---

### 5. Health Check -- как работает

**Два уровня health check:**

#### A. Server-level verify ([/api/servers/:id/verify](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/servers.ts#L132-L180))

Простая проверка SSH-подключения:

1. Читает сервер из БД
2. Вызывает `sshPool.connect(...)` с credentials из БД
3. Если connect успешен -- обновляет `status = "online"`, `lastHealthCheck = now`
4. Если connect упал -- обновляет `status = "offline"`, `lastHealthCheck = now`
5. Возвращает `{ status, latencyMs, error? }`

#### B. Server health polling ([health-poller.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/health-poller.ts))

Класс `HealthPoller` -- периодический сбор метрик через SSH:

- [pollOnce](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/health-poller.ts#L46-L147): выполняет inline shell-команду через `sshPool.exec()`, собирающую:
  - CPU load (из `/proc/loadavg`, нормализованный по `nproc`)
  - Memory % (из `free`)
  - Disk % (из `df /`)
  - Swap % (из `free`)
  - Docker containers (из `docker ps -a --format`)
  - Services status (nginx, docker через `systemctl is-active`)
- Результат сохраняется в таблицу `health_snapshots`
- Обновляет `servers.status` = `"online"` / `"offline"`
- Бродкастит через WebSocket на канал `health:{serverId}`
- Если SSH не подключён -- автоматически пытается подключиться (lazy-connect)

[startPolling](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/health-poller.ts#L19-L30): рекурсивный `setTimeout` (не `setInterval`) с дефолтным интервалом 60s. Защита от overlapping polls через флаг `isPolling`.

#### C. Health routes ([health.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/health.ts))

| Эндпоинт | Назначение |
|----------|------------|
| `GET /api/servers/:serverId/health` | Последний snapshot из БД |
| `GET /api/servers/:serverId/health/history?hours=24` | История за N часов |
| `POST /api/servers/:serverId/health/refresh` | Принудительный poll (вызывает `healthPoller.pollOnce`) |

#### D. ensure-ssh.ts -- lazy-connect helper ([ensure-ssh.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/lib/ensure-ssh.ts))

Две функции:

- [ensureSshConnected](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/lib/ensure-ssh.ts#L19-L45): проверяет `sshPool.isConnected()`, если нет -- читает credentials из БД и подключается. Никогда не бросает исключений. Используется в logs.ts, caddy-reconciler, и других фоновых задачах.
- [restoreSshPoolFromDb](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/lib/ensure-ssh.ts#L52-L107): boot-time восстановление пула. Читает все серверы из БД, подключается параллельно через `Promise.allSettled`. Вызывается в [index.ts:323](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/index.ts#L323) при старте сервера (fire-and-forget).

---

### Граф зависимостей (кто кого использует)

```
ssh-pool.ts (SSHPool singleton)
  ├── ssh-executor.ts (SshExecutor) -- execStream для скриптов
  ├── health-poller.ts (HealthPoller) -- exec для метрик + connect для lazy-connect
  ├── ensure-ssh.ts -- connect + isConnected для lazy-connect
  ├── routes/servers.ts -- connect для verify, disconnect для delete
  ├── caddy-reconciler.ts -- openTunnel для Caddy admin API
  └── множество других сервисов (scanner, deploy-dispatch, etc.)
```

Ну, картина кристально ясная. Вся работа с серверами идёт через `sshPool` — `exec`, `execStream`, `openTunnel`. Чтобы аппа видела свой хост без SSH, нужен "local executor" — альтернативный транспорт, который выполняет команды через `child_process` вместо SSH.

Это задача на **>3 файлов**, так что по правилам — сначала план.

Давай уточню пару моментов:

Отлично. Auto-seed + полный функционал. Значит нужен полноценный "local transport" — альтернатива SSH, которая прозрачно подставляется вместо `sshPool` для local-серверов.

Давай сначала полностью разберу все точки, где используется `sshPool`, чтобы понять масштаб изменений и спроектировать правильную абстракцию.

Ладно, сейчас прошерстим всё. Запускаю параллельный поиск по всем паттернам.

Результат обрезался на 166 строках для sshPool. Дотяну хвост и посмотрю что осталось.

Теперь дополню данные по `sshPool.exec` в blue-green route и apps route, а также проверю оставшиеся файлы:

Всё собрано. Вот полная картина.

---

## Полный отчёт: использование `sshPool`, `scriptRunner`, `sshExecutor`, `scriptsRunner`

### 1. `sshPool` — импорт и вызовы методов

#### Продакшн-код (server/)

| Файл | Строка | Метод |
|---|---|---|
| [ssh-executor.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-executor.ts#L1) | 1 | `import { sshPool }` |
| [ssh-executor.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-executor.ts#L81) | 81 | `sshPool.execStream` |
| [ssh-executor.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-executor.ts#L146) | 146 | `sshPool.execStream` |
| [scripts-runner.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/scripts-runner.ts#L31) | 31 | `import { sshPool }` |
| [scripts-runner.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/scripts-runner.ts#L292) | 292 | `sshPool.isConnected` |
| [scanner.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/scanner.ts#L8) | 8 | `import { sshPool }` |
| [scanner.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/scanner.ts#L217) | 217 | `sshPool.connect` |
| [scanner.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/scanner.ts#L226) | 226 | `sshPool.execStream` |
| [slot-namer.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/slot-namer.ts#L10) | 10 | `import { sshPool }` |
| [slot-namer.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/slot-namer.ts#L46) | 46 | `sshPool.exec` |
| [slot-namer.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/slot-namer.ts#L51) | 51 | `sshPool.exec` |
| [slot-namer.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/slot-namer.ts#L82) | 82 | `sshPool.exec` |
| [interrupted-deploys-scanner.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/interrupted-deploys-scanner.ts#L14) | 14 | `import { sshPool }` |
| [interrupted-deploys-scanner.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/interrupted-deploys-scanner.ts#L72) | 72 | `sshPool.exec` |
| [blue-green-orchestrator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/blue-green-orchestrator.ts#L32) | 32 | `import { sshPool }` |
| [blue-green-orchestrator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/blue-green-orchestrator.ts#L132) | 132 | `sshPool.exec` |
| [blue-green-orchestrator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/blue-green-orchestrator.ts#L204) | 204 | `sshPool.exec` |
| [blue-green-orchestrator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/blue-green-orchestrator.ts#L350) | 350 | `sshPool.exec` |
| [ssh-key-rotation.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-key-rotation.ts#L39) | 39 | `import { sshPool }` |
| [ssh-key-rotation.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-key-rotation.ts#L96) | 96 | `sshPool.exec` |
| [ssh-key-rotation.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-key-rotation.ts#L180) | 180 | `sshPool.exec` |
| [ssh-key-rotation.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-key-rotation.ts#L296) | 296 | `sshPool.disconnect` |
| [compatibility-probe.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/compatibility-probe.ts#L15) | 15 | `import { sshPool }` |
| [compatibility-probe.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/compatibility-probe.ts#L247) | 247 | `sshPool.exec` |
| [cloud-init-probe.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/cloud-init-probe.ts#L21) | 21 | `import { sshPool }` |
| [cloud-init-probe.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/cloud-init-probe.ts#L86) | 86 | `sshPool.exec` |
| [migration-toolkit.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/migration-toolkit.ts#L25) | 25 | `import { sshPool }` |
| [migration-toolkit.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/migration-toolkit.ts#L74) | 74 | `sshPool.exec` |
| [migration-toolkit.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/migration-toolkit.ts#L135) | 135 | `sshPool.exec` |
| [migration-toolkit.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/migration-toolkit.ts#L186) | 186 | `sshPool.exec` |
| [hard-delete-with-hooks.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/hard-delete-with-hooks.ts#L23) | 23 | `import { sshPool }` |
| [hard-delete-with-hooks.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/hard-delete-with-hooks.ts#L75) | 75 | `typeof sshPool.exec` (тип) |
| [hard-delete-with-hooks.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/hard-delete-with-hooks.ts#L78) | 78 | `sshPool.exec.bind(sshPool)` |
| [caddy-override-writer.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/caddy-override-writer.ts#L17) | 17 | `import { sshPool }` |
| [caddy-override-writer.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/caddy-override-writer.ts#L57) | 57 | `sshPool.exec` |
| [caddy-override-writer.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/caddy-override-writer.ts#L105) | 105 | `sshPool.exec` |
| [bootstrap-orchestrator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/bootstrap-orchestrator.ts#L25) | 25 | `import { sshPool }` |
| [bootstrap-orchestrator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/bootstrap-orchestrator.ts#L599) | 599 | `sshPool.exec` |
| [orphan-cleanup-job.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/orphan-cleanup-job.ts#L18) | 18 | `import { sshPool }` |
| [orphan-cleanup-job.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/orphan-cleanup-job.ts#L54) | 54 | `sshPool.exec` |
| [caddy-admin-client.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/caddy-admin-client.ts#L12) | 12 | `import { sshPool }` |
| [caddy-admin-client.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/caddy-admin-client.ts#L81) | 81 | `sshPool.openTunnel` |
| [health-poller.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/health-poller.ts#L5) | 5 | `import { sshPool }` |
| [health-poller.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/health-poller.ts#L50) | 50 | `sshPool.isConnected` |
| [health-poller.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/health-poller.ts#L54) | 54 | `sshPool.connect` |
| [health-poller.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/health-poller.ts#L89) | 89 | `sshPool.exec` |
| [probes/container.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/probes/container.ts#L56) | 56 | `sshPool.exec` |
| [probes/caddy-admin.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/probes/caddy-admin.ts#L21) | 21 | `sshPool.openTunnel` |
| [servers.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/servers.ts#L8) | 8 | `import { sshPool }` |
| [servers.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/servers.ts#L118) | 118 | `sshPool.disconnect` |
| [servers.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/servers.ts#L148) | 148 | `sshPool.connect` |
| [domain.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/domain.ts#L37) | 37 | `import { sshPool }` |
| [domain.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/domain.ts#L430) | 430 | `sshPool.exec` |
| [domain.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/domain.ts#L443) | 443 | `sshPool.exec` |
| [deployments.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/deployments.ts#L23) | 23 | `import { sshPool }` |
| [deployments.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/deployments.ts#L109) | 109 | `sshPool.isConnected` |
| [deployments.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/deployments.ts#L111) | 111 | `sshPool.connect` |
| [blue-green.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/blue-green.ts#L38) | 38 | `import { sshPool }` |
| [blue-green.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/blue-green.ts#L178) | 178 | `sshPool.exec` |
| [blue-green.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/blue-green.ts#L434) | 434 | `sshPool.exec` |
| [apps.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/apps.ts#L14) | 14 | `import { sshPool }` |
| [apps.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/apps.ts#L452) | 452 | dynamic `import → sshPool` (aliased `sp`) |
| [apps.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/apps.ts#L657) | 657 | `sshPool.exec` |
| [docker.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/docker.ts#L3) | 3 | `import { sshPool }` |
| [docker.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/docker.ts#L20) | 20 | `sshPool.isConnected` |
| [docker.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/docker.ts#L27) | 27 | `sshPool.exec` |
| [docker.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/docker.ts#L28) | 28 | `sshPool.exec` |
| [backups.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/backups.ts#L10) | 10 | `import { sshPool }` (импорт есть, но прямых вызовов `sshPool.*` нет — используется через `scriptRunner`) |
| [logs.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/logs.ts#L3) | 3 | `import { sshPool }` |
| [logs.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/logs.ts#L82) | 82 | `sshPool.exec` |
| [logs.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/logs.ts#L128) | 128 | `sshPool.exec` |
| [logs.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/logs.ts#L167) | 167 | `sshPool.isConnected` |
| [logs.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/logs.ts#L182) | 182 | `sshPool.exec` |
| [ensure-ssh.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/lib/ensure-ssh.ts#L16) | 16 | `import { sshPool }` |
| [ensure-ssh.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/lib/ensure-ssh.ts#L20) | 20 | `sshPool.isConnected` |
| [ensure-ssh.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/lib/ensure-ssh.ts#L28) | 28 | `sshPool.connect` |
| [ensure-ssh.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/lib/ensure-ssh.ts#L37) | 37 | `sshPool.isConnected` |
| [ensure-ssh.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/lib/ensure-ssh.ts#L65) | 65 | `sshPool.connect` |
| [compose-override-generator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/lib/compose-override-generator.ts#L13) | 13 | `import { sshPool }` |
| [compose-override-generator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/lib/compose-override-generator.ts#L60) | 60 | `sshPool.exec` |
| [compose-override-generator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/lib/compose-override-generator.ts#L85) | 85 | `sshPool.exec` |

#### Тесты (tests/)

| Файл | Что делает |
|---|---|
| [probes-container.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/unit/probes-container.test.ts) | `vi.mock` → `sshPool.exec` (mock + mockReset + mockResolvedValue + mockRejectedValue) |
| [routes-blue-green.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/unit/routes-blue-green.test.ts) | `vi.mock` → `sshPool` |
| [blue-green-orchestrator.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/unit/blue-green-orchestrator.test.ts) | `vi.mock` → `sshPool` |
| [domain-attach-happy-path.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/integration/domain-attach-happy-path.test.ts) | `vi.mock` → `sshPool` |
| [deploy-lock.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/integration/deploy-lock.test.ts) | `vi.mock` → `sshPool`, assert `sshPool.exec` not called |
| [deploy.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/integration/deploy.test.ts) | `vi.mock` → `sshPool` |
| [scripts-runner.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/integration/scripts-runner.test.ts) | `vi.mock` → `sshPool` |
| [scripts-runner-project-local-runtime-validation.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/integration/scripts-runner-project-local-runtime-validation.test.ts) | `vi.mock` → `sshPool` |
| [scanner.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/integration/scanner.test.ts) | `vi.mock` → `sshPool` |
| [scan-scenarios.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/integration/scan-scenarios.test.ts) | `vi.mock` → `sshPool` |
| [scan-perf.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/integration/scan-perf.test.ts) | `vi.mock` → `sshPool` |

---

### Сводка методов `sshPool` по файлам

| Метод | Файлы (продакшн) |
|---|---|
| **`sshPool.exec`** | `slot-namer.ts`, `interrupted-deploys-scanner.ts`, `blue-green-orchestrator.ts`, `ssh-key-rotation.ts`, `compatibility-probe.ts`, `cloud-init-probe.ts`, `migration-toolkit.ts`, `hard-delete-with-hooks.ts`, `caddy-override-writer.ts`, `bootstrap-orchestrator.ts`, `orphan-cleanup-job.ts`, `health-poller.ts`, `probes/container.ts`, `domain.ts`, `blue-green.ts`, `apps.ts`, `docker.ts`, `logs.ts`, `compose-override-generator.ts` |
| **`sshPool.execStream`** | `ssh-executor.ts` (×2), `scanner.ts` |
| **`sshPool.connect`** | `servers.ts`, `deployments.ts`, `scanner.ts`, `health-poller.ts`, `ensure-ssh.ts` (×2) |
| **`sshPool.disconnect`** | `servers.ts`, `ssh-key-rotation.ts` |
| **`sshPool.isConnected`** | `scripts-runner.ts`, `deployments.ts`, `docker.ts`, `logs.ts`, `health-poller.ts`, `ensure-ssh.ts` (×2) |
| **`sshPool.openTunnel`** | `caddy-admin-client.ts`, `probes/caddy-admin.ts` |

---

### 2. `scriptRunner` (legacy alias → `sshExecutor`)

Определён в [ssh-executor.ts:239](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-executor.ts#L239): `export const scriptRunner = sshExecutor;`

| Файл | Строка | Метод |
|---|---|---|
| [servers.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/servers.ts#L10) | 10 | `import { scriptRunner }` |
| [servers.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/servers.ts#L205) | 205 | `scriptRunner.runScript` |
| [docker.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/docker.ts#L4) | 4 | `import { scriptRunner }` |
| [docker.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/docker.ts#L84) | 84 | `scriptRunner.runScript` |
| [backups.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/backups.ts#L8) | 8 | `import { scriptRunner }` |
| [backups.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/backups.ts#L67) | 67 | `scriptRunner.runScript` |
| [backups.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/backups.ts#L141) | 141 | `scriptRunner.runScript` |
| [audit.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/audit.ts#L5) | 5 | `import { scriptRunner }` |
| [audit.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/audit.ts#L57) | 57 | `scriptRunner.runScript` |

---

### 3. `sshExecutor` (класс `SshExecutor`)

Определён в [ssh-executor.ts:237](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ssh-executor.ts#L237): `export const sshExecutor = new SshExecutor();`

| Файл | Строка | Метод |
|---|---|---|
| [scripts-runner.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/scripts-runner.ts#L28) | 28 | `import { sshExecutor }` |
| [scripts-runner.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/scripts-runner.ts#L622) | 622 | `sshExecutor.executeWithStdin` |

---

### 4. `scriptsRunner` (доменный раннер, класс `ScriptsRunner`)

Определён в [scripts-runner.ts:751](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/scripts-runner.ts#L751): `export const scriptsRunner = new ScriptsRunner();`

| Файл | Строка | Метод |
|---|---|---|
| [index.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/index.ts#L13) | 13 | `import { scriptsRunner }` |
| [index.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/index.ts#L207) | 207 | `scriptsRunner.validateManifestLenient` |
| [index.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/index.ts#L215) | 215 | `scriptsRunner.pruneOldRuns` |
| [index.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/index.ts#L221) | 221 | `scriptsRunner.start` |
| [index.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/index.ts#L243) | 243 | `scriptsRunner.stop` |
| [deployments.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/deployments.ts#L10) | 10 | `import { scriptsRunner }` |
| [deployments.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/deployments.ts#L216) | 216 | `scriptsRunner.runScript` |
| [deployments.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/deployments.ts#L418) | 418 | `scriptsRunner.runScript` |
| [scripts.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/scripts.ts#L14) | 14 | `import { scriptsRunner }` |
| [scripts.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/scripts.ts#L31) | 31 | `scriptsRunner.getManifestDescriptor` |
| [scripts.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/scripts.ts#L56) | 56 | `scriptsRunner.runScript` |
| [runs.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/runs.ts#L17) | 17 | `import { scriptsRunner }` |
| [runs.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/runs.ts#L59) | 59 | `scriptsRunner.getManifestDescriptor` |
| [runs.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/routes/runs.ts#L96) | 96 | `scriptsRunner.getManifestDescriptor` |
| [server-bootstrap.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/server-bootstrap.ts#L21) | 21 | `import { scriptsRunner }` |
| [server-bootstrap.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/server-bootstrap.ts#L79) | 79 | `scriptsRunner.runScript` |
| [bootstrap-orchestrator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/bootstrap-orchestrator.ts#L24) | 24 | `import { scriptsRunner }` |
| [bootstrap-orchestrator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/bootstrap-orchestrator.ts#L320) | 320 | `scriptsRunner.runScript` |
| [bootstrap-orchestrator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/bootstrap-orchestrator.ts#L389) | 389 | `scriptsRunner.runScript` |
| [bootstrap-orchestrator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/bootstrap-orchestrator.ts#L427) | 427 | `scriptsRunner.runScript` |
| [bootstrap-orchestrator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/bootstrap-orchestrator.ts#L466) | 466 | `scriptsRunner.runScript` |
| [bootstrap-orchestrator.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/bootstrap-orchestrator.ts#L607) | 607 | `scriptsRunner.runScript` |
| [project-local-deploy-runner.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/project-local-deploy-runner.ts#L32) | 32 | `import { scriptsRunner }` |
| [project-local-deploy-runner.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/project-local-deploy-runner.ts#L88) | 88 | `scriptsRunner.runScript` |
| [tool-call-dispatcher.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ai/tool-call-dispatcher.ts#L10) | 10 | `import { scriptsRunner }` |
| [tool-call-dispatcher.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/server/services/ai/tool-call-dispatcher.ts#L178) | 178 | `scriptsRunner.runScript` |

#### Тесты для `scriptsRunner`

| Файл | Что делает |
|---|---|
| [scripts-runner.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/integration/scripts-runner.test.ts) | `scriptsRunner.runScript` (×3) |
| [scripts-runner-prune.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/unit/scripts-runner-prune.test.ts) | `scriptsRunner.pruneOldRuns`, `.start`, `.stop` |
| [scripts-runner-bifurcation.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/unit/scripts-runner-bifurcation.test.ts) | `scriptsRunner.runScript` path |
| [deploy-wait-for-healthy.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/integration/deploy-wait-for-healthy.test.ts) | `scriptsRunner.runScript` (×3) |
| [project-local-deploy-runner.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/integration/project-local-deploy-runner.test.ts) | `vi.mock` → `scriptsRunner` |
| [runs-api.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/integration/runs-api.test.ts) | `vi.mock` → `scriptsRunner` |
| [scripts-runner-project-local.test.ts](file:///c:/Repositories/underundre/helpers/undev/devops-app/tests/integration/scripts-runner-project-local.test.ts) | `scriptsRunner.runScript` path |

---

### Архитектурная иерархия (кто кого вызывает)

```
sshPool (ssh-pool.ts)          ← низкоуровневый SSH-пул
  ├── sshExecutor (ssh-executor.ts)   ← обёртка: execStream + stdin
  │     ├── scriptsRunner (scripts-runner.ts)  ← доменный раннер скриптов
  │     │     ├── routes/deployments.ts
  │     │     ├── routes/scripts.ts
  │     │     ├── routes/runs.ts
  │     │     ├── services/server-bootstrap.ts
  │     │     ├── services/bootstrap-orchestrator.ts
  │     │     ├── services/project-local-deploy-runner.ts
  │     │     └── services/ai/tool-call-dispatcher.ts
  │     └── scriptRunner (legacy alias = sshExecutor)
  │           ├── routes/servers.ts
  │           ├── routes/docker.ts
  │           ├── routes/backups.ts
  │           └── routes/audit.ts
  └── прямые вызовы sshPool.exec/connect/etc
        ├── 19 сервисов (см. таблицу выше)
        ├── 7 роутов
        └── 2 lib-модуля (ensure-ssh, compose-override-generator)
```

Итого: **22 продакшн-файла** импортируют `sshPool` напрямую, **4 роута** используют legacy `scriptRunner`, **8 модулей** используют доменный `scriptsRunner`, и **1 файл** (`scripts-runner.ts`) использует `sshExecutor` напрямую.

Масштаб серьёзный — 22 файла с прямым `sshPool`, плюс executor/runner обёртки. Менять каждый файл по отдельности — безумие. Правильный подход: **абстракция на уровне транспорта**.

Вот план:

**Архитектурный подход: Transport Abstraction Layer**

Вместо замены `sshPool` во всех 22+ файлах, создаём:

1. **`server/services/transport.ts`** — единый интерфейс `ServerTransport` с методами `exec`, `execStream`, `connect`, `disconnect`, `isConnected`, `openTunnel`. Фабрика `getTransport(serverId)` возвращает либо SSH-транспорт (делегирует в `sshPool`), либо Local-транспорт (`child_process`).

2. **`server/services/local-executor.ts`** — реализация Local-транспорта через `child_process.exec`/`spawn`.

3. **Схема БД** — добавить поле `connectionType: "ssh" | "local"` в таблицу `servers` (миграция).

4. **Auto-seed** — при старте сервера, если нет local-сервера в БД, создать его автоматически.

5. **Фронтенд** — пометить local-сервер визуально (бейдж "Local"), скрыть SSH-специфичные элементы (verify SSH, rotate key, SSH credentials).

6. **Постепенная миграция** — заменить `import { sshPool }` на `import { getTransport }` во всех 22 файлах.

Это **>3 файлов** и **≥2 подхода** (можно было бы просто хакнуть `sshPool` чтобы он для local серверов вызывал child_process, но это грязно). Предлагаю чистый Transport Layer.

Вопрос: это большая фича. Хочешь, чтобы я оформил полноценную спеку через `/speckit`, или сразу в код? Учитывая масштаб (22+ файлов), я бы рекомендовал сначала спеку, но если хочешь быстрее — могу сразу имплементить по плану выше.

Хороший вопрос. Давай посмотрю, что есть в open-source для local Docker/server management без SSH.

Отличный ресёрч. Вот что нашёл по open-source аналогам:

## Что делают конкуренты

### Coolify

**Даже Coolify использует SSH для localhost!** Из их доков:
> "To be able to manage the server where Coolify is running on, the docker container of Coolify should reach the host server through SSH."

Coolify крутится в Docker-контейнере и подключается к своему же хосту по SSH. Это именно та проблема, которую ты хочешь решить. Coolify НЕ решил её — они просто автоматизируют SSH-ключ для localhost.

### Komodo

Komodo пошёл другим путём — **Core + Periphery agent** архитектура. На каждом сервере стоит лёгкий агент (Periphery), который получает команды от Core по WebSocket и выполняет Docker-операции **локально**. Это ближе к тому, что нужно, но это отдельный бинарник на Rust, который нужно ставить на каждый сервер.

### Portainer

Portainer для localhost использует **Docker Socket** (`/var/run/docker.sock`) — монтирует его в контейнер и управляет Docker напрямую через Docker API. Но это только Docker-операции, не произвольные shell-команды.

## Вывод: готового решения нет

Ни один из open-source проектов не предлагает готовую библиотеку "local transport as alternative to SSH". Каждый решает по-своему:

- Coolify: SSH даже для localhost (костыль)
- Komodo: отдельный agent (overkill для нас)
- Portainer: Docker socket (только Docker API, не shell)

## Мой план для твоей аппы

Самый чистый подход — **гибрид Portainer + Komodo идей**:

### Слой 1: Transport Interface

```typescript
interface ServerTransport {
  exec(serverId: string, command: string, timeoutMs?: number): Promise<ExecResult>
  execStream(serverId: string, command: string): Promise<{stream: Readable, kill: () => void}>
  connect(server: ServerConfig): Promise<void>
  disconnect(serverId: string): void
  isConnected(serverId: string): boolean
  openTunnel(serverId: string, opts: TunnelOpts): Promise<{localPort: number, close: () => void}>
}
```

### Слой 2: Local Transport

- `exec` → `child_process.execFile('bash', ['-c', command])` (контейнер на Alpine, bash есть)
- `execStream` → `child_process.spawn('bash', ['-c', command])` — возвращает stdout/stderr как stream
- `connect/disconnect/isConnected` → no-op (всегда connected)
- `openTunnel` → для localhost не нужен SSH-туннель, можно напрямую обращаться к порту

### Слой 3: Transport Router

```typescript
function getTransport(serverId: string): ServerTransport
```

Смотрит в БД `connectionType` сервера → возвращает `sshPool` или `localTransport`.

### Слой 4: Schema + Auto-seed

- Миграция: добавить `connectionType: "ssh" | "local"` (default `"ssh"`)
- При старте: если нет сервера с `connectionType = "local"` → создать "This Server" автоматически

### Слой 5: UI

- Бейдж "Local" на карточке сервера
- Скрыть SSH-специфику (credentials, verify SSH, rotate key) для local серверов
- Local сервер нельзя удалить (или предупреждение)

### Масштаб изменений

- **Новые файлы**: `transport.ts`, `local-executor.ts`, миграция 0015
- **Изменённые файлы**: все 22 файла с `sshPool` → `getTransport()`, плюс schema, index.ts (auto-seed), фронтенд (AddServerForm, ServerPage, DashboardPage)
- **Тесты**: обновить моки

### Docker-специфика

В `docker-compose.yml` уже монтируется Docker socket? Нет — сейчас всё через SSH. Для local transport нужно будет добавить в docker-compose:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock  # для docker commands
```

И возможно `privileged: true` или `--pid=host` для полного доступа к хост-метрикам (CPU/RAM/disk через `/proc`).

---

Жду твоё ревью плана. Что поправить/убрать/добавить?

---

Слушай, я тут подумал серьёзно, и вот моя честная рекомендация:

## Рекомендация: Transport Abstraction, но с хитрым подходом к миграции

### Почему НЕ SSH-to-localhost

SSH-to-localhost — это как чинить протечку, обмотав трубу изолентой. Работает? Да. Но:

1. **Ты в Docker-контейнере** — значит нужен либо sshd внутри контейнера (антипаттерн, один процесс на контейнер), либо SSH к хосту через `host.docker.internal` (не везде работает, зависит от Docker network mode)
2. **Ключи** — нужно генерить SSH-ключ, прокидывать в `authorized_keys` хоста, монтировать в контейнер. Ещё одна точка отказа при каждом `docker-compose up`
3. **Latency** — каждый `exec` через SSH это ~50-100ms overhead. Health poller дёргает метрики каждые 60 секунд — ок. Но деплой-скрипты с десятками команд — ощутимо

### Почему Transport Abstraction, но НЕ в лоб

Gemini прав — менять 22 файла с `sshPool.method()` на `getTransport(serverId).method()` — это:

- Огромный diff
- Риск регрессий
- Каждый файл нужно тестировать

**Мой подход — Proxy Pattern на уровне `sshPool`:**

Вместо замены всех 22 импортов, делаем `sshPool` умнее. Он уже синглтон. Добавляем в него логику:

```typescript
// ssh-pool.ts — расширяем существующий класс
class SSHPool {
  // Существующие методы остаются как есть
  
  async exec(serverId: string, command: string, timeoutMs?: number): Promise<ExecResult> {
    if (this.isLocalServer(serverId)) {
      return this.localExec(command, timeoutMs);
    }
    // существующая SSH логика
  }
  
  async execStream(serverId: string, command: string) {
    if (this.isLocalServer(serverId)) {
      return this.localExecStream(command);
    }
    // существующая SSH логика
  }
  
  // connect/disconnect/isConnected — для local просто no-op/true
}
```

**Результат:**

- **0 файлов** с изменёнными импортами
- Все 22 файла продолжают вызывать `sshPool.exec(serverId, ...)` — просто теперь для local-серверов это идёт через `child_process`
- Вся новая логика инкапсулирована в `ssh-pool.ts` + отдельный `local-executor.ts`
- Тесты не ломаются (моки `sshPool` работают как раньше)

### Полный план с учётом ревью

**Новые файлы (3):**

1. `server/services/local-executor.ts` — `exec`, `execStream` через `child_process` с maxBuffer, stream adapter, kill semantics
2. `migrations/0015_local_server_transport.sql` — добавить `connectionType` в `servers`
3. Обновить `Dockerfile` — `apk add bash docker-cli`

**Изменённые файлы (~6-8 вместо 22+):**

1. `server/services/ssh-pool.ts` — proxy logic для local
2. `server/db/schema.ts` — поле `connectionType`
3. `server/index.ts` — auto-seed local server при старте
4. `server/lib/ensure-ssh.ts` — skip connect для local
5. `server/routes/servers.ts` — валидация, скрыть SSH fields для local
6. `docker-compose.yml` — mount docker socket
7. `client/pages/DashboardPage.tsx` — бейдж "Local"
8. `client/components/servers/AddServerForm.tsx` — скрыть SSH для local (или вообще убрать возможность добавлять local вручную, раз auto-seed)

**Safety measures (из ревью Gemini):**

- `aiWriteAccess: "disabled"` при auto-seed
- Blacklist собственного container ID в cleanup/stop операциях
- maxBuffer 50MB на local exec
- Concurrent spawn limiter (semaphore, max 5 параллельных)

### Итого

| Критерий | SSH-to-localhost | Transport (в лоб) | Proxy Pattern ✅ |
|----------|-----------------|-------------------|-----------------|
| Файлов менять | ~3 | ~25+ | ~8 |
| Риск регрессий | Низкий | Высокий | Низкий |
| Архитектурная чистота | Плохо | Отлично | Хорошо |
| Новые failure modes | Мало | Много | Средне (контролируемо) |
| Будущее расширение | Тупик | Легко | Легко (рефакторим позже) |

Proxy Pattern — это прагматичный компромисс. Получаем 80% пользы Transport Abstraction при 30% стоимости. А полный рефакторинг на интерфейсы можно сделать потом как tech debt, когда появится третий тип транспорта (например, Docker API напрямую).

Что думаешь?
