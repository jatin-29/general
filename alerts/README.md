# Telegram job collector

Every 30 minutes a GitHub Action reads the Telegram groups/channels you list in `config.toml`, keeps the
posts that look like job openings (your keywords), and sends them to **your own Saved Messages** in Telegram.
One place, searchable, on your phone. If the same job shows up in two groups you get it once.

Nothing to host, no website, no AI, no cost.

## Setup (once, about 10 minutes)

1. **Get Telegram API keys.** Go to https://my.telegram.org, log in, open *API development tools*, create an app.
   Copy the **api_id** and **api_hash**.
2. **Create your login string** (a secret that lets the Action read your chats as you). Do either:
   - On a computer: `pip install telethon` then `python alerts/setup.py`. Enter the keys, then your phone number,
     the code Telegram sends, and your 2-step password if you have one. It prints `TELEGRAM_SESSION_STRING` and
     lists your groups with their ids.
   - No computer: open https://colab.research.google.com, make a new notebook, and run these two cells:
     ```
     !pip -q install telethon
     ```
     ```
     from telethon import TelegramClient
     from telethon.sessions import StringSession
     api_id = int(input("API ID: ")); api_hash = input("API hash: ")
     client = TelegramClient(StringSession(), api_id, api_hash)
     await client.start()          # asks phone, code, password
     print(client.session.save())  # this long text is TELEGRAM_SESSION_STRING
     ```
3. **Add three secrets** in your GitHub repo: *Settings → Secrets and variables → Actions → New repository secret*:
   `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION_STRING`.
   Never share these or paste them in a chat. Anyone with the session string can act as your Telegram account.
4. **Choose your groups.** Edit `alerts/config.toml` on GitHub (pencil icon) and list them under `telegram_chats`,
   for example `"@some_jobs_channel"` or a private group's id like `"-1001234567890"`. Commit.
5. **Run it once.** *Actions → Job alerts → Run workflow*. Check your Telegram **Saved Messages**.

After that it runs by itself every 30 minutes. Edit `include` / `exclude` in `config.toml` to tune what counts as a job.

## Good to know

- The first run sends only the latest few posts per group (`first_run_backfill`), then only new ones.
- Optional: put a bot token and chat id in the secrets `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` to get a push
  notification (messages to Saved Messages don't buzz). Optional `YOUTUBE_API_KEY` if you also list YouTube channels.
- GitHub runs scheduled jobs on shared servers, and Telegram can occasionally log out a session used from a new
  place. If you get a "session is no longer valid" error, redo step 2 and update the secret, or run it on your own
  computer instead: `python alerts/run.py --loop 30`.
- GitHub pauses scheduled workflows in repos with no activity for 60 days; re-enable them in the Actions tab.
- Try it safely: `python alerts/run.py --dry-run` prints matches instead of sending.

## Tests

`pip install -r alerts/requirements.txt && pytest alerts/tests`
