import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run  # noqa: E402
from core import Config, JobStore, State, extract_links, fingerprint, format_alert, is_match, load_config, parse_feed  # noqa: E402

CFG = Config(include=["hiring", "intern", "internship", "recruit*"], exclude=["course", "webinar"], first_run_backfill=2)


# ---------------------------------------------------------------- matching
def test_whole_word_matching():
    assert is_match("We are HIRING freshers", CFG.include, CFG.exclude)
    assert not is_match("Our internal tools team", CFG.include, CFG.exclude)  # 'intern' != 'internal'
    assert is_match("Internship at Acme", CFG.include, CFG.exclude)
    assert is_match("Recruitment drive 2026", CFG.include, CFG.exclude)  # wildcard
    assert not is_match("hiring? join our paid course", CFG.include, CFG.exclude)  # exclude wins
    assert not is_match("good morning everyone", CFG.include, CFG.exclude)


def test_links_and_fingerprint():
    a = "Acme hiring! Apply: https://www.acme.com/jobs/1/?utm_source=tg."
    b = "Hiring at Acme, link http://acme.com/jobs/1"
    assert extract_links(a) == ["https://www.acme.com/jobs/1/?utm_source=tg"]
    assert fingerprint(a) == fingerprint(b) == "link:acme.com/jobs/1"
    assert fingerprint("hiring now https://t.me/x/1") .startswith("txt:")  # telegram post links aren't apply links
    assert fingerprint("Same Text!") == fingerprint("same   text")


def test_format_alert():
    msg = format_alert("Jobs", "x" * 50 + " https://a.co/1", "https://t.me/j/9", max_chars=20)
    assert msg.startswith("📌 Jobs") and "…" in msg and "Apply: https://a.co/1" in msg and "Post: https://t.me/j/9" in msg


def test_config_and_state_roundtrip(tmp_path):
    (tmp_path / "c.toml").write_text('telegram_chats=["@a"]\ninclude=["hiring"]\nunknown_key=1\n')
    cfg = load_config(tmp_path / "c.toml")
    assert cfg.telegram_chats == ["@a"] and cfg.first_run_backfill == 3
    st = State()
    st.telegram["@a"] = 5
    for i in range(1500):
        st.mark_seen(f"fp{i}")
    st.save(tmp_path / "s.json")
    loaded = State.load(tmp_path / "s.json")
    assert loaded.telegram == {"@a": 5} and len(loaded.seen) == 1000 and loaded.was_seen("fp1499")
    assert State.load(tmp_path / "missing.json").seen == []  # a fresh start never crashes


# ---------------------------------------------------------------- Telegram
class FakeTelegram:
    def __init__(self, chats):
        self.chats = chats  # ref -> (entity, [(id, text)])

    async def iter_dialogs(self, limit=None):
        for ent, rows in self.chats.values():
            last = max(rows, key=lambda r: r[0]) if rows else None
            yield SimpleNamespace(entity=ent, message=SimpleNamespace(message=last[1]) if last else None)

    async def get_entity(self, ref):
        found = self.chats.get(ref) or self.chats.get(str(ref)) or self.chats["@" + str(ref)]  # run.py strips '@', ids become ints
        return found[0]

    async def iter_messages(self, entity, limit=None, min_id=None):
        rows = next(m for e, m in self.chats.values() if e is entity)
        rows = sorted(rows, key=lambda r: -r[0])  # newest first, like Telethon
        n = 0
        for mid, text in rows:
            if min_id is not None and mid <= min_id:
                continue
            if limit is not None and n >= limit:
                return
            n += 1
            yield SimpleNamespace(id=mid, message=text)


def entity(name):
    return SimpleNamespace(title=name, username=name.lower(), id=1)


def run_async(coro):
    return asyncio.run(coro)


def make_notifier(fail_on=None):
    sent = []

    async def notify(text):
        if fail_on and fail_on in text:
            raise RuntimeError("telegram down")
        sent.append(text)

    return sent, notify


def test_first_run_sends_only_latest_then_only_new():
    msgs = [(1, "hiring old one https://a.co/old"), (2, "hello all"), (3, "hiring interns https://a.co/2"), (4, "Acme hiring https://a.co/3")]
    tg = FakeTelegram({"@jobs": (entity("Jobs"), msgs)})
    state, (sent, notify) = State(), make_notifier()
    assert run_async(run.check_telegram(tg, "@jobs", state, CFG, notify)) == 2  # backfill=2 -> ids 3,4
    assert [("a.co/2" in s, "a.co/3" in s) for s in sent] == [(True, False), (False, True)]
    assert state.telegram["@jobs"] == 4 and "t.me/jobs/3" in sent[0]

    msgs += [(5, "not a job"), (6, "course: hiring skills https://a.co/x"), (7, "Zed recruiting https://a.co/7")]
    sent.clear()
    assert run_async(run.check_telegram(tg, "@jobs", state, CFG, notify)) == 1  # only msg 7 ('recruit*'); 6 is excluded
    assert "a.co/7" in sent[0] and state.telegram["@jobs"] == 7
    sent.clear()
    assert run_async(run.check_telegram(tg, "@jobs", state, CFG, notify)) == 0  # nothing new


def test_first_run_backfill_zero_is_baseline_only():
    tg = FakeTelegram({"@jobs": (entity("Jobs"), [(1, "hiring https://a.co/1"), (2, "hiring https://a.co/2")])})
    state, (sent, notify) = State(), make_notifier()
    cfg = Config(include=["hiring"], first_run_backfill=0)
    assert run_async(run.check_telegram(tg, "@jobs", state, cfg, notify)) == 0 and sent == []
    assert state.telegram["@jobs"] == 2


def test_same_job_in_two_groups_alerts_once():
    link = "hiring Acme https://acme.com/j/1"
    tg = FakeTelegram({"@a": (entity("A"), [(1, link)]), "@b": (SimpleNamespace(title="B", username="b", id=2), [(1, link + "?utm_source=wa")])})
    state, (sent, notify) = State(), make_notifier()
    cfg = Config(include=["hiring"], first_run_backfill=5)
    total = run_async(run.check_telegram(tg, "@a", state, cfg, notify)) + run_async(run.check_telegram(tg, "@b", state, cfg, notify))
    assert total == 1 and len(sent) == 1


def test_failed_send_is_retried_next_run():
    tg = FakeTelegram({"@jobs": (entity("Jobs"), [(1, "hiring one https://a.co/1"), (2, "hiring two https://a.co/2")])})
    state = State()
    cfg = Config(include=["hiring"], first_run_backfill=5)
    sent, notify = make_notifier(fail_on="a.co/2")
    with pytest.raises(RuntimeError):
        run_async(run.check_telegram(tg, "@jobs", state, cfg, notify))
    assert state.telegram["@jobs"] == 1 and len(sent) == 1  # message 2 not marked as done
    sent2, notify2 = make_notifier()
    assert run_async(run.check_telegram(tg, "@jobs", state, cfg, notify2)) == 1 and "a.co/2" in sent2[0]


# ---------------------------------------------------------------- YouTube
FEED = """<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
<entry><yt:videoId>v2</yt:videoId><title>Acme hiring interns</title><link rel="alternate" href="https://www.youtube.com/watch?v=v2"/><media:group><media:description>Apply https://acme.com/j/9</media:description></media:group></entry>
<entry><yt:videoId>v1</yt:videoId><title>Cooking pasta</title><link rel="alternate" href="https://www.youtube.com/watch?v=v1"/><media:group><media:description>yum</media:description></media:group></entry></feed>"""


def test_parse_feed():
    vids = parse_feed(FEED)
    assert [v["id"] for v in vids] == ["v2", "v1"] and "acme.com/j/9" in vids[0]["description"]


def test_youtube_first_run_then_only_new():
    uc = "UC" + "a" * 22
    state, (sent, notify) = State(), make_notifier()
    cfg = Config(include=["hiring"], first_run_backfill=1)
    vids = parse_feed(FEED)
    assert run_async(run.check_youtube(uc, state, cfg, notify, videos=vids)) == 1
    assert "watch?v=v2" in sent[0] and state.youtube[uc] == ["v1", "v2"]
    new = {"id": "v3", "title": "Beta is hiring", "description": "https://beta.io/apply", "url": "https://www.youtube.com/watch?v=v3"}
    sent.clear()
    assert run_async(run.check_youtube(uc, state, cfg, notify, videos=[new] + vids)) == 1 and "beta.io" in sent[0]
    assert run_async(run.check_youtube(uc, state, cfg, notify, videos=[new] + vids)) == 0


def test_main_requires_a_way_to_send():
    with pytest.raises(SystemExit):
        run_async(run.run_once(Config(), State(), {}))
    sent = []
    assert run_async(run.run_once(Config(), State(), {}, dry_run=True)) == 0  # dry run needs no credentials


def test_session_string_is_cleaned_and_validated():
    good = "1" + "A" * 352
    assert run.clean_session(f'  "{good[:100]}\n{good[100:]}"  ') == good  # spaces/newlines/quotes removed
    env = {"TELEGRAM_API_ID": "1", "TELEGRAM_API_HASH": "h", "TELEGRAM_SESSION_STRING": "1" + "A" * 200}
    with pytest.raises(run.AuthError, match="200|201"):
        run_async(run.run_once(Config(), State(), env))


def test_store_only_public_channels_and_dedupes(tmp_path):
    msgs = [(1, "hiring Acme https://acme.com/j/1")]
    private = SimpleNamespace(title="Premium", username=None, id=9)
    tg = FakeTelegram({"@pub": (entity("Pub"), msgs), "-100": (private, [(1, "hiring Secret https://secret.com/j")])})
    state, (sent, notify) = State(), make_notifier()
    store = JobStore()
    cfg = Config(include=["hiring"], first_run_backfill=5)
    run_async(run.check_telegram(tg, "@pub", state, cfg, notify, store))
    run_async(run.check_telegram(tg, "-100", state, cfg, notify, store))
    assert len(sent) == 2  # both reach Saved Messages
    assert [j["apply_link"] for j in store.jobs] == ["https://acme.com/j/1"]  # private group is NOT published
    assert store.jobs[0]["post_url"] == "https://t.me/pub/1" and store.jobs[0]["source"] == "Pub"
    assert store.add(dict(store.jobs[0])) is False  # same job twice

    path = tmp_path / "data" / "jobs.json"
    store.save(path)
    assert JobStore.load(path).jobs[0]["id"] == store.jobs[0]["id"]
    empty = JobStore()
    other = tmp_path / "none.json"
    empty.save(other)
    assert not other.exists()  # nothing new => no file change => no commit


# ---------------------------------------------------------------- encrypted job list
def test_encryption_roundtrip_and_wrong_password(tmp_path):
    from core import StoreLocked, decrypt_payload, encrypt_payload

    env = encrypt_payload({"jobs": [{"text": "secret post"}]}, "pw-1")
    assert "secret post" not in str(env) and decrypt_payload(env, "pw-1") == {"jobs": [{"text": "secret post"}]}
    with pytest.raises(Exception):
        decrypt_payload(env, "wrong")

    store = JobStore(password="pw-1")
    store.add({"fingerprint": "f", "id": "i", "text": "members only post"})
    path = tmp_path / "jobs.json"
    store.save(path)
    assert "members only post" not in path.read_text()  # unreadable without the password
    assert JobStore.load(path, "pw-1").jobs[0]["text"] == "members only post"
    with pytest.raises(StoreLocked):
        JobStore.load(path, None)  # must not silently start empty and overwrite it
    with pytest.raises(StoreLocked):
        JobStore.load(path, "wrong")


def test_private_group_is_stored_only_when_encrypted():
    private = SimpleNamespace(title="Premium", username=None, id=9)
    tg = FakeTelegram({"-100": (private, [(1, "hiring Secret https://secret.com/j")])})
    cfg = Config(include=["hiring"], first_run_backfill=5)
    plain, enc = JobStore(), JobStore(password="pw")
    for store in (plain, enc):
        sent, notify = make_notifier()
        run_async(run.check_telegram(tg, "-100", State(), cfg, notify, store))
        assert len(sent) == 1  # always reaches Saved Messages
    assert plain.jobs == [] and len(enc.jobs) == 1


# ---------------------------------------------------------------- Saved Messages as an inbox
def test_saved_messages_inbox():
    me = SimpleNamespace(first_name="Me", username="my_public_username", id=1)  # a username must NOT make it public
    msgs = [
        (1, "📌 Jobs\n\nold alert the collector wrote https://a.co/alert"),
        (2, "✅ Job alerts are connected. New matching posts will show up here."),
        (3, "Forwarded from WhatsApp: Acme walk-in drive tomorrow 10am, Pune. Contact 99999 99999"),
    ]
    tg = FakeTelegram({"me": (me, msgs)})
    cfg = Config(include=["hiring"], first_run_backfill=5)  # post has no keyword, but it was forwarded on purpose
    sent, notify = make_notifier()
    plain, enc = JobStore(), JobStore(password="pw")
    assert run_async(run.check_telegram(tg, "me", State(), cfg, notify, plain)) == 1
    assert run_async(run.check_telegram(tg, "me", State(), cfg, notify, enc)) == 1
    assert sent == []  # no duplicate alert for something already in Saved Messages
    assert plain.jobs == []  # never stored in plain text
    assert len(enc.jobs) == 1 and enc.jobs[0]["source"] == "Saved Messages" and "Acme walk-in" in enc.jobs[0]["text"]
    assert enc.jobs[0]["post_url"] is None  # the collector's own 📌/✅ messages were ignored


# ---------------------------------------------------------------- bundled alerts (Telegram flood limit)
class FloodWait(Exception):
    def __init__(self, seconds):
        super().__init__(f"A wait of {seconds} seconds is required")
        self.seconds = seconds


def test_outbox_bundles_many_jobs_into_few_messages():
    sent = []

    async def send(t):
        sent.append(t)

    box = run.Outbox(send, pause=0)
    for i in range(25):
        run_async(box.add(f"📌 Premium\n\nJob {i} " + "x" * 600))
    assert run_async(box.flush()) == len(sent) and len(sent) <= 6  # 25 jobs, not 25 messages
    assert all(len(t) <= 3800 and t.startswith("📌") for t in sent)  # each starts like an own alert, so "me" skips it
    assert sum(t.count("📌") for t in sent) == 25


def test_outbox_survives_flood_limit(monkeypatch):
    calls = []

    async def no_sleep(s):
        calls.append(("sleep", s))

    monkeypatch.setattr(run.asyncio, "sleep", no_sleep)
    attempts = {"n": 0}

    async def short_wait_then_ok(t):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise FloodWait(5)

    box = run.Outbox(short_wait_then_ok, pause=0)
    run_async(box.add("📌 a"))
    assert run_async(box.flush()) == 1 and ("sleep", 6) in calls  # short waits are waited out

    async def long_wait(t):
        raise FloodWait(296)

    box = run.Outbox(long_wait, pause=0)
    run_async(box.add("📌 a"))
    assert run_async(box.flush()) == 0  # long waits: give up quietly, no exception


def test_website_updated_even_if_alerts_fail():
    private = SimpleNamespace(title="Premium", username=None, id=9)
    tg = FakeTelegram({"-100": (private, [(1, "hiring A https://a.co/1"), (2, "hiring B https://b.co/2")])})
    store = JobStore(password="pw")
    sent, notify = make_notifier(fail_on="b.co")
    with pytest.raises(RuntimeError):
        run_async(run.check_telegram(tg, "-100", State(), Config(include=["hiring"], first_run_backfill=5), notify, store))
    assert len(store.jobs) == 2  # stored before the alert was attempted


# ---------------------------------------------------------------- accept_all + rescan
def test_accept_all_chat_keeps_posts_without_keywords_but_blocks_excluded():
    private = SimpleNamespace(title="Premium", username=None, id=9)
    msgs = [(1, "Zeta Labs | SDE 1 | Bengaluru https://zeta.io/a"), (2, "Join our paid course today"), (3, "hiring QA https://q.co/1")]
    cfg = Config(include=["hiring"], exclude=["course"], accept_all=["-100"], first_run_backfill=5)
    store = JobStore(password="pw")
    sent, notify = make_notifier()
    assert run_async(run.check_telegram(FakeTelegram({"-100": (private, msgs)}), "-100", State(), cfg, notify, store)) == 2
    assert {j["apply_link"] for j in store.jobs} == {"https://zeta.io/a", "https://q.co/1"}  # course ad still blocked


def test_rescan_recovers_skipped_posts_without_duplicates_or_moving_back():
    private = SimpleNamespace(title="Premium", username=None, id=9)
    msgs = [(1, "hiring A https://a.co/1"), (2, "Zeta Labs SDE 1 https://zeta.io/a"), (3, "Acme Analyst https://acme.io/b")]
    tg = FakeTelegram({"-100": (private, msgs)})
    state, store = State(), JobStore(password="pw")
    sent, notify = make_notifier()
    strict = Config(include=["hiring"], first_run_backfill=5)
    assert run_async(run.check_telegram(tg, "-100", state, strict, notify, store)) == 1  # 2 skipped by the keyword filter
    relaxed = Config(include=["hiring"], accept_all=["-100"], first_run_backfill=5)
    assert run_async(run.check_telegram(tg, "-100", state, relaxed, notify, store)) == 0  # normal run: nothing newer
    assert run_async(run.check_telegram(tg, "-100", state, relaxed, notify, store, rescan=10)) == 2  # the 2 come back
    assert len(store.jobs) == 3 and state.telegram["-100"] == 3
    assert run_async(run.check_telegram(tg, "-100", state, relaxed, notify, store, rescan=10)) == 0  # no duplicates


# ---------------------------------------------------------------- delete from the website
def test_delete_removes_job_remembers_it_and_saves(tmp_path):
    from core import make_job

    store = JobStore(password="pw")
    a, b = make_job("P", "hiring A https://a.co/1", None), make_job("P", "hiring B https://b.co/2", None)
    store.add(a), store.add(b)
    store.save(tmp_path / "j.json")
    loaded = JobStore.load(tmp_path / "j.json", "pw")
    assert loaded.delete([a["id"], "not-an-id", "$(rm -rf /)"]) == 1  # junk ids are ignored
    loaded.save(tmp_path / "j.json")  # a delete alone must still be saved
    again = JobStore.load(tmp_path / "j.json", "pw")
    assert [j["id"] for j in again.jobs] == [b["id"]] and a["fingerprint"] in again.deleted
    assert again.add(make_job("P", "hiring A https://a.co/1?utm_source=x", None)) is False  # never comes back


def test_deleted_job_is_not_collected_again_on_rescan():
    from core import make_job

    private = SimpleNamespace(title="Premium", username=None, id=9)
    tg = FakeTelegram({"-100": (private, [(1, "hiring A https://a.co/1"), (2, "hiring B https://b.co/2")])})
    store, state = JobStore(password="pw"), State()
    sent, notify = make_notifier()
    cfg = Config(include=["hiring"], first_run_backfill=5)
    run_async(run.check_telegram(tg, "-100", state, cfg, notify, store))
    store.delete([make_job("P", "hiring A https://a.co/1", None)["id"]])
    sent.clear()
    assert run_async(run.check_telegram(tg, "-100", state, cfg, notify, store, rescan=10)) == 0
    assert [j["apply_link"] for j in store.jobs] == ["https://b.co/2"] and sent == []
    # even with the run memory lost, the deleted job is neither stored nor alerted again
    run_async(run.check_telegram(tg, "-100", State(), cfg, notify, store))
    assert all("a.co/1" not in t for t in sent) and len(store.jobs) == 1


# ---------------------------------------------------------------- promo links and Saved Messages duplicates
def test_promo_links_are_not_apply_links_or_identity():
    from core import job_links, make_job

    a = "Acme hiring SDE\nJoin channel: https://whatsapp.com/channel/abc\nApply https://acme.com/jobs/1"
    b = "Zeta hiring QA\nJoin channel: https://whatsapp.com/channel/abc"
    assert job_links(a) == ["https://acme.com/jobs/1"]
    assert make_job("P", a, None)["apply_link"] == "https://acme.com/jobs/1"
    assert fingerprint(a) == "link:acme.com/jobs/1" and fingerprint(b).startswith("txt:")  # b is not "the same job" as anything sharing the footer
    c = "Beta hiring Analyst\nhttps://chat.whatsapp.com/xyz https://instagram.com/jobs_page https://youtu.be/v"
    assert job_links(c) == [] and make_job("P", c, None)["apply_link"] is None


def test_saved_messages_forward_is_kept_even_if_the_link_was_seen_in_a_group():
    from core import make_job

    store, state = JobStore(password="pw"), State()
    group_post = "Acme hiring SDE https://acme.com/jobs/1"
    store.add(make_job("Premium", group_post, None))
    state.mark_seen(fingerprint(group_post))
    me = SimpleNamespace(first_name="Me", username=None, id=1)
    forwarded = "Forwarded from WhatsApp: Acme SDE role, referral via Rahul. https://acme.com/jobs/1"
    tg = FakeTelegram({"me": (me, [(1, forwarded), (2, forwarded)])})  # sent twice by mistake
    sent, notify = make_notifier()
    assert run_async(run.check_telegram(tg, "me", state, Config(first_run_backfill=5), notify, store)) == 1
    assert len(store.jobs) == 2 and store.jobs[0]["source"] == "Saved Messages"  # added once, not dropped


def test_rescan_of_saved_messages_keeps_deleted_old_forwards_deleted():
    from core import make_job

    store, state = JobStore(password="pw"), State()
    old = "Acme SDE role https://acme.com/jobs/1"
    job = make_job("Saved Messages", old, None)  # stored before the fix: identified by its link
    store.add(job)
    store.delete([job["id"]])
    state.telegram["me"] = 5
    me = SimpleNamespace(first_name="Me", username=None, id=1)
    tg = FakeTelegram({"me": (me, [(4, old), (5, "Zeta QA role https://zeta.io/careers")])})
    sent, notify = make_notifier()
    run_async(run.check_telegram(tg, "me", state, Config(), notify, store, rescan=10))
    assert [j["text"] for j in store.jobs] == ["Zeta QA role https://zeta.io/careers"]


# ---------------------------------------------------------------- WhatsApp via phone notifications
def test_parse_wa_notifications():
    from core import parse_wa

    assert parse_wa("WA: Off Campus Jobs || ~ Rahul: We're hiring SDE interns at Acme https://acme.com/jobs/1") == (
        "Off Campus Jobs", "We're hiring SDE interns at Acme https://acme.com/jobs/1")
    assert parse_wa("WA: Off Campus Jobs (3 messages) || +91 98765 43210: Zeta hiring analysts") == ("Off Campus Jobs", "Zeta hiring analysts")
    assert parse_wa("WA: Off Campus Jobs: Rahul || Hiring: QA intern at Beta") == ("Off Campus Jobs", "Hiring: QA intern at Beta")  # sender in title
    assert parse_wa("WA: Jobs || Hiring: QA intern at Beta") == ("Jobs", "Hiring: QA intern at Beta")  # "Hiring:" is not a person
    assert parse_wa("WA: Jobs || Line one\nLine two") == ("Jobs", "Line one\nLine two")
    # sender's name in the text even though the title has a colon too
    assert parse_wa("WA: EP1 Badmosi (AFC💔): Akshat Jain || Akshat Jain: Responsibilities and Duties: 1. Help create") == (
        "EP1 Badmosi (AFC💔)", "Responsibilities and Duties: 1. Help create")
    assert parse_wa("WA: Jobs || Company Name: Infosys, Role: SDE") == ("Jobs", "Company Name: Infosys, Role: SDE")  # a field label, not a person
    for noise in ("WA: WhatsApp || 5 new messages", "WA: Jobs || 12 messages from 4 chats", "WA: Jobs || Rahul: 📷 Photo",
                  "WA: Jobs || This message was deleted", "hello", "WA: Jobs ||  "):
        assert parse_wa(noise) is None, noise


def test_whatsapp_inbox_adds_job_posts_once():
    store, state = JobStore(password="pw"), State()
    bot = SimpleNamespace(first_name="My jobs bot", username="my_jobs_bot", id=77, bot=True)
    rows = [
        (1, "WA: Off Campus Jobs || ~ Rahul: Acme is hiring SDE interns, 2026 batch. Apply: https://acme.com/careers/sde-intern"),
        (2, "WA: Off Campus Jobs || ~ Priya: thanks bro"),
        (3, "WA: WhatsApp || 3 new messages"),
        (4, "WA: Tech Placements || ~ Amit: Acme is hiring SDE interns, 2026 batch. Apply: https://acme.com/careers/sde-intern"),  # same job, other group
        (5, "WA: Mom || are you applying for this job or not, tell me today itself please beta"),  # one job word: chat
        (6, "WA: Off Campus Jobs || ~ Neha: Hiring freshers for Data Analyst role at Kappa, send CV to hr@kappa.in"),
    ]
    cfg = load_config(Path(run.__file__).parent / "config.toml")  # your real keyword list
    tg = FakeTelegram({"@friend": (SimpleNamespace(first_name="Friend", username="friend", id=5, bot=False), [(1, "WA: x || fake")]), "@my_jobs_bot": (bot, rows)})
    assert run_async(run.check_whatsapp(tg, state, cfg, store)) == 2
    assert [(j["source"], j["text"][:10]) for j in store.jobs] == [("WhatsApp · Off Campus Jobs", "Hiring fre"), ("WhatsApp · Off Campus Jobs", "Acme is hi")]
    assert state.whatsapp == 6

    rows.append((7, "WA: Tech Placements || ~ Amit: Zeta hiring data analyst interns, stipend 25k. https://zeta.io/jobs/42"))
    assert run_async(run.check_whatsapp(tg, state, cfg, store)) == 1  # only the new one
    assert store.jobs[0]["source"] == "WhatsApp · Tech Placements" and len(store.jobs) == 3


def test_whatsapp_inbox_absent_or_off_is_quiet():
    tg = FakeTelegram({"@friend": (SimpleNamespace(first_name="Friend", username="friend", id=5, bot=False), [(1, "hi")])})
    assert run_async(run.check_whatsapp(tg, State(), Config(), JobStore(password="pw"))) == 0
    assert run_async(run.check_whatsapp(tg, State(), Config(whatsapp_inbox=""), JobStore(password="pw"))) == 0


def test_whatsapp_job_detection_is_not_too_strict():
    from core import is_wa_job

    cfg = load_config(Path(run.__file__).parent / "config.toml")
    jobs = [
        "Amazon is hiring SDE interns for 2026 batch, apply soon",  # no link, but clearly a job
        "Deloitte Off Campus Drive 2026 | Analyst | Freshers | Location: Bangalore",
        "Infosys hiring: Role - Systems Engineer, CTC 3.6 LPA, Eligibility: B.Tech 2025/26",
        "Swiggy Internship. Stipend 40k/month. Apply: https://careers.swiggy.com/x",
        "Walk-in interview for Data Analyst trainee, Noida, 10am-4pm",
        "Send your CV to hr@kappa.in for the content writer opening",
    ]
    chat = [
        "are you applying for this job or not, tell me today itself please beta",
        "Any update on the Amazon results?",
        "thanks for sharing bro, very helpful",
        "Good morning everyone, have a great day",
        "Is this job remote?",
    ]
    for t in jobs:
        assert is_wa_job(t, cfg), t
    for t in chat:
        assert not is_wa_job(t, cfg), t
    # a group that already posted jobs gets the benefit of the doubt on shorter posts
    assert not is_wa_job("TCS hiring freshers, batch 2025", cfg) and is_wa_job("TCS hiring freshers, batch 2025", cfg, job_group=True)


def test_whatsapp_rescan_brings_back_skipped_posts():
    store, state = JobStore(password="pw"), State()
    bot = SimpleNamespace(first_name="My jobs bot", username="my_jobs_bot", id=77, bot=True)
    rows = [(1, "WA: Jobs || ~ A: Amazon is hiring SDE interns for 2026 batch, apply soon")]
    tg = FakeTelegram({"@my_jobs_bot": (bot, rows)})
    state.whatsapp = 1  # already read (and skipped by the old, stricter rule)
    assert run_async(run.check_whatsapp(tg, state, Config(), store)) == 0
    assert run_async(run.check_whatsapp(tg, state, Config(), store, rescan=10)) == 1
    assert store.jobs[0]["source"] == "WhatsApp · Jobs" and state.wa_groups == ["Jobs"]


# ---------------------------------------------------------------- your job group (topics per role type)
def test_role_types_and_batch():
    from core import batch_match, job_category

    cats = ["SDE", "AI/ML", "Data Science", "Analyst", "Product"]
    cases = {
        "Amazon hiring SDE-1, 2027 batch": "SDE",
        "Backend Developer (Node.js) at Zeta": "SDE",
        "ML Engineer Intern at Sarvam AI": "AI/ML",
        "Generative AI intern, LLM fine-tuning": "AI/ML",
        "Data Scientist Intern | 2027 grads": "Data Science",
        "Business Analyst at Kappa": "Analyst",
        "Data Analyst trainee": "Analyst",
        "Associate Product Manager (APM) – Flipkart": "Product",
        "Software Engineer at an AI startup": "SDE",  # the title line decides
        "Business Development Executive": None,
        "HR Recruiter at AcquireX": None,
    }
    for text, want in cases.items():
        assert job_category(text, cats) == want, text
    assert job_category("Data Analyst trainee", ["SDE"]) is None
    yes = ["2027 batch", "Batch: 2025/2026/2027", "2k27 grads", "for '27 passouts", "27 batch only",
           "Eligible batches: 2025-2027", "2026/27 passouts", "2026 & 2027 batch", "Graduating in 2027",
           "Open to final year students", "Hiring freshers", "SDE Intern, stipend 40k", "0-1 years experience",
           "Freshers. Last date: 30 Nov 2026"]
    no = ["2026 batch", "2025 passouts only", "5 years experience", "Backend Engineer, 2+ years of experience",
          "Pre-final year students (internship)", "Senior engineer", "2023-2025 batch"]
    for t in yes:
        assert batch_match(t, "2027"), t
    for t in no:
        assert not batch_match(t, "2027"), t
    assert batch_match("anything", "")


def test_repost_makes_group_with_topics_and_files_jobs(monkeypatch):
    from core import make_job

    sent, made_groups, topics = [], [], []

    class Client(FakeTelegram):
        async def send_message(self, to, text, link_preview=True, reply_to=None):
            sent.append((to, text, reply_to))

    async def fake_group(client, title, about):
        g = SimpleNamespace(id=777, title=title, megagroup=True, forum=True, creator=True)
        made_groups.append(g)
        client.chats["@g"] = (g, [])
        return g, "https://t.me/+grp"

    async def fake_topic(client, group, title):
        topics.append(title)
        return 100 + len(topics)

    async def no_topics(client, group):
        return {}

    async def no_wait(_s):
        return None

    monkeypatch.setattr(run, "create_group", fake_group)
    monkeypatch.setattr(run, "create_topic", fake_topic)
    monkeypatch.setattr(run, "existing_topics", no_topics)
    monkeypatch.setattr(run.asyncio, "sleep", no_wait)
    store, state = JobStore(password="pw"), State()
    cfg = Config(repost_channel="auto", repost_title="Job Posts", repost_sources=["WhatsApp", "Premium Membership"], repost_batch="2027", repost_skip=["ep"])
    jobs = [
        make_job("WhatsApp · Off Campus", "Zeta hiring SDE Intern, 2027 batch https://zeta.io/1", None),
        make_job("Premium Membership", "Data Scientist Intern | 2027 grads https://k.io/2", None),
        make_job("Premium Membership", "Backend Developer, 2026 batch https://k.io/3", None),  # wrong batch
        make_job("WhatsApp · EP1 Placements", "SDE intern, 2027 batch https://e.io/9", None),  # skipped group
        make_job("Saved Messages", "SDE intern 2027 batch https://b.io/4", None),  # not a chosen source
        make_job("WhatsApp · X", "HR Recruiter, 2027 batch https://h.io/5", None),  # not a tech role
    ]
    tg = Client({})
    assert run_async(run.repost(tg, state, cfg, jobs, store)) == 2
    assert len(made_groups) == 1 and topics == ["SDE", "AI/ML", "Data Science", "Analyst", "Product"]
    assert sent[0][0] == "me" and "t.me/+grp" in sent[0][1]
    assert [(m[1].split("\n")[0], m[2]) for m in sent[1:]] == [("💼 Zeta hiring SDE Intern, 2027 batch", 101), ("💼 Data Scientist Intern | 2027 grads", 103)]
    # next run: same group, same topics
    assert run_async(run.repost(tg, state, cfg, [make_job("WhatsApp · X", "Product Analyst intern, 2027 batch https://p.io/6", None)], store)) == 1
    assert len(made_groups) == 1 and len(topics) == 5 and sent[-1][2] == 105


def test_repost_text_shortens_and_links():
    from core import repost_text

    t = repost_text({"text": "Senior Engineer at Acme\n" + "word " * 400, "apply_link": "https://acme.com/a"})
    assert t.startswith("💼 Senior Engineer at Acme") and "#fresher" not in t and t.endswith("🔗 Apply: https://acme.com/a") and len(t) < 1200


def test_repost_text_leaves_out_the_source():
    from core import repost_text

    post = repost_text({"text": "Akshat Jain: Zeta hiring SDE Intern, 2027 batch\nStipend 50k\nApply: https://zeta.io/jobs/1\n"
                                "Join our WhatsApp group: https://chat.whatsapp.com/AbC\nFollow @offcampusjobs4u for more\nForwarded from Premium Membership",
                        "apply_link": "https://zeta.io/jobs/1"})
    assert post.startswith("💼 Zeta hiring SDE Intern") and "Akshat" not in post
    for gone in ("chat.whatsapp", "offcampusjobs4u", "Join", "Forwarded", "Premium"):
        assert gone not in post, gone
    assert "Stipend 50k" in post and "https://zeta.io/jobs/1" in post


def test_repost_sends_todays_site_jobs_once(monkeypatch):
    from datetime import datetime, timedelta, timezone

    from core import make_job

    sent = []

    class Client(FakeTelegram):
        async def send_message(self, to, text, link_preview=True, reply_to=None):
            sent.append(text)

    async def no_wait(_s):
        return None

    monkeypatch.setattr(run.asyncio, "sleep", no_wait)
    g = SimpleNamespace(id=777, title="Job Posts", megagroup=True, forum=True, creator=True)
    tg = Client({"@g": (g, [])})
    state = State()
    state.repost_gid, state.repost_title, state.repost_topics = 777, "Job Posts", {c: i for i, c in enumerate(["SDE", "AI/ML", "Data Science", "Analyst", "Product"], 101)}
    now = datetime.now(timezone.utc)
    store = JobStore(password="pw")
    store.add(make_job("WhatsApp · X", "Old SDE role, 2027 batch https://o.io/1", None, posted_at=now - timedelta(days=3)))
    store.add(make_job("Premium Membership", "SDE Intern at Zeta, 2027 batch https://z.io/2", None, posted_at=now))
    cfg = Config(repost_channel="auto", repost_title="Job Posts", repost_sources=["WhatsApp", "Premium Membership"], repost_batch="2027")
    assert run_async(run.repost(tg, state, cfg, [], store)) == 1 and "Zeta" in sent[0]  # today's site job, not the old one
    assert run_async(run.repost(tg, state, cfg, [], store)) == 0  # not again
    cfg.repost_recent_days = 4  # a wider window picks up the 3-day-old one, still not the one already sent
    assert run_async(run.repost(tg, state, cfg, [], store)) == 1 and "Old SDE" in sent[-1]


# ---------------------------------------------------------------- LinkedIn job-alert emails
def _alert(plain=None, html=None):
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    m = MIMEMultipart("alternative")
    m["From"], m["Subject"], m["Date"] = "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", "New jobs for Software Engineer", "Sat, 21 Nov 2026 09:00:00 +0530"
    if plain:
        m.attach(MIMEText(plain, "plain"))
    if html:
        m.attach(MIMEText(html, "html"))
    return m


PLAIN = """Your job alert for software engineer in India
New jobs match your preferences.

Software Engineer Intern
Zeta
Bengaluru, Karnataka, India
Actively recruiting
View job: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&refId=x

---------------------------------------------------------

Senior Backend Engineer
Kappa
Pune, Maharashtra, India
3 connections
View job: https://www.linkedin.com/comm/jobs/view/4099999999/?trackingId=def

See all jobs: https://www.linkedin.com/comm/jobs/search
"""

HTML = """<table><tr><td><a href="https://www.linkedin.com/comm/jobs/view/4055555555/?trk=x"><img alt=""></a></td>
<td><a href="https://www.linkedin.com/comm/jobs/view/4055555555/?trk=x">Data Analyst Trainee</a>
<p>BrowseInfo · Noida, Uttar Pradesh, India</p></td></tr></table>"""


def test_linkedin_alert_parsing():
    import linkedin

    jobs = linkedin.parse_alert(_alert(plain=PLAIN))
    assert [(j["title"], j["company"], j["location"], j["url"]) for j in jobs] == [
        ("Software Engineer Intern", "Zeta", "Bengaluru, Karnataka, India", "https://www.linkedin.com/jobs/view/4012345678/"),
        ("Senior Backend Engineer", "Kappa", "Pune, Maharashtra, India", "https://www.linkedin.com/jobs/view/4099999999/"),
    ]
    assert "entry level" in linkedin.job_text(jobs[0]) and "entry level" not in linkedin.job_text(jobs[1])  # senior role
    h = linkedin.parse_alert(_alert(html=HTML))
    assert [(j["title"], j["company"], j["location"]) for j in h] == [("Data Analyst Trainee", "BrowseInfo", "Noida, Uttar Pradesh, India")]


def test_check_linkedin_reads_new_alert_emails_once():
    class FakeImap:
        mails = {101: _alert(plain=PLAIN).as_bytes()}

        def __init__(self, host):
            assert host == "imap.gmail.com"

        def login(self, a, p):
            assert (a, p) == ("me@gmail.com", "abcdabcdabcdabcd")

        def select(self, box, readonly=False):
            assert readonly

        def uid(self, cmd, *args):
            if cmd == "search":
                crit = args[1]
                start = int(re.search(r"UID (\d+):", crit).group(1)) if "UID" in crit else 0
                ids = [str(u) for u in self.mails if u >= start] if "jobalerts" in crit else []
                return "OK", [" ".join(ids).encode()]
            return "OK", [(b"1 (BODY[] {1})", self.mails[int(args[0])]), b")"]

        def logout(self):
            pass

    import re

    store, state = JobStore(password="pw"), State()
    env = {"GMAIL_ADDRESS": "me@gmail.com", "GMAIL_APP_PASSWORD": "abcd abcd abcd abcd"}
    assert run.check_linkedin(env, state, Config(linkedin_alerts=True), store, imap_factory=FakeImap) == 2
    assert state.linkedin_uid == 101 and {j["source"] for j in store.jobs} == {"LinkedIn"}
    assert store.jobs[-1]["apply_link"] == "https://www.linkedin.com/jobs/view/4012345678/"
    assert run.check_linkedin(env, state, Config(linkedin_alerts=True), store, imap_factory=FakeImap) == 0  # same email: nothing new
    assert run.check_linkedin({}, State(), Config(linkedin_alerts=True), store) == 0  # no secrets yet: quiet
