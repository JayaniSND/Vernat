"""
routers/ventilation.py  — room ventilation graph analysis
"""
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class VentilationRequest(BaseModel):
    rooms: list = []
    openings: list = []
    wind_direction_deg: float = 270.0
    wind_speed_ms: float = 2.5


@router.post("/analyse")
def analyse_ventilation(req: VentilationRequest):
    return {
        "max_flow_m3s": 0.0,
        "dead_zones": [],
        "rooms": [],
        "edges": []
    }