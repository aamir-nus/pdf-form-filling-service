# pdf-form-filling-service

Locally hosted PDF form-filling service. Edit existing form fields and drop in text/photos Adobe-style, then download the filled PDF. **Text and image only — no signatures.**

## Quick start (Docker)

```bash
docker-compose up -d --build
```

- Frontend: http://localhost:5172
- API docs: http://localhost:7999/docs

```bash
docker-compose logs -f   # follow logs
docker-compose down      # stop
```

## Local development

Backend (FastAPI, uv):

```bash
uv sync
uv run python3 -m api.app.main        # http://localhost:7999
```

Frontend (Vite, `apps/web`):

```bash
npm --prefix apps/web install
npm --prefix apps/web run dev         # http://localhost:5172
```

## Architecture

FastAPI backend (`api/app/main.py`, routes under `/api/v1`) + Vite frontend (`apps/web`).
PDF rendering via PDF.js, overlay editing via Fabric.js, PDF mutation/flattening via PyMuPDF on the backend.
See [CLAUDE.md](CLAUDE.md) for the full design, coordinate model, and gotchas.

## Editor UX

- **Pages**: right-side thumbnail panel; click a thumbnail to edit that page (one page in focus at a time).
- **Form fields**: detected AcroForm fields show as translucent highlights — click one to type/focus (Adobe-style click-to-fill). Already-filled values are pre-populated. Checkboxes show the PDF's own box; your change draws on top.
- **Freeform**: Add text / Add image (or drag & drop an image onto the page), then move/resize.
- **Delete**: select an overlay and press `Delete`/`Backspace`, or right-click → Delete.
- **Download**: fills fields, stamps overlays, flattens server-side → `filled.pdf`.

## Known rendering notes

- PDF.js paints each field's appearance onto the page, so overlays stay translucent to avoid double-rendering; checkboxes are transparent until changed.
- The editor scrolls internally (page fully reachable); the thumbnail panel scrolls independently.
