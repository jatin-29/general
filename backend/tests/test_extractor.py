import json

from app.extractor import Extraction, extract_batch


class Scripted:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = 0

    def complete(self, system, user):
        self.calls += 1
        return self.responses.pop(0)


GOOD = {"id": 1, "is_opening": True, "company": "Acme", "role": "Intern", "location": "Pune",
        "employment_type": "Full Time", "eligibility": "BE", "deadline": "2030-05-01",
        "apply_link": "https://a.co/x"}


def test_valid_response_with_fences():
    llm = Scripted("```json\n" + json.dumps([GOOD]) + "\n```")
    out = extract_batch(llm, {1: "hiring"})
    assert out[1].company == "Acme"
    assert out[1].employment_type == "full-time"
    assert str(out[1].deadline) == "2030-05-01"


def test_retry_once_on_invalid_json():
    llm = Scripted("sorry, here you go", json.dumps([GOOD]))
    out = extract_batch(llm, {1: "hiring"})
    assert 1 in out and llm.calls == 2


def test_gives_up_after_one_retry():
    llm = Scripted("nope", "still nope")
    assert extract_batch(llm, {1: "x"}) == {} and llm.calls == 2


def test_only_invalid_items_are_retried():
    bad = {"id": 2, "company": "x"}  # missing is_opening
    good2 = dict(GOOD, id=2)
    llm = Scripted(json.dumps([GOOD, bad]), json.dumps([good2]))
    out = extract_batch(llm, {1: "a", 2: "b"})
    assert set(out) == {1, 2} and llm.calls == 2


def test_bad_date_and_type_are_coerced_to_none():
    e = Extraction.model_validate({"is_opening": True, "deadline": "soon", "employment_type": "gig"})
    assert e.deadline is None and e.employment_type is None


def test_ids_not_in_batch_are_ignored():
    llm = Scripted(json.dumps([dict(GOOD, id=99)]), "[]")
    assert extract_batch(llm, {1: "a"}) == {}
