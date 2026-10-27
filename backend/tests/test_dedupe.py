from app.dedupe import make_dedupe_key, normalize_link


def test_link_normalization_strips_tracking_and_noise():
    a = normalize_link("https://www.Acme.com/jobs/1/?utm_source=tg&utm_medium=x")
    b = normalize_link("http://acme.com/jobs/1")
    assert a == b == "acme.com/jobs/1"


def test_link_keeps_meaningful_query():
    assert normalize_link("https://acme.com/apply?id=7&utm_campaign=z") == "acme.com/apply?id=7"


def test_key_prefers_link():
    assert make_dedupe_key("https://acme.com/j/1", "Acme", "SDE") == "link:acme.com/j/1"


def test_key_falls_back_to_company_role():
    k1 = make_dedupe_key(None, "Acme Pvt. Ltd.", "SDE  Intern")
    k2 = make_dedupe_key("  ", "ACME", "sde intern")
    assert k1 == k2 == "cr:acme|sde intern"


def test_different_roles_differ():
    assert make_dedupe_key(None, "Acme", "SDE") != make_dedupe_key(None, "Acme", "QA")
