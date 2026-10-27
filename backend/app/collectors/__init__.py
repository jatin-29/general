"""Importing a collector module registers it. Add new sources here."""
from . import telegram, youtube  # noqa: F401
from .base import REGISTRY, Collector, RawItemData  # noqa: F401
