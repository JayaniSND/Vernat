"""
routers/thermal.py  — 24-hour thermal simulation endpoint
"""

from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import numpy as np

from thermal_simulation import run_thermal_simulation, simulation_to_json

router = APIRouter()


class ThermalRequest(BaseModel):
    job_id: str
    lat: float
    lon: float
    date: str = "2024-06-21"   # summer solstice default
    surfaces: list[dict] = []  # list of {material, area_m2}


@router.post("/simulate")
def simulate_thermal(req: ThermalRequest):
    try:
        date = datetime.fromisoformat(req.date)
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD")

    if not req.surfaces:
        # Default surfaces if none provided
        req.surfaces = [
            {"material": "concrete", "area_m2": 20},
            {"material": "glass",    "area_m2":  4},
            {"material": "brick",    "area_m2": 15},
        ]

    # Generate placeholder normals (one per surface, facing outward)
    normals = np.array([
        [1, 0, 0], [0, 0, 1], [-1, 0, 0],
        *[[0, 1, 0]] * max(0, len(req.surfaces) - 3),
    ], dtype=float)[:len(req.surfaces)]

    result = run_thermal_simulation(
        surfaces=req.surfaces,
        surface_normals=normals,
        lat=req.lat,
        lon=req.lon,
        date=date,
    )

    return simulation_to_json(result)
