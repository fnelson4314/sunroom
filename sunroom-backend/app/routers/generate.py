from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from app.tasks import (
    generate_sunroom,
    refine_render_task,
    render_composite_preview,
)
from app.database import supabase
from app.config import validate_uuid
from app.worker import celery_app
from app.auth import require_api_key
from app.rate_limit import rate_limit
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

# Cap generation starts per client. The endpoint spends Replicate credits, so this
# is the money-protecting limit — generous enough for real use (a person kicks off
# a handful of renders), tight enough that a loop can't drain the budget. Tune via
# these constants. Status/cancel are auth-only (polling must not be throttled).
GENERATE_MAX_PER_WINDOW = 10
GENERATE_WINDOW_SECONDS = 60


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
    under_existing_shape: Optional[str] = None
    # Under-existing: True = add a new gable/wing infill above the header;
    # False = "walls only" (keep the existing gable). Default True.
    include_gable_wings: Optional[bool] = True
    # Which two walls to render (AB → A+B, BC → B+C). All designed walls priced.
    wall_combo: Optional[str] = None
    wall_corners: Optional[str] = ""
    # Screen rooms (2_inch): structure-wide kneewall / chairrail / handrail as a
    # JSON string. They run across every wall, so they can't ride in wall_data.
    screen_options: Optional[str] = ""

    class Config:
        extra = "ignore"


@router.post("/")
async def start_generation(
    body: GenerateRequest,
    key: str = Depends(require_api_key),
    _rl: None = Depends(rate_limit(GENERATE_MAX_PER_WINDOW, GENERATE_WINDOW_SECONDS)),
):
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
            under_existing_shape=body.under_existing_shape,
            include_gable_wings=body.include_gable_wings if body.include_gable_wings is not None else True,
            wall_combo=body.wall_combo,
            wall_corners=body.wall_corners or "",
            screen_options=body.screen_options or "",
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


@router.post("/preview")
def preview_composite(
    body: GenerateRequest,
    key: str = Depends(require_api_key),
    _rl: None = Depends(rate_limit(GENERATE_MAX_PER_WINDOW * 3, GENERATE_WINDOW_SECONDS)),
):
    """3D composite only — no AI, no credits, no session row touched.

    Lets the salesperson confirm the configured structure sits correctly on the
    house BEFORE spending a generation. Synchronous (a few seconds) so the client
    just awaits the URL — no Celery, no polling. Rate limit is looser than
    /generate because this costs nothing but renderer time.
    """
    try:
        result = render_composite_preview(
            house_photo_url=body.house_photo_url,
            box_x1=body.box_x1 or 0.0,
            box_y1=body.box_y1 or 0.0,
            box_x2=body.box_x2 or 1.0,
            box_y2=body.box_y2 or 1.0,
            wall_corners=body.wall_corners or "",
            wall_data=body.wall_data or "",
            wall_system=body.wall_system or "4_inch",
            roof_style=body.roof_style or "studio",
            wall_color=body.wall_color or "white",
            mount_height=body.mount_height or "",
            projection_distance=body.projection_distance or "",
            include_gable_wings=(
                body.include_gable_wings if body.include_gable_wings is not None else True
            ),
            wall_combo=body.wall_combo,
            screen_options=body.screen_options or "",
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Preview render failed: {e}")
        raise HTTPException(status_code=502, detail=f"3D preview failed: {e}")


class RefineRequest(BaseModel):
    session_id: str
    request: str
    source_render_url: Optional[str] = None


@router.post("/refine")
def refine(
    body: RefineRequest,
    key: str = Depends(require_api_key),
    _rl: None = Depends(rate_limit(GENERATE_MAX_PER_WINDOW, GENERATE_WINDOW_SECONDS)),
):
    """Queue a follow-up edit of an existing render, in the salesperson's words.

    ASYNC (Celery + polling), like /generate rather than /preview: the edit is a
    full image-model call at ~128s, and a held-open request that long is lost to a
    phone locking or a sleeping tab while the work completes invisibly. Returns
    immediately; the client polls /generate/refine/status/{session_id}.

    Rate-limited on the same budget as /generate — it spends the same credits.
    """
    validate_uuid(body.session_id)
    text = (body.request or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Describe the change you want")
    if len(text) > 300:
        raise HTTPException(
            status_code=400, detail="Keep the change request under 300 characters"
        )
    try:
        refine_render_task.delay(body.session_id, text, body.source_render_url)
        return {"status": "queued", "session_id": body.session_id}
    except Exception as e:
        logger.error(f"Could not queue refine: {e}")
        raise HTTPException(status_code=500, detail="Could not queue the change")


@router.get("/refine/status/{session_id}")
def refine_status(session_id: str, key: str = Depends(require_api_key)):
    """Poll a queued change request. Mirrors /generate/status' shape so the
    frontend can reuse the same polling pattern.

    `refine_status` is "working" | "complete" | "failed" (absent = never run).
    render_urls always comes back as a list so the gallery can just render it.
    """
    validate_uuid(session_id)
    try:
        try:
            result = supabase.table("configurations")                .select("id, refine_status, refine_error, render_url, render_urls")                .eq("id", session_id).execute()
        except Exception:
            # refine_status/refine_error not migrated yet — degrade to the renders
            result = supabase.table("configurations")                .select("id, render_url, render_urls")                .eq("id", session_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Session not found")
        row = result.data[0]
        urls = row.get("render_urls")
        if not urls:
            single = row.get("render_url")
            urls = [single] if single else []
        return {
            "session_id": row["id"],
            "refine_status": row.get("refine_status"),
            "error": row.get("refine_error"),
            "render_url": row.get("render_url"),
            "render_urls": urls,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Refine status failed: {e}")
        raise HTTPException(status_code=500, detail="Could not read change status")


@router.get("/status/{session_id}")
def get_generation_status(session_id: str, key: str = Depends(require_api_key)):
    validate_uuid(session_id)

    try:
        # Try to include render_urls (parallel variations); fall back gracefully
        # if the column hasn't been migrated yet.
        try:
            result = supabase.table("configurations")\
                .select("id, status, render_url, render_urls")\
                .eq("id", session_id)\
                .execute()
        except Exception:
            result = supabase.table("configurations")\
                .select("id, status, render_url")\
                .eq("id", session_id)\
                .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Session not found")

        session = result.data[0]
        # Always hand back a list: the migrated array if present, else the single
        # render_url wrapped, else empty. The frontend renders whatever it gets.
        render_urls = session.get("render_urls")
        if not render_urls:
            single = session.get("render_url")
            render_urls = [single] if single else []
        return {
            "session_id": session["id"],
            "status": session["status"],
            "render_url": session.get("render_url"),
            "render_urls": render_urls,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Status check error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    
@router.post("/cancel/{session_id}")
def cancel_generation(session_id: str, key: str = Depends(require_api_key)):
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