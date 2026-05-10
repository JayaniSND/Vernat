"""
routers/reconstruction.py
Upload a floorplan image → run extrusion pipeline → return mesh + room data
Results in 2-5 seconds vs 10-30 minutes for COLMAP.
"""

import uuid
import shutil
import logging
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

from extrusion_pipeline import run_extrusion_pipeline

router = APIRouter()
logger = logging.getLogger(__name__)

WORKSPACE_ROOT = Path("/tmp/vernacool")
WORKSPACE_ROOT.mkdir(exist_ok=True)

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/bmp"}


@router.post("/upload")
async def upload_floorplan(
    file: UploadFile = File(...),
    scale: float = 50.0,   # pixels per metre
):
    """
    Accept floorplan image upload.
    Runs synchronously — returns result in ~2 seconds.
    """
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"File must be an image (jpg/png). Got: {file.content_type}")

    job_id    = str(uuid.uuid4())
    job_dir   = WORKSPACE_ROOT / job_id
    job_dir.mkdir(parents=True)

    suffix     = Path(file.filename).suffix or ".jpg"
    image_path = job_dir / f"floorplan{suffix}"

    with image_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        result = run_extrusion_pipeline(image_path, job_dir, scale_px_per_m=scale)
    except ValueError as e:
        logger.warning(f"Extrusion validation error: {e}")
        raise HTTPException(400, detail=str(e))
    except Exception as e:
        logger.exception("Extrusion failed")
        raise HTTPException(500, detail=str(e))

    return {
        "job_id":        job_id,
        "status":        "complete",
        "mesh_path":     str(result.mesh_path),
        "num_rooms":     result.num_rooms,
        "floor_area_m2": result.floor_area_m2,
        "rooms":         result.rooms,
        "north_facing":  result.north_facing,
    }


@router.get("/mesh/{job_id}")
def serve_mesh(job_id: str):
    """Serve the generated .ply mesh file."""
    mesh_path = WORKSPACE_ROOT / job_id / "model.ply"
    if not mesh_path.exists():
        raise HTTPException(404, "Mesh not found")
    return FileResponse(str(mesh_path), media_type="application/octet-stream",
                        filename="model.ply")
