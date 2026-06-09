from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from app.config import validate_uuid
from app.database import supabase
from app.auth import require_api_key
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


# ─── Request models ───────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    product_line_id: str
    selected_options: List[str]
    width_ft: Optional[float] = None
    depth_ft: Optional[float] = None
    height_ft: Optional[float] = None
    total_price: Optional[float] = None
    customer_name: Optional[str] = None
    customer_email: Optional[str] = None
    salesperson_id: Optional[str] = None
    notes: Optional[str] = None

    class Config:
        extra = "forbid"


class UpdateSessionRequest(BaseModel):
    render_url: Optional[str] = None
    house_photo_url: Optional[str] = None
    status: Optional[str] = None
    total_price: Optional[float] = None
    notes: Optional[str] = None
    width_ft: Optional[float] = None
    depth_ft: Optional[float] = None
    height_ft: Optional[float] = None

    class Config:
        extra = "forbid"


class SaveDraftRequest(BaseModel):
    session_name: str
    salesperson_id: str
    draft_state: Dict[str, Any]

    class Config:
        extra = "forbid"


class UpdateDraftRequest(BaseModel):
    session_name: Optional[str] = None
    draft_state: Optional[Dict[str, Any]] = None

    class Config:
        extra = "forbid"


# ─── Draft routes FIRST — before /{session_id} to avoid route shadowing ──────

@router.post("/draft/save")
def save_draft(body: SaveDraftRequest):
    """Create a new saved draft with full wizard state."""
    try:
        result = supabase.table("configurations").insert({
            "status": "saved_draft",
            "session_name": body.session_name,
            "salesperson_id": body.salesperson_id,
            "draft_state": body.draft_state,
            "customer_name": body.draft_state.get("customerName"),
            "customer_email": body.draft_state.get("customerEmail"),
        }).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to save draft")

        session = result.data[0]
        logger.info(f"Draft saved: {session['id']} — {body.session_name}")
        return {"id": session["id"], "status": "saved_draft", "session_name": body.session_name}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Save draft error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/draft/save/{session_id}")
def update_draft(session_id: str, body: UpdateDraftRequest):
    """Update an existing saved draft."""
    validate_uuid(session_id)
    try:
        updates: Dict[str, Any] = {}
        if body.session_name is not None:
            updates["session_name"] = body.session_name
        if body.draft_state is not None:
            updates["draft_state"] = body.draft_state
            updates["customer_name"] = body.draft_state.get("customerName")
            updates["customer_email"] = body.draft_state.get("customerEmail")

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        result = supabase.table("configurations")\
            .update(updates)\
            .eq("id", session_id)\
            .eq("status", "saved_draft")\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Draft not found")

        return {"id": session_id, "status": "saved_draft"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update draft error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/draft/load/{session_id}")
def load_draft(session_id: str):
    """Load a saved draft to resume configuration."""
    validate_uuid(session_id)
    try:
        result = supabase.table("configurations")\
            .select("id, session_name, draft_state, created_at, salesperson_id")\
            .eq("id", session_id)\
            .eq("status", "saved_draft")\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Draft not found")

        return result.data[0]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Load draft error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Standard session routes ──────────────────────────────────────────────────

@router.post("/")
def create_session(
    body: CreateSessionRequest,
    key: str = Depends(require_api_key),
):
    try:
        result = supabase.table("configurations").insert({
            "product_line_id": body.product_line_id,
            "selected_options": body.selected_options,
            "width_ft": body.width_ft,
            "depth_ft": body.depth_ft,
            "height_ft": body.height_ft,
            "total_price": body.total_price,
            "customer_name": body.customer_name,
            "customer_email": body.customer_email,
            "salesperson_id": body.salesperson_id,
            "notes": body.notes,
            "status": "draft",
        }).execute()
        return result.data[0]
    except Exception as e:
        logger.error(f"Error in create_session: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/salesperson/{salesperson_id}")
def get_sessions_by_salesperson(
    salesperson_id: str,
    key: str = Depends(require_api_key),
):
    try:
        result = supabase.table("configurations")\
            .select("id, status, render_url, customer_name, session_name, total_price, width_ft, depth_ft, created_at, salesperson_id")\
            .eq("salesperson_id", salesperson_id)\
            .order("created_at", desc=True)\
            .execute()
        return result.data
    except Exception as e:
        logger.error(f"Error in get_sessions_by_salesperson: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/{session_id}")
def get_session(
    session_id: str,
    key: str = Depends(require_api_key),
):
    validate_uuid(session_id)
    try:
        result = supabase.table("configurations")\
            .select("*")\
            .eq("id", session_id)\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Session not found")

        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_session: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.patch("/{session_id}")
def update_session(
    session_id: str,
    body: UpdateSessionRequest,
    key: str = Depends(require_api_key),
):
    validate_uuid(session_id)
    try:
        update_data = body.dict(exclude_none=True)
        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")

        result = supabase.table("configurations")\
            .update(update_data)\
            .eq("id", session_id)\
            .execute()
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in update_session: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.delete("/{session_id}")
def delete_session(session_id: str):
    validate_uuid(session_id)
    try:
        result = supabase.table("configurations")\
            .delete()\
            .eq("id", session_id)\
            .execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Session not found")
        return {"deleted": session_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))