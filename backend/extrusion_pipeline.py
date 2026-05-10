"""
extrusion_pipeline.py
---------------------
Floorplan image → room detection → 3D extruded mesh

Stage 1: Room detection  — CubiCasa5K (floorplan-specific model)
                           → Gemini Vision fallback
Stage 2: Wall detection  — OpenCV Canny + Hough (for technical story + window placement)
Stage 3: Extrusion       — Open3D hollow wall boxes per room
Stage 4: Metadata        — room colors, areas, centroids
"""

import logging
from pathlib import Path
from dataclasses import dataclass

import cv2
import numpy as np
import open3d as o3d

from cubicasa_detector import detect_rooms

logger = logging.getLogger(__name__)

CEILING_HEIGHT = 1.4    # metres — half height so you can see inside
WALL_T         = 0.15   # wall thickness metres
SCALE          = 50.0   # pixels per metre (larger = bigger model)

ROOM_COLOR_HEX: dict[str, str] = {
    "bedroom":  "#9b59b6",
    "kitchen":  "#e74c3c",
    "bathroom": "#3498db",
    "living":   "#2ecc71",
    "dining":   "#f39c12",
    "hallway":  "#95a5a6",
    "study":    "#1abc9c",
    "other":    "#bdc3c7",
}

_PALETTE_HEX = ["#e74c3c", "#3498db", "#2ecc71", "#9b59b6",
                "#f39c12", "#1abc9c", "#e67e22", "#95a5a6"]


@dataclass
class ExtrusionResult:
    mesh_path:     Path
    num_rooms:     int
    floor_area_m2: float
    rooms:         list[dict]
    scale:         float
    north_facing:  str = "east"
    detection_source: str = "unknown"


# ── OpenCV wall detection (kept for technical story + window hints) ────────────

def detect_walls_opencv(image: np.ndarray) -> np.ndarray:
    """
    Canny edge detection + Hough line transform.
    Used to find window positions on walls.
    """
    gray   = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur   = cv2.GaussianBlur(gray, (3, 3), 0)
    edges  = cv2.Canny(blur, 50, 150, apertureSize=3)
    lines  = cv2.HoughLinesP(edges, 1, np.pi / 180, 80,
                              minLineLength=30, maxLineGap=10)
    wall_img = np.zeros_like(gray)
    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = line[0]
            cv2.line(wall_img, (x1, y1), (x2, y2), 255, 3)
    return wall_img


# ── 3D extrusion ──────────────────────────────────────────────────────────────

def _box(w: float, h: float, d: float,
         tx: float, ty: float, tz: float) -> o3d.geometry.TriangleMesh:
    b = o3d.geometry.TriangleMesh.create_box(width=w, height=h, depth=d)
    b.compute_vertex_normals()
    b.translate([tx, ty, tz])
    return b


def extrude_room(x: float, z: float, w: float, d: float,
                 ceiling: float = CEILING_HEIGHT) -> o3d.geometry.TriangleMesh:
    """
    Build 4 thin hollow walls for one room.
    x, z = corner position in metres
    w, d = width and depth in metres
    """
    mesh     = o3d.geometry.TriangleMesh()
    inner_d  = max(d - 2 * WALL_T, 0.05)
    inner_w  = max(w - 2 * WALL_T, 0.05)

    # Four walls
    mesh += _box(w,      ceiling, WALL_T,  x,           0, z)             # front
    mesh += _box(w,      ceiling, WALL_T,  x,           0, z + d - WALL_T) # back
    mesh += _box(WALL_T, ceiling, inner_d, x,           0, z + WALL_T)    # left
    mesh += _box(WALL_T, ceiling, inner_d, x + w - WALL_T, 0, z + WALL_T) # right

    # Windows — one per wall, centered, at mid-height
    WIN_H = ceiling * 0.35
    WIN_W = min(w * 0.35, 0.8)
    WIN_D = min(d * 0.35, 0.8)
    WIN_BASE = ceiling * 0.4
    GLASS_T = 0.03

    # Front + back windows
    mesh += _box(WIN_W, WIN_H, GLASS_T, x + (w - WIN_W) / 2, WIN_BASE, z - GLASS_T)
    mesh += _box(WIN_W, WIN_H, GLASS_T, x + (w - WIN_W) / 2, WIN_BASE, z + d)

    # Left + right windows
    mesh += _box(GLASS_T, WIN_H, WIN_D, x - GLASS_T,  WIN_BASE, z + WALL_T + (inner_d - WIN_D) / 2)
    mesh += _box(GLASS_T, WIN_H, WIN_D, x + w,        WIN_BASE, z + WALL_T + (inner_d - WIN_D) / 2)

    return mesh


# ── Full pipeline ─────────────────────────────────────────────────────────────

def run_extrusion_pipeline(image_path: Path,
                            output_dir: Path,
                            scale_px_per_m: float = SCALE) -> ExtrusionResult:
    output_dir.mkdir(parents=True, exist_ok=True)
    mesh_path = output_dir / "model.ply"

    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Could not read image: {image_path}")

    img_h, img_w = image.shape[:2]
    logger.info(f"Processing {image_path.name} ({img_w}×{img_h})")

    # ── Stage 1: Room detection (CubiCasa → Gemini fallback) ──────────────────
    gemini_rooms = detect_rooms(image_path)  # raises ValueError if both fail
    detection_source = gemini_rooms[0].get("source", "unknown") if gemini_rooms else "unknown"

    # ── Stage 2: OpenCV wall detection (technical story) ──────────────────────
    wall_img = detect_walls_opencv(image)
    logger.info(f"OpenCV Hough: detected wall lines on {np.count_nonzero(wall_img)} px")

    # ── Stage 3: Build 3D mesh from detected rooms ────────────────────────────
    combined   = o3d.geometry.TriangleMesh()
    room_data  = []
    type_counts: dict[str, int] = {}
    total_area = 0.0

    for i, gr in enumerate(gemini_rooms):
        x_pct = float(gr.get("x_pct", 0))
        y_pct = float(gr.get("y_pct", 0))
        w_pct = float(gr.get("width_pct",  0.25))
        h_pct = float(gr.get("height_pct", 0.25))
        rtype  = gr.get("type", "other").lower().strip()
        label  = gr.get("label", rtype.title())

        # Normalise type
        if "bed"  in rtype: rtype = "bedroom"
        elif "kit" in rtype: rtype = "kitchen"
        elif "bath" in rtype: rtype = "bathroom"
        elif "liv" in rtype: rtype = "living"
        elif "din" in rtype: rtype = "dining"
        elif "hall" in rtype or "corr" in rtype: rtype = "hallway"
        elif "study" in rtype: rtype = "study"

        # Convert pct → pixels → metres
        x_px = x_pct * img_w
        y_px = y_pct * img_h
        w_px = w_pct * img_w
        h_px = h_pct * img_h

        x_m = x_px / scale_px_per_m
        z_m = (img_h - y_px - h_px) / scale_px_per_m
        w_m = max(w_px / scale_px_per_m, 0.3)
        d_m = max(h_px / scale_px_per_m, 0.3)

        room_mesh = extrude_room(x_m, z_m, w_m, d_m)
        combined += room_mesh

        area_m2 = round(w_m * d_m, 2)
        total_area += area_m2

        type_counts[rtype] = type_counts.get(rtype, 0) + 1
        count   = type_counts[rtype]
        room_id = rtype if count == 1 else f"{rtype}_{count}"
        color   = ROOM_COLOR_HEX.get(rtype, _PALETTE_HEX[i % len(_PALETTE_HEX)])

        room_data.append({
            "id":        room_id,
            "type":      rtype,
            "label":     label,
            "color":     color,
            "area_m2":   area_m2,
            "volume_m3": round(area_m2 * CEILING_HEIGHT, 2),
            "centroid":  [round(x_m + w_m/2, 2), 0.7, round(z_m + d_m/2, 2)],
            "bbox_m": {
                "x": round(x_m, 2),
                "z": round(z_m, 2),
                "w": round(w_m, 2),
                "d": round(d_m, 2),
            },
        })

    combined.remove_duplicated_vertices()
    combined.remove_duplicated_triangles()
    combined.compute_vertex_normals()
    o3d.io.write_triangle_mesh(str(mesh_path), combined)

    logger.info(f"Mesh saved → {mesh_path} ({len(room_data)} rooms, {total_area:.1f} m²)")

    return ExtrusionResult(
        mesh_path=mesh_path,
        num_rooms=len(room_data),
        floor_area_m2=round(total_area, 2),
        rooms=room_data,
        scale=scale_px_per_m,
        north_facing="east",
        detection_source=detection_source,
    )