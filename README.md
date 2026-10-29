# OpeningsHub

Collects off-campus job/internship openings from **Telegram** groups/channels and **YouTube** channels, extracts structured data with Claude, and shows them in a filterable dashboard. Anything else (e.g. a WhatsApp post) you add by hand on the **Add** page, with optional AI auto-fill.

```
Telegram (Telethon) ─┐
YouTube (RSS / API)  ├─> RawItem ─> Claude extractor ─> dedupe ─> Opening ─> FastAPI ─> Next.js dashboard
Add page (manual)    ─┘                                                  └─> optional Telegram bot push
```

* **Backend:** FastAPI, SQLAlchemy (SQLite or Postgres), APScheduler (polls every 5 min inside the process).
* **Frontend:** Next.js static export, TypeScript, Tailwind. Hosted on GitHub Pages.
* **Everything is configured on the website:** API keys and Telegram login (**Settings**), which groups/channels to read (**Sources**), manual openings (**Add**). The only server-side setting is the admin key.

## Using the website

1. **Settings → Admin key:** paste the backend's `API_KEY` (kept only in your browser).
2. **Settings → AI extraction:** paste your Anthropic API key (console.anthropic.com; pay-per-use, `claude-haiku-4-5` by default, 10 posts batched per request).
3. **Settings → Telegram:** paste the API ID/hash from https://my.telegram.org → *API development tools*, then log in with your phone number, the code Telegram sends, and your 2-step password if you have one. The session is stored in your backend's database, so anyone with the admin key and database access can act as your Telegram account.
4. **Sources → Telegram:** *Pick from my Telegram chats* lists the groups/channels you've joined; tick the ones that post jobs. Public channels can also be added by `@username`. Only the sources listed are ever read.
5. **Sources → YouTube:** paste a channel URL, `@handle` or channel id.
6. **Add:** type in an opening, or paste a post and press *Auto-fill*.

On first poll a Telegram source backfills its latest 50 messages; afterwards only new messages are fetched. *Fetch now* on the Sources page runs a cycle immediately.

**YouTube note:** YouTube's RSS feed sometimes returns 404 to server/datacenter IPs (it did in the environment this was built in). If a channel fails, add a free YouTube Data API key in Settings and the collector uses the API instead.

## Chrome extension: autofill job forms

`extension/` is a Chrome extension (Manifest V3) that fills job application forms with the details on the
site's **My profile** page: Google Forms, Workday, Greenhouse, Lever, Ashby, SmartRecruiters, Darwinbox, Keka
and any other site (via the extension button or **Alt+Shift+F**). It also puts your resume PDF into the
"Resume / CV" upload box. It never submits a form: filled fields turn green, and required ones it couldn't
answer turn yellow for you.

- **Install:** *My profile → Chrome extension → Download*, unzip, `chrome://extensions` → Developer mode →
  *Load unpacked* → pick the `openingshub-autofill` folder. The Pages workflow builds the zip from `extension/`.
- **Your details:** when you open the site, `sync.js` copies the profile from the site's localStorage into the
  extension's local storage. Nothing is sent anywhere. Questions it can't map get answered from
  *My profile → Saved answers* ("if the question contains … answer …").
- **Test:** `node extension/test/e2e.cjs` loads the real extension in Chromium and fills look-alike Google
  Form, Workday and Greenhouse pages served at their real addresses.

## Run locally

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # set API_KEY to any secret; everything else is optional
uvicorn app.main:app --reload --port 8000

cd ../frontend
cp .env.example .env.local  # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install && npm run dev  # http://localhost:3000, then open Settings
```

Keys can still be supplied as environment variables (see `backend/.env.example`); values saved on the Settings page take priority.

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

Write one file in `backend/app/collectors/`: subclass `Collector`, set `source_type`, implement `collect(source, last_external_id) -> list[RawItemData]`, decorate with `@register`, and import it in `collectors/__init__.py`. Set `polled = False` for push-style sources.

## Tests

```bash
cd backend && pytest
```

Covers dedupe, extractor JSON validation/retry (LLM mocked), the pipeline, expiry, the scheduler and the API. No network or API keys needed. The Telegram network code is only unit-tested for its pure helpers; it needs a real session to exercise.

## Deployment notes

* **Frontend on GitHub Pages:** the frontend is a static export, and `.github/workflows/pages.yml` builds and deploys it on every push to `main` (or this repo's default branch) that touches `frontend/`. One-time setup:
  1. Repo **Settings → Pages → Source: GitHub Actions**. With nothing else configured the site deploys in **demo mode** (sample data, a banner says so).
  2. For real data: deploy the backend somewhere with HTTPS (GitHub Pages can't run Python; see Backend below), then add the repo variable **Settings → Secrets and variables → Actions → Variables → `API_URL`** = its `https://…` URL (no trailing slash) and re-run the workflow.
  4. On the backend set `FRONTEND_ORIGIN=https://<your-username>.github.io` (origin only, no `/general` path).
  The site is served at `https://<your-username>.github.io/<repo-name>/`. The detail page lives at `/opening?id=N` because static export has no dynamic routes. To test a Pages build locally: `NEXT_PUBLIC_BASE_PATH=/general npm run build` then serve `out/` under `/general`.
* **Frontend (Vercel/Netlify):** set the project root to `frontend/`, and `NEXT_PUBLIC_API_URL` to your backend's public URL.
* **Backend:** needs a long-running process (Render, Railway, Fly.io, a VPS), not serverless, because the scheduler runs inside it. Run a **single instance** (multiple would duplicate polling). Set `FRONTEND_ORIGIN` to your frontend URL (comma-separate several) for CORS, and set `API_KEY`.
* **Database:** SQLite needs a persistent volume. For Postgres: `pip install "psycopg[binary]"` and `DATABASE_URL=postgresql+psycopg://user:pass@host/db` (not tested in this repo; tables are created on start-up, there are no migrations yet).
* **Security:** reading openings is public. Everything that changes data, reveals/sets secrets, or spends money requires the `X-API-Key` header (the admin key), and the secrets endpoints are disabled until `API_KEY` is set. Use a long random `API_KEY`, and keep the site's browser profile private since the key is stored there.

## Hosting the backend (Render)

`render.yaml` + `backend/Dockerfile` deploy the API as a Render Blueprint: *New → Blueprint →* pick this repo. It generates `API_KEY` (copy it from the service's Environment tab into the website's Settings) and asks for `DATABASE_URL`.

Because your keys and Telegram login live in the database, `DATABASE_URL` must be a **persistent** Postgres URL (Neon's and Supabase's free tiers work; so does Render Postgres). On Render's free plan the service also sleeps after ~15 minutes idle, which pauses polling; a paid instance (or an uptime pinger hitting `/api/health`) keeps it awake. Then set the `API_URL` Actions variable to the service URL and re-run the Pages workflow. Postgres support is included but wasn't tested against a live Postgres here.

## Spotify "now playing" (website)

The floating Spotify button on the site shows what you are playing and tints the page with the album colours.
Setup (once): create a free app at https://developer.spotify.com/dashboard (tick *Web API*), add the site address
(shown in the panel, e.g. `https://<you>.github.io/<repo>/`) as a **Redirect URI**, paste the **Client ID** into the
panel and press *Connect*. It uses Spotify's login with PKCE (no secret and no server). The Client ID and the tokens
are kept in your browser only. Spotify may limit developer apps (for example to a few approved users), so check the
dashboard if login is refused.
