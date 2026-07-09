"""
Lightweight in-process rate limiter.

Scope note (be honest about what this is): this is a single-process, in-memory
sliding-window limiter. It is NOT shared across multiple uvicorn workers — if the
API is ever scaled to several processes, move this to a Redis-backed counter
(Redis is already running for Celery). For the current single-process deployment
it is enough to stop a runaway loop from burning Replicate credits, which is the
actual threat on the unauthenticated /generate endpoint.

Applied ONLY to start_generation (the endpoint that spends money). Status polling
is intentionally NOT limited — the frontend polls /status every 4s by design.
"""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

# client key -> deque of request timestamps (monotonic seconds)
_hits: dict[str, deque] = defaultdict(deque)


def _client_key(request: Request) -> str:
    # Prefer the real client IP behind a proxy, fall back to the socket peer.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(max_requests: int, window_seconds: int):
    """FastAPI dependency factory: allow at most `max_requests` per rolling
    `window_seconds` per client. Raises 429 when exceeded."""

    def _dependency(request: Request):
        now = time.monotonic()
        key = _client_key(request)
        bucket = _hits[key]

        # Drop timestamps outside the window.
        cutoff = now - window_seconds
        while bucket and bucket[0] < cutoff:
            bucket.popleft()

        if len(bucket) >= max_requests:
            retry_after = int(window_seconds - (now - bucket[0])) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many generation requests — slow down and retry shortly.",
                headers={"Retry-After": str(max(1, retry_after))},
            )

        bucket.append(now)

        # Opportunistic cleanup so idle clients don't accumulate empty deques.
        if len(_hits) > 1024:
            for k in [k for k, v in _hits.items() if not v]:
                _hits.pop(k, None)

    return _dependency
