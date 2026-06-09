from dotenv import load_dotenv
import os
import uuid
from fastapi import HTTPException

def validate_uuid(value: str) -> str:
    try:
        uuid.UUID(value)
        return value
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ID format")

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
API_KEY = os.getenv("API_KEY", "dev-key-123")