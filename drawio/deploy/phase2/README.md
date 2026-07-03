# Company Draw.io Deployment

This deployment runs draw.io behind the company login/session/file server.

## Run

From `E:\Work\AI\Draw\drawio`:

```powershell
docker compose -f deploy\phase2\docker-compose.yml up --build -d
```

Open:

```text
http://127.0.0.1:8080/
```

The image includes a container `HEALTHCHECK` against `/api/health`.

## Behavior

- First visit redirects to `/login.html`.
- Login uses employee ID and the temporary password `123456`.
- Sessions persist in the Docker volume under `/data/sessions.json`.
- Each employee gets isolated storage under `/data/employees/<employeeId>/`.
- `/app.html` lists the employee's own diagrams.
- `/editor.html?id=<file-id>` embeds draw.io and saves through the company API.
- `/share.html?token=<token>` opens a read-only viewer without login.
- `/api/health` can be used by Nginx or a container health checker.
- `/api/ops/status` reports file counts, storage usage and data-directory writability.

## Data Persistence

The compose file mounts the named volume `company-drawio-data` at `/data`.
Back up that volume or replace it with a host bind mount before production use.

Run a manual backup from inside the container image or a host checkout:

```powershell
cd company-server
$env:DRAWIO_DATA_DIR = "E:\path\to\data"
$env:DRAWIO_BACKUP_DIR = "E:\path\to\backups"
npm run backup
```

Backups include sessions, employee files, metadata and share records. Access logs
under `/data/logs` are skipped unless `DRAWIO_BACKUP_INCLUDE_LOGS=1`.

## Operations

Recommended production environment variables:

```text
DRAWIO_COOKIE_SECURE=1
DRAWIO_OPS_TOKEN=<long-random-token>
DRAWIO_ACCESS_LOG=/data/logs/access.log
DRAWIO_EXPORT_URL=http://drawio-export:8000/export
```

Check status with a bearer token:

```powershell
curl -H "Authorization: Bearer <long-random-token>" http://127.0.0.1:8080/api/ops/status
```

An HTTPS reverse-proxy template is available at `deploy/phase2/nginx-https.example.conf`.
Replace `drawio.internal.example.com` and the certificate paths with the internal
domain and certificate issued for the deployment host.

## Export Server

XML downloads are served by the company API. PNG and SVG can be exported in the
browser from `/editor.html` through draw.io's embedded export protocol.

PDF and larger server-side exports should use an internal draw.io export service.
Set `DRAWIO_EXPORT_URL` to that service's export endpoint; the company server
will accept logged-in `/export` requests and proxy them to the internal endpoint.
If `DRAWIO_EXPORT_URL` is unset, `/export` returns `503 export_server_not_configured`
instead of silently calling an external converter.

## Production Notes

- Put Nginx or another internal gateway in front of the container.
- Enable HTTPS and set `DRAWIO_COOKIE_SECURE=1`.
- Replace the temporary password flow with LDAP/SSO or first-login password setup when ready.
- Add scheduled backups and alert on `/api/ops/status` storage growth before broader rollout.
