# pdf-form-filling-service

Locally hosted PDF form-filling service. Edit existing form fields and drop in text/photos Adobe-style, then download the filled PDF. **Text and image only — no signatures.**

## Quick start (Docker)

```bash
docker-compose up -d --build
```

- Frontend: http://localhost:5173
- API docs: http://localhost:8000/docs

```bash
docker-compose logs -f   # follow logs
docker-compose down      # stop
```

## Local development

Backend (FastAPI, uv):

```bash
uv sync
uv run python3 -m api.app.main        # http://localhost:8000
```

Frontend (Vite, `apps/web`):

```bash
npm --prefix apps/web install
npm --prefix apps/web run dev         # http://localhost:5173
```

## Architecture

FastAPI backend (`api/app/main.py`, routes under `/api/v1`) + Vite frontend (`apps/web`).
PDF rendering via PDF.js, overlay editing via Fabric.js, PDF mutation/flattening via PyMuPDF on the backend.
See [CLAUDE.md](CLAUDE.md) for the full design, coordinate model, and gotchas.
