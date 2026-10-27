# OpeningsHub

Aggregates off-campus job/internship openings from **Telegram** channels/groups, **WhatsApp** groups (exported chats) and **YouTube** channels, extracts structured data with Claude, and shows it in a filterable dashboard.

```
Telegram (Telethon) ─┐
YouTube (RSS)        ├─> RawItem ─> Claude extractor ─> dedupe ─> Opening ─> FastAPI ─> Next.js dashboard
WhatsApp (.txt)      ─┘                                                  └─> optional Telegram bot push
```

* **Backend** – FastAPI, SQLAlchemy, SQLite, APScheduler (collectors run in-process every 5 min).
* **Frontend** – Next.js (App Router), TypeScript, Tailwind.
* Only the channels/groups you add as **Sources** are read. Nothing else on your accounts is touched.

## Quick start

Prerequisites: Python 3.11+, Node 18.18+.

### 1. Get credentials

| What | Where | Needed for |
|---|---|---|
| Anthropic API key | https://console.anthropic.com → API keys | extraction (required). Paid per use; the default `claude-haiku-4-5` is the cheap tier and items are batched 10 per request |
| Telegram `api_id` / `api_hash` | https://my.telegram.org → *API development tools* → create an app | Telegram collector |
| Telegram session string | `python scripts/create_telegram_session.py` (below) | Telegram collector |
| Bot token + chat id *(optional)* | `@BotFather` → `/newbot`; message your bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` for your chat id | push notifications |
| YouTube Data API key *(optional)* | Google Cloud console → YouTube Data API v3 | full video descriptions (RSS only has the first part). Free quota |

YouTube-only or WhatsApp-only use needs just the Anthropic key.

### 2. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill in the values
python scripts/create_telegram_session.py     # prints TELEGRAM_SESSION_STRING; paste into .env
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs · health: `GET /api/health`.

> The session string grants full access to your Telegram account. Keep it in `.env` / a secret store, never in git.

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev                  # http://localhost:3000
```

## Choosing which groups/channels to read

Add one **Source** per channel/group, via the API (a UI for this isn't built yet):

```bash
# public Telegram channel/group  (@username or t.me link)
curl -X POST localhost:8000/api/sources -H 'content-type: application/json' \
     -d '{"type":"telegram","identifier":"@some_jobs_channel"}'

# private Telegram group/channel you have joined: use its numeric id
python scripts/create_telegram_session.py --list-chats      # lists ids of your joined chats
curl -X POST localhost:8000/api/sources -H 'content-type: application/json' \
     -d '{"type":"telegram","identifier":"-1001234567890"}'

# YouTube channel: the channel id (starts with UC…, from the channel's About → Share → Copy channel ID)
curl -X POST localhost:8000/api/sources -H 'content-type: application/json' \
     -d '{"type":"youtube","identifier":"UCxxxxxxxxxxxxxxxxxxxxxx"}'

# pause a source
curl -X PATCH localhost:8000/api/sources/3 -H 'content-type: application/json' -d '{"enabled":false}'
```

On the first poll a Telegram source backfills the latest 50 messages; afterwards only messages newer than the last stored one are fetched.

**WhatsApp** has no safe official API for reading groups, so it works from exports: in the group, ⋮ → *More* → *Export chat* → **Without media**, then upload the `.txt` on the `/upload` page. The group name (from the file name, or the optional field) becomes the source, and re-uploading a newer export only processes new messages. Parsed formats: Android (`DD/MM/YY, HH:MM - Sender: msg`, 12h and 24h) and iOS (`[DD/MM/YY, HH:MM:SS] Sender: msg`). Messages under 25 characters without a link are skipped before the LLM to save cost.

## How it works

Every `POLL_INTERVAL_MINUTES` (default 5) the scheduler:
1. polls each enabled source, saving new `RawItem`s (unique per source + external id);
2. sends unprocessed items to Claude in batches of 10, validating the JSON with Pydantic (one retry for invalid output; an item that keeps failing is given up after 3 runs);
3. creates an `Opening` only when `is_opening` is true and company + role were found;
4. dedupes by normalized apply link (tracking params stripped), or normalized company + role when there's no link;
5. marks openings with `deadline < today` as expired (also hourly);
6. optionally pushes new openings to your Telegram chat.

If `ANTHROPIC_API_KEY` is unset, items are stored but extraction is skipped.

`POST /api/scrape/now` triggers a cycle manually. It requires the `X-API-Key` header matching `API_KEY` (disabled if `API_KEY` is empty).

### Real-time Telegram listener (optional)

```bash
python -m app.collectors.telegram     # run from backend/, separate long-running process
```

It uses the same pipeline and DB. Set `TELEGRAM_POLL_ENABLED=false` for the web process so both don't use the same session at once (Telegram can invalidate a session used concurrently). The listener reads its source list at start-up; restart it after adding sources.

### Adding a new source type

Write one file in `backend/app/collectors/`: subclass `Collector`, set `source_type`, implement `collect(source, last_external_id) -> list[RawItemData]`, decorate with `@register`, and import it in `collectors/__init__.py`. Set `polled = False` for push-style sources like WhatsApp.

## Tests

```bash
cd backend && pytest
```

Covers the WhatsApp parser, dedupe, extractor JSON validation/retry (LLM mocked), the pipeline, expiry, the scheduler and the API. No network or API keys needed. The Telegram network code is only unit-tested for its pure helpers; it needs a real session to exercise.

## Deployment notes

* **Frontend on GitHub Pages:** the frontend is a static export, and `.github/workflows/pages.yml` builds and deploys it on every push to `main` (or this repo's default branch) that touches `frontend/`. One-time setup:
  1. Repo **Settings → Pages → Source: GitHub Actions**. With nothing else configured the site deploys in **demo mode** (sample data, a banner says so).
  2. For real data: deploy the backend somewhere with HTTPS (GitHub Pages can't run Python; see Backend below), then add the repo variable **Settings → Secrets and variables → Actions → Variables → `API_URL`** = its `https://…` URL (no trailing slash) and re-run the workflow.
  4. On the backend set `FRONTEND_ORIGIN=https://<your-username>.github.io` (origin only, no `/general` path).
  The site is served at `https://<your-username>.github.io/<repo-name>/`. The detail page lives at `/opening?id=N` because static export has no dynamic routes. To test a Pages build locally: `NEXT_PUBLIC_BASE_PATH=/general npm run build` then serve `out/` under `/general`.
* **Frontend (Vercel/Netlify):** set the project root to `frontend/`, and `NEXT_PUBLIC_API_URL` to your backend's public URL.
* **Backend:** needs a long-running process (Render, Railway, Fly.io, a VPS), not serverless, because the scheduler runs inside it. Run a **single instance** (multiple would duplicate polling). Set `FRONTEND_ORIGIN` to your frontend URL (comma-separate several) for CORS, and set `API_KEY`.
* **Database:** SQLite needs a persistent volume. For Postgres: `pip install "psycopg[binary]"` and `DATABASE_URL=postgresql+psycopg://user:pass@host/db` (not tested in this repo; tables are created on start-up, there are no migrations yet).
* **Security:** `/api/upload/whatsapp`, `/api/sources` and the PATCH endpoints are unauthenticated (the dashboard is meant for personal use) and an upload spends Anthropic credits. If you expose the backend publicly, put it behind auth (a reverse proxy with basic auth, Cloudflare Access, etc.).
