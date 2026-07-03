# Phase 1 Deployment

This deployment serves the customized draw.io webapp as a static internal site.

## Run

From `E:\Work\AI\Draw\drawio`:

```powershell
docker compose -f deploy\phase1\docker-compose.yml up --build -d
```

Open:

```text
http://127.0.0.1:8080/index.html
```

## Current behavior

- Default language is Simplified Chinese.
- Google Drive, Dropbox, OneDrive, GitHub, GitLab and Trello clients are disabled by default.
- Built-in public sharing/publishing/plugin menu items are hidden.
- `/api/`, `/export` and `/plantuml` are placeholders for later phases.

## Later phases

- Phase 2 adds login/session API behind `/api/`.
- Phase 3 adds server-side file persistence.
- Phase 6 can proxy `/export` to an internal export server.
