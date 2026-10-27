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
