from dataclasses import dataclass
from datetime import datetime
from typing import ClassVar

from ..models import Source


@dataclass
class RawItemData:
    external_id: str
    text: str
    url: str | None = None
    source_name: str | None = None  # defaults to the Source identifier
    published_at: datetime | None = None


class Collector:
    """Subclass, set `source_type`, implement `collect`, and decorate with @register.

    That single file is all a new source needs.
    """

    source_type: ClassVar[str]
    polled: ClassVar[bool] = True  # False => data is pushed in (e.g. file upload)

    def collect(self, source: Source, last_external_id: str | None) -> list[RawItemData]:
        raise NotImplementedError


REGISTRY: dict[str, type[Collector]] = {}


def register(cls: type[Collector]) -> type[Collector]:
    REGISTRY[cls.source_type] = cls
    return cls
