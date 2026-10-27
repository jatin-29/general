import functools
import logging
import time

log = logging.getLogger("openingshub")


def is_client_error(e: Exception) -> bool:
    """HTTP 4xx (except 429) will not succeed on retry."""
    status = getattr(getattr(e, "response", None), "status_code", None)
    return status is not None and 400 <= status < 500 and status != 429


def retry(attempts: int = 3, base_delay: float = 1.0, exceptions: tuple = (Exception,), give_up=is_client_error):
    """Retry with exponential backoff (1s, 2s, 4s...)."""

    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*a, **kw):
            for i in range(attempts):
                try:
                    return fn(*a, **kw)
                except exceptions as e:
                    if i == attempts - 1 or give_up(e):
                        raise
                    delay = base_delay * 2**i
                    log.warning("%s failed (%s); retry %d in %.1fs", fn.__name__, e, i + 1, delay)
                    time.sleep(delay)

        return wrapper

    return deco
