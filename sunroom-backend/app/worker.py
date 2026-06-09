import ssl

from celery import Celery
from app.config import REDIS_URL
import logging

logger = logging.getLogger(__name__)

# if not REDIS_URL or "localhost" in REDIS_URL:
#     raise RuntimeError(f"REDIS_URL is misconfigured: {REDIS_URL!r}")
if not REDIS_URL:
    raise RuntimeError(f"REDIS_URL is misconfigured: {REDIS_URL!r}")

celery_app = Celery(
    "sunroom",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["app.tasks"]
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    broker_connection_retry_on_startup=True,  # suppress deprecation warning
)