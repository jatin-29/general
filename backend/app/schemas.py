from datetime import date, datetime

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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
    name: str | None
    enabled: bool
    last_checked_at: datetime | None


class SourceCreate(BaseModel):
    type: str
    identifier: str
    name: str | None = None


class SourcePatch(BaseModel):
    enabled: bool


class OpeningCreate(BaseModel):
    company: str = Field(min_length=1, max_length=255)
    role: str = Field(min_length=1, max_length=255)
    location: str | None = None
    employment_type: Literal["internship", "full-time", "contract"] | None = None
    eligibility: str | None = None
    deadline: date | None = None
    apply_link: str | None = None
    notes: str | None = None  # original post text, shown on the detail page


class ExtractRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20000)


class ExtractionOut(BaseModel):
    is_opening: bool
    company: str | None = None
    role: str | None = None
    location: str | None = None
    employment_type: str | None = None
    eligibility: str | None = None
    deadline: date | None = None
    apply_link: str | None = None


class SettingOut(BaseModel):
    key: str
    secret: bool
    is_set: bool
    origin: str | None
    value: str | None


class SettingsUpdate(BaseModel):
    values: dict[str, str]  # "" clears a website-set value


class PhoneBody(BaseModel):
    phone: str = Field(min_length=5, max_length=32)


class SignInBody(BaseModel):
    code: str = Field(min_length=1, max_length=16)
    password: str | None = None


class TelegramChat(BaseModel):
    id: int
    name: str
    username: str | None
    kind: str
    identifier: str
