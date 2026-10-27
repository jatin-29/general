import os

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["SCHEDULER_ENABLED"] = "false"
os.environ["API_KEY"] = "test-key"

import pytest  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402


@pytest.fixture
def db():
    from app import models  # noqa: F401

    Base.metadata.create_all(engine)
    with SessionLocal() as s:
        yield s
    Base.metadata.drop_all(engine)


class FakeLLM:
    """Returns an opening for texts containing 'hiring', otherwise not-an-opening."""

    def __init__(self):
        self.calls = 0

    def complete(self, system, user):
        import json

        self.calls += 1
        out = []
        for it in json.loads(user):
            if "hiring" in it["text"].lower():
                out.append({
                    "id": it["id"], "is_opening": True, "company": "Acme Pvt Ltd",
                    "role": "SDE Intern", "location": "Remote", "employment_type": "internship",
                    "eligibility": "2026 batch", "deadline": "2099-01-01",
                    "apply_link": "https://acme.com/jobs/1?utm_source=tg",
                })
            else:
                out.append({"id": it["id"], "is_opening": False})
        return json.dumps(out)


@pytest.fixture
def llm():
    return FakeLLM()
