from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from app.tasks import generate_sunroom
from app.database import supabase
from app.config import validate_uuid
from app.worker import celery_app
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


class GenerateRequest(BaseModel):
    session_id: str
    house_photo_url: str
    selected_options: List[str]
    box_x1: Optional[float] = None
    box_y1: Optional[float] = None
    box_x2: Optional[float] = None
    box_y2: Optional[float] = None
    wall_data: Optional[str] = None
    wall_system: Optional[str] = "4_inch"
    roof_style: Optional[str] = "studio"
    # ── new fields ────────────────────────────────────────────
    wall_color: Optional[str] = "white"
    mount_height: Optional[str] = ""
    projection_distance: Optional[str] = ""
    roof_only_sub_style: Optional[str] = None
    wall_corners: Optional[str] = ""

    class Config:
        extra = "ignore"


@router.post("/")
async def start_generation(body: GenerateRequest):
    validate_uuid(body.session_id)

    for option_id in body.selected_options:
        validate_uuid(option_id)

    try:
        supabase.table("configurations")\
            .update({"status": "queued"})\
            .eq("id", body.session_id)\
            .execute()

        task = generate_sunroom.delay(
            session_id=body.session_id,
            house_photo_url=body.house_photo_url,
            selected_option_ids=body.selected_options,
            box_x1=body.box_x1 or 0.0,
            box_y1=body.box_y1 or 0.0,
            box_x2=body.box_x2 or 1.0,
            box_y2=body.box_y2 or 1.0,
            wall_data=body.wall_data or "",
            wall_system=body.wall_system or "4_inch",
            roof_style=body.roof_style or "studio",
            wall_color=body.wall_color or "white",
            mount_height=body.mount_height or "",
            projection_distance=body.projection_distance or "",
            roof_only_sub_style=body.roof_only_sub_style,
            wall_corners=body.wall_corners or "",
        )
        logger.info(f"Task enqueued: {task.id} (wall_system={body.wall_system}, roof_style={body.roof_style})")

        supabase.table("configurations")\
            .update({"task_id": task.id})\
            .eq("id", body.session_id)\
            .execute()
        logger.info(f"Task enqueued: {task.id}")

        return {
            "session_id": body.session_id,
            "status": "queued",
            "message": "Generation started. Poll /sessions/{session_id} for status."
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to enqueue task: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to queue generation job")


@router.get("/status/{session_id}")
def get_generation_status(session_id: str):
    validate_uuid(session_id)

    try:
        result = supabase.table("configurations")\
            .select("id, status, render_url")\
            .eq("id", session_id)\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Session not found")

        session = result.data[0]
        return {
            "session_id": session["id"],
            "status": session["status"],
            "render_url": session.get("render_url"),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Status check error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    
@router.post("/cancel/{session_id}")
def cancel_generation(session_id: str):
    validate_uuid(session_id)
    try:
        # Fetch the task_id
        result = supabase.table("configurations")\
            .select("task_id, status")\
            .eq("id", session_id)\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Session not found")

        session = result.data[0]
        task_id = session.get("task_id")
        status = session.get("status")

        # Only cancel if still in progress
        if status not in ("queued", "generating"):
            return {"cancelled": False, "reason": f"Status is already {status}"}

        # Revoke the Celery task — terminate=True kills it if already running
        if task_id:
            celery_app.control.revoke(task_id, terminate=True, signal="SIGTERM")
            logger.info(f"Revoked task {task_id} for session {session_id}")

        # Update status
        supabase.table("configurations")\
            .update({"status": "cancelled"})\
            .eq("id", session_id)\
            .execute()

        return {"cancelled": True, "session_id": session_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cancel error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))