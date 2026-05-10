"""
routers/prescription.py  — vernacular prescription engine endpoint
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from prescription_engine import (
    VernacularIndex, PrescriptionRequest,
    generate_prescriptions, prescriptions_to_json,
)

router  = APIRouter()
logger  = logging.getLogger(__name__)

# Build FAISS index once at startup
_index: VernacularIndex | None = None


def get_index() -> VernacularIndex:
    global _index
    if _index is None:
        _index = VernacularIndex()
    return _index


class PrescriptionInput(BaseModel):
    worst_surface_material: str = "concrete"
    peak_temp_c: float = 42.0
    dead_zone_rooms: list[str] = []
    climate_zone: str = "hot-dry"
    lat: float = 23.0
    lon: float = 77.0


@router.post("/recommend")
def recommend(req: PrescriptionInput):
    try:
        index = get_index()
        prescriptions = generate_prescriptions(
            PrescriptionRequest(
                worst_surface_material=req.worst_surface_material,
                peak_temp_c=req.peak_temp_c,
                dead_zone_rooms=req.dead_zone_rooms,
                climate_zone=req.climate_zone,
                lat=req.lat,
                lon=req.lon,
            ),
            index=index,
        )
        return {"prescriptions": prescriptions_to_json(prescriptions)}
    except Exception as e:
        logger.exception("Prescription engine failed")
        raise HTTPException(500, str(e))


@router.get("/techniques")
def list_techniques():
    """Return full vernacular technique database."""
    from prescription_engine import VERNACULAR_DB
    return {"techniques": VERNACULAR_DB, "count": len(VERNACULAR_DB)}
