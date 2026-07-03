# Company Draw.io Server

Lightweight internal wrapper server for the company draw.io build.

## Run Locally

```powershell
cd E:\Work\AI\Draw\drawio\company-server
$env:PORT = "8081"
npm start
```

Open:

```text
http://127.0.0.1:8081/
```

## Login

- Account: employee ID
- Temporary password: `123456`
- Session cookie: HTTP-only, seven days by default
- Login page: `/login.html`
- Workspace page: `/app.html`

## Features

- Chinese company entry pages.
- Employee login with an HTTP-only session cookie.
- Per-employee file directory isolation.
- Diagram list, create, open, save, rename, delete.
- Atomic XML writes through a temporary file and rename.
- Etag conflict detection for concurrent saves.
- Read-only share token API and `/share.html` viewer page.
- XML download for owner and share visitor.

## API

```text
POST /api/login
GET  /api/me
GET  /api/session
POST /api/logout

GET    /api/files
POST   /api/files
GET    /api/files/:id
GET    /api/files/:id/download
PUT    /api/files/:id
DELETE /api/files/:id
POST   /api/files/:id/rename
POST   /api/files/:id/share

GET /api/share/:token
GET /api/share/:token/download

GET /api/health
GET /api/ops/status

POST /export
```

`/api/health` is a lightweight public probe for reverse proxies. `/api/ops/status`
returns storage counts, data-directory writability and runtime config. Set
`DRAWIO_OPS_TOKEN` and call it with `Authorization: Bearer <token>` for production
use; without that token it is available only to a logged-in employee session.
`/export` is a logged-in reverse proxy for an optional internal draw.io export
server configured with `DRAWIO_EXPORT_URL`.

## Data Layout

```text
data/
  sessions.json
  employees/
    10001/
      files/
        <file-id>.drawio
      meta/
        <file-id>.json
  shares/
    <token-hash>.json
  logs/
    access.log
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8081` | HTTP port |
| `DRAWIO_WEBAPP_DIR` | `../src/main/webapp` | draw.io static webapp |
| `DRAWIO_DATA_DIR` | `./data` | sessions, files and shares |
| `DRAWIO_TEMP_PASSWORD` | `123456` | temporary shared password |
| `DRAWIO_SESSION_DAYS` | `7` | cookie/session lifetime |
| `DRAWIO_COOKIE_SECURE` | unset | set to `1` behind HTTPS |
| `DRAWIO_MAX_JSON_BYTES` | `26214400` | JSON body limit |
| `DRAWIO_MAX_EXPORT_BYTES` | `52428800` | export proxy request body limit |
| `DRAWIO_ACCESS_LOG` | `./data/logs/access.log` | JSONL access log path; set `off` to disable |
| `DRAWIO_OPS_TOKEN` | unset | bearer token for `/api/ops/status` |
| `DRAWIO_EXPORT_URL` | unset | internal draw.io export server endpoint for `/export` |
| `DRAWIO_BACKUP_DIR` | `./backups` | backup output directory for `npm run backup` |
| `DRAWIO_BACKUP_INCLUDE_LOGS` | unset | set to `1` to include `data/logs` in backups |

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
