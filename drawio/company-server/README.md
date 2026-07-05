# Company Draw.io Server

Lightweight internal wrapper server for the company draw.io build.

## Run Locally

```powershell
cd E:\Work\AI\Draw\drawio\company-server
$env:HOST = "127.0.0.1"
$env:PORT = "8081"
npm start
```

Open locally:

```text
http://127.0.0.1:8081/
```

To open from another computer on the same LAN, intentionally bind to all
interfaces first:

```powershell
$env:HOST = "0.0.0.0"
npm start
```

```text
http://<your-lan-ip>:8081/
```

For example, if this computer's WLAN IPv4 address is `192.168.31.193`,
your coworker should open `http://192.168.31.193:8081/`.

If Windows Firewall blocks the port, run PowerShell as administrator and allow it:

```powershell
New-NetFirewallRule -DisplayName "Company Draw.io 8081" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8081 -RemoteAddress LocalSubnet
```

## Login

- Default administrator: `admin`
- Default administrator password: `123456`
- Override them with `DRAWIO_ADMIN_ID` and `DRAWIO_ADMIN_PASSWORD` before production use.
- Keep the default loopback bind for local use. If you expose the server on a
  LAN or behind a reverse proxy, change `DRAWIO_ADMIN_PASSWORD`.
- Administrators create pending accounts and one-time invitation codes from `/admin.html`.
- Pending accounts show their full invitation code in the administrator account table for copying.
- Users register at `/register.html` with employee ID, invitation code and password.
- Session cookie: HTTP-only, seven days by default
- Login page: `/login.html`
- Registration page: `/register.html`
- Account management page: `/admin.html`
- Workspace page: `/app.html`

## Features

- Chinese company entry pages.
- Invitation-only registration and password login with an HTTP-only session cookie.
- Administrator account management with manual and batch invitation generation.
- Per-employee file directory isolation.
- Diagram list, create, open, save, rename, delete.
- Atomic XML writes through a temporary file and rename.
- Etag conflict detection for concurrent saves.
- Read-only share token API and `/share.html` viewer page.
- XML download for owner and share visitor.
- AI flowchart assistant with OpenAI-compatible and Anthropic Messages API formats.
- AI model list loading for OpenAI-compatible and Anthropic model endpoints.
- Internal employee-to-employee sharing with per-diagram chat threads.

## API

```text
POST /api/login
POST /api/register
GET  /api/me
GET  /api/session
POST /api/logout

GET    /api/admin/accounts
POST   /api/admin/accounts
POST   /api/admin/accounts/batch
PATCH  /api/admin/accounts/:employeeId
DELETE /api/admin/accounts/:employeeId
POST   /api/admin/accounts/:employeeId/invite

GET    /api/files
POST   /api/files
GET    /api/files/:id
GET    /api/files/:id/download
PUT    /api/files/:id
DELETE /api/files/:id
POST   /api/files/:id/rename
POST   /api/files/:id/share
POST   /api/files/:id/share-internal

GET  /api/employees
GET  /api/internal-shares
GET  /api/internal-shares/:id
POST /api/internal-shares/:id/messages
GET  /api/internal-shares/:id/download

GET /api/share/:token
GET /api/share/:token/download

GET /api/health
GET /api/ops/status

POST /api/ai/flowchart
POST /api/ai/models

POST /export
```

`/api/health` is a lightweight public probe for reverse proxies. `/api/ops/status`
returns storage counts, data-directory writability and runtime config. Set
`DRAWIO_OPS_TOKEN` and call it with `Authorization: Bearer <token>` for production
use; without that token it is available only to a logged-in employee session.
`/export` is a logged-in reverse proxy for an optional internal draw.io export
server configured with `DRAWIO_EXPORT_URL`.

## Security Notes

- The server binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` only when LAN
  access is intended.
- Browser state-changing requests are checked for same-origin headers.
- Login and invite-code registration attempts are rate-limited in memory.
- Client-supplied AI base URLs are limited to official OpenAI, Anthropic and
  `gate.ununu.ai` origins plus `DRAWIO_AI_ALLOWED_ORIGINS`.
- Local/private AI endpoints are blocked unless `DRAWIO_AI_ALLOW_PRIVATE=1`.
- Reverse proxy headers are ignored unless `DRAWIO_TRUST_PROXY=1`.
- Set `DRAWIO_COOKIE_SECURE=1` when serving through HTTPS.

## Data Layout

```text
data/
  accounts.json
  sessions.json
  employees/
    10001/
      files/
        <file-id>.drawio
      meta/
        <file-id>.json
  shares/
    <token-hash>.json
  internal-shares/
    <share-id>.json
  logs/
    access.log
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address; set `0.0.0.0` for intentional LAN exposure |
| `PORT` | `8081` | HTTP port |
| `DRAWIO_TRUST_PROXY` | unset | set to `1` to trust `X-Forwarded-*` headers from a reverse proxy |
| `DRAWIO_WEBAPP_DIR` | `../src/main/webapp` | draw.io static webapp |
| `DRAWIO_DATA_DIR` | `./data` | sessions, files and shares |
| `DRAWIO_ADMIN_ID` | `admin` | bootstrap administrator employee ID |
| `DRAWIO_ADMIN_PASSWORD` | `123456` | bootstrap administrator password |
| `DRAWIO_ADMIN_NAME` | `Administrator` | bootstrap administrator display name |
| `DRAWIO_TEMP_PASSWORD` | `123456` | fallback default for `DRAWIO_ADMIN_PASSWORD` |
| `DRAWIO_SESSION_DAYS` | `7` | cookie/session lifetime |
| `DRAWIO_COOKIE_NAME` | `company_drawio_session` | session cookie name; use different names when running multiple localhost ports |
| `DRAWIO_COOKIE_SECURE` | unset | set to `1` behind HTTPS |
| `DRAWIO_AUTH_RATE_LIMIT_WINDOW_MS` | `900000` | login/register rate-limit window |
| `DRAWIO_LOGIN_RATE_LIMIT_MAX` | `20` | failed login attempts per IP and employee ID per window |
| `DRAWIO_REGISTER_RATE_LIMIT_MAX` | `20` | failed registration attempts per IP and employee ID per window |
| `DRAWIO_MAX_JSON_BYTES` | `26214400` | JSON body limit |
| `DRAWIO_MAX_EXPORT_BYTES` | `52428800` | export proxy request body limit |
| `DRAWIO_MAX_CHAT_MESSAGE_CHARS` | `2000` | maximum internal share chat message length |
| `DRAWIO_MAX_INTERNAL_SHARE_RECIPIENTS` | `30` | maximum recipients for one internal share |
| `DRAWIO_MIN_PASSWORD_CHARS` | `6` | minimum password length for registration |
| `DRAWIO_MAX_BATCH_ACCOUNTS` | `100` | maximum accounts in one batch invite operation |
| `DRAWIO_INVITE_CODE_BYTES` | `9` | random bytes used for each invitation code |
| `DRAWIO_ACCESS_LOG` | `./data/logs/access.log` | JSONL access log path; set `off` to disable |
| `DRAWIO_OPS_TOKEN` | unset | bearer token for `/api/ops/status` |
| `DRAWIO_EXPORT_URL` | unset | internal draw.io export server endpoint for `/export` |
| `DRAWIO_BACKUP_DIR` | `./backups` | backup output directory for `npm run backup` |
| `DRAWIO_BACKUP_INCLUDE_LOGS` | unset | set to `1` to include `data/logs` in backups |
| `DRAWIO_AI_PROVIDER` | `openai` | default AI API format: `openai` or `anthropic` |
| `DRAWIO_AI_API_KEY` | unset | fallback API key for either AI format |
| `DRAWIO_AI_MODEL` | unset | fallback model name for either AI format |
| `DRAWIO_AI_BASE_URL` | format default | fallback AI base URL |
| `DRAWIO_AI_OPENAI_API_KEY` / `OPENAI_API_KEY` | unset | OpenAI-compatible API key |
| `DRAWIO_AI_OPENAI_MODEL` / `OPENAI_MODEL` | unset | OpenAI-compatible model name |
| `DRAWIO_AI_OPENAI_BASE_URL` / `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL |
| `DRAWIO_AI_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY` | unset | Anthropic Messages API key |
| `DRAWIO_AI_ANTHROPIC_MODEL` / `ANTHROPIC_MODEL` | unset | Anthropic model name |
| `DRAWIO_AI_ANTHROPIC_BASE_URL` / `ANTHROPIC_BASE_URL` | `https://api.anthropic.com/v1` | Anthropic Messages base URL |
| `DRAWIO_AI_ALLOWED_ORIGINS` | unset | comma-separated extra origins allowed for client-supplied AI base URLs |
| `DRAWIO_AI_ALLOW_PRIVATE` | unset | set to `1` to allow client-supplied localhost/private AI endpoints |
| `DRAWIO_AI_MAX_PROMPT_CHARS` | `4000` | maximum prompt length for flowchart generation |
| `DRAWIO_AI_TIMEOUT_MS` | `45000` | upstream AI request timeout |
| `DRAWIO_AI_MAX_TOKENS` | `2200` | default AI output token budget |
| `DRAWIO_AI_TEMPERATURE` | `0.2` | default AI sampling temperature |

## Operations

Check runtime status and data capacity:

```powershell
npm run status
```

Create a timestamped copy of the data directory and write `backup-manifest.json`:

```powershell
npm run backup
```

The backup command copies sessions, employee files, metadata and share records.
Access logs are skipped by default to keep backups small.

## Verification

```powershell
npm run check
npm test
npm run status
```
