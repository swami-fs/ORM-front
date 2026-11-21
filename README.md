# ORM Front

Frontend + API gateway for product browsing and ReviewLens AI chat.

---

## Architecture overview

```text
Browser UI (React app, port 4200)
  -> ORM Front API (Express, port 3333)
      -> Product service (local)
      -> ReviewLens Chat API (external base URL via REVIEWLENS_API_BASE_URL)
```

### Main apps
- `apps/shop` — React UI
- `apps/api` — Express API + ReviewLens proxy

### Data flow (ReviewLens)
1. User logs in with auth key.
2. UI calls `/api/reviewlens/authenticate` to get bearer token.
3. User sets context (text / CSV / Amazon URL / Google Maps URL).
4. UI calls `/api/reviewlens/ingest-context` and receives `dataset_id`.
5. User asks questions.
6. UI calls `/api/reviewlens/chat` using `dataset_id`.

---

## Inputs and outputs

## UI input

### Login input
- Auth key (string)

### Context input
- Single textbox accepts:
  - raw review text (separate reviews with a blank line)
  - CSV text
  - Amazon URL
  - Google Maps URL

### Chat input
- Natural-language question about the ingested review context

---

## API input/output (ORM Front API)

All ReviewLens endpoints are exposed by `apps/api`:

### `POST /api/reviewlens/authenticate`
**Input**
```json
{ "authKey": "your-auth-key" }
```

**Output**
```json
{
  "success": true,
  "data": { "bearerToken": "..." }
}
```

### `POST /api/reviewlens/ingest-context`
**Input**
```json
{
  "reviewsText": "raw text, CSV text, or supported URL",
  "bearerToken": "...",
  "platform": "optional",
  "entityName": "optional"
}
```

**Output**
```json
{
  "success": true,
  "data": {
    "dataset_id": "uuid",
    "platform": "string",
    "entity_name": "string",
    "source_summary": "optional",
    "review_count": 12,
    "rating_count": 10,
    "average_rating": 4.2,
    "first_review_date": "2026-01-01",
    "last_review_date": "2026-10-01"
  }
}
```

### `POST /api/reviewlens/chat`
**Input**
```json
{
  "datasetId": "uuid-from-ingest",
  "question": "What are top complaints?",
  "topK": 12,
  "bearerToken": "..."
}
```

**Output**
```json
{
  "success": true,
  "data": {
    "decision": "answer",
    "answer": "Most frequent complaint is slow support response.",
    "evidence_review_ids": ["r2", "r5"]
  }
}
```

### `GET /api/reviewlens/versions`
**Output**
```json
{
  "success": true,
  "data": {
    "frontVersion": "1.0.0",
    "chatVersion": "1.0.0"
  }
}
```

---

## Local development

## Prerequisites
- Node.js 22+
- Corepack enabled
- Yarn 4

## Setup
```bash
corepack enable
yarn install
cp apps/api/.env.example apps/api/.env
```

Set required values in `apps/api/.env`:
- `REVIEWLENS_API_BASE_URL`
- `AUTH_KEY`
- `SECRET_KEY`
- `ALGORITHM`
- `FRONT_VERSION` (optional; default shown in footer if configured)

Start frontend + API:
```bash
yarn nx run @org/shop:serve
```

URLs:
- Shop UI: `http://localhost:4200`
- API: `http://localhost:3333`

---

## Container deployment

Use the included `docker-compose.yml`:

```bash
docker compose up -d
```

This starts:
- Shop UI on `4200`
- API on `3333`

Default compose env points ReviewLens to:
- `http://host.docker.internal:8090`

If your ReviewLens service is elsewhere, update `REVIEWLENS_API_BASE_URL` in `docker-compose.yml` (or override via environment).

Logs:
```bash
docker compose logs -f orm-front
```

Stop:
```bash
docker compose down
```

---

## User guidelines

1. **Login first** with a valid auth key.
2. **Set context before chatting**.
3. Use one context source at a time:
   - raw text reviews (blank line between reviews), or
   - CSV content, or
   - Amazon/Google Maps review URL.
4. Ask questions only about the ingested review context for best results.
5. If chat declines, refine the question to stay inside review evidence.
6. Re-run **Set context** whenever input data changes.
7. Footer shows front/chat versions for quick environment verification.

---

## Optional configuration

- `VITE_API_BASE_URL` (shop app):
  - Overrides API origin used by browser client.
  - If not set, app uses:
    - `http://localhost:3333` on localhost
    - `http(s)://<current-host>:3333` on non-localhost

---

## Operational notes

- API warnings/errors are written to `log/orm-front-api.log`.
