from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class OpeningOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company: str
    role: str
    location: str | None
    employment_type: str | None
    eligibility: str | None
    deadline: date | None
    apply_link: str | None
    source_type: str
    source_name: str
    created_at: datetime
    is_expired: bool
    applied: bool


class OpeningDetail(OpeningOut):
    raw_text: str
    source_url: str | None


class OpeningList(BaseModel):
    items: list[OpeningOut]
    total: int
    page: int
    limit: int


class OpeningPatch(BaseModel):
    applied: bool


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    identifier: str
    enabled: bool
    last_checked_at: datetime | None


class SourceCreate(BaseModel):
    type: str
    identifier: str


class SourcePatch(BaseModel):
    enabled: bool


class UploadResult(BaseModel):
    source_name: str
    parsed_messages: int
    new_items: int
    openings_found: int
