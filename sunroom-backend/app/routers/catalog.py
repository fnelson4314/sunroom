from fastapi import APIRouter, HTTPException, Depends
from app.database import supabase
from app.auth import require_api_key
from app.config import validate_uuid
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


# Get all active product lines
@router.get("/products")
def get_product_lines(key: str = Depends(require_api_key)):
    try:
        result = supabase.table("product_lines")\
            .select(
                "id, product_name, description, base_price, "
                "thumbnail_url, model_url, sort_order, wall_system"
            )\
            .eq("is_active", True)\
            .order("sort_order")\
            .execute()
        return result.data
    except Exception as e:
        logger.error(f"Error in get_product_lines: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


# Get all active options, optionally filtered by category
@router.get("/options")
def get_options(
    category: str = None,
    key: str = Depends(require_api_key)
):
    try:
        query = supabase.table("options")\
            .select(
                "id, product_line_id, category, name, prompt_fragment, "
                "unit_price, unit_type, affects_visual, sort_order"
            )\
            .eq("is_active", True)\
            .order("category")\
            .order("sort_order")

        if category:
            query = query.eq("category", category)

        result = query.execute()
        return result.data
    except Exception as e:
        logger.error(f"Error in get_options: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


# Get dimensions for a specific product line
@router.get("/dimensions/{product_line_id}")
def get_dimensions(
    product_line_id: str,
    key: str = Depends(require_api_key)
):
    validate_uuid(product_line_id)
    try:
        result = supabase.table("dimensions")\
            .select("*")\
            .eq("product_line_id", product_line_id)\
            .execute()

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail="Dimensions not found for this product line"
            )

        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_dimensions: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


# Get full catalog in one call (product lines + all options + dimensions)
@router.get("/full")
def get_full_catalog(key: str = Depends(require_api_key)):
    try:
        products = supabase.table("product_lines")\
            .select(
                "id, product_name, description, base_price, "
                "thumbnail_url, model_url, sort_order, wall_system"
            )\
            .eq("is_active", True)\
            .order("sort_order")\
            .execute()

        options = supabase.table("options")\
            .select(
                "id, product_line_id, category, name, prompt_fragment, "
                "unit_price, unit_type, affects_visual, sort_order"
            )\
            .eq("is_active", True)\
            .order("category")\
            .order("sort_order")\
            .execute()

        dimensions = supabase.table("dimensions")\
            .select("*")\
            .execute()

        return {
            "product_lines": products.data,
            "options": options.data,
            "dimensions": dimensions.data
        }
    except Exception as e:
        logger.error(f"Error in get_full_catalog: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal error occurred")