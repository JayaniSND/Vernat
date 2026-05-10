#!/usr/bin/env python3
"""
scripts/demo.py
---------------
Run the full Vernat pipeline on a local video file.
Use this to pre-bake your demo asset before the hackathon presentation.

Usage:
    python scripts/demo.py --video path/to/walkthrough.mp4 --lat 19.07 --lon 72.87
"""

import sys
import argparse
import json
import logging
from pathlib import Path
from datetime import datetime

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent / "colmap"))

from colmap_pipeline      import run_full_pipeline
from surface_tagger       import SurfaceTagger
from thermal_simulation   import run_thermal_simulation, simulation_to_json
from ventilation_graph    import build_example_graph, ventilation_to_json
from prescription_engine  import (
    VernacularIndex, PrescriptionRequest,
    generate_prescriptions, prescriptions_to_json,
)

import numpy as np


def main():
    parser = argparse.ArgumentParser(description="Vernat demo pipeline")
    parser.add_argument("--video",     required=True,  help="Path to walkthrough video")
    parser.add_argument("--lat",       type=float, default=19.07)
    parser.add_argument("--lon",       type=float, default=72.87)
    parser.add_argument("--fps",       type=int,   default=2)
    parser.add_argument("--workspace", default="/tmp/vernacool_demo")
    parser.add_argument("--date",      default="2024-06-21")
    args = parser.parse_args()

    workspace = Path(args.workspace)
    video     = Path(args.video)

    print("\n🌿 Vernat Demo Pipeline\n" + "─" * 40)

    # ── 1. COLMAP reconstruction ───────────────────────────────────────────────
    print("\n[1/5] Running COLMAP reconstruction...")
    recon = run_full_pipeline(video, workspace, fps=args.fps)
    print(f"      ✓ {recon.num_images} frames · {recon.num_points:,} points")
    print(f"      ✓ Mesh: {recon.mesh_path}")

    # ── 2. Surface tagging ────────────────────────────────────────────────────
    print("\n[2/5] Tagging surface materials with YOLOv8...")
    frames  = sorted((workspace / "frames").glob("frame_*.jpg"))
    tagger  = SurfaceTagger()
    scores  = tagger.tag_frames(frames)
    dominant = max(scores, key=scores.get)
    print(f"      ✓ Dominant material: {dominant} ({scores[dominant]:.2f} confidence)")

    # ── 3. Thermal simulation ─────────────────────────────────────────────────
    print("\n[3/5] Running 24-hour thermal simulation...")
    import open3d as o3d
    mesh       = o3d.io.read_triangle_mesh(str(recon.mesh_path))
    vertices   = np.asarray(mesh.vertices)
    triangles  = np.asarray(mesh.triangles)
    normals    = np.asarray(mesh.triangle_normals) if mesh.has_triangle_normals() \
                 else np.tile([0, 1, 0], (len(triangles), 1))

    surfaces = [{"material": dominant, "area_m2": 15.0}]  # simplified
    thermal  = run_thermal_simulation(
        surfaces=surfaces,
        surface_normals=normals[:len(surfaces)],
        lat=args.lat, lon=args.lon,
        date=datetime.fromisoformat(args.date),
    )
    peak = max(thermal.peak_temp_by_surface.values())
    print(f"      ✓ Peak surface temperature: {peak:.1f}°C")

    # ── 4. Ventilation graph ──────────────────────────────────────────────────
    print("\n[4/5] Analysing room ventilation graph...")
    vg     = build_example_graph()
    vent   = vg.analyse()
    print(f"      ✓ Dead zones: {vent.dead_zones or 'none'}")
    print(f"      ✓ Max-flow: {vent.max_flow_value:.4f} m³/s")

    # ── 5. Vernacular prescriptions ───────────────────────────────────────────
    print("\n[5/5] Generating vernacular prescriptions...")
    index = VernacularIndex()
    rx    = generate_prescriptions(
        PrescriptionRequest(
            worst_surface_material=dominant,
            peak_temp_c=peak,
            dead_zone_rooms=vent.dead_zones,
            climate_zone="hot-dry",
            lat=args.lat, lon=args.lon,
        ),
        index=index,
    )

    print(f"\n{'─' * 40}")
    print("📋 Vernacular interventions:\n")
    for p in sorted(rx, key=lambda x: x.priority):
        print(f"  {p.priority}. {p.name}  (−{abs(p.delta_temp_c)}°C · {p.cost_tier})")
        print(f"     {p.rationale[:100]}...")
        print()

    # ── Save output JSON ──────────────────────────────────────────────────────
    out = {
        "reconstruction": {
            "mesh_path": str(recon.mesh_path),
            "num_images": recon.num_images,
            "num_points": recon.num_points,
        },
        "dominant_material": dominant,
        "thermal": simulation_to_json(thermal),
        "ventilation": ventilation_to_json(vent),
        "prescriptions": prescriptions_to_json(rx),
    }
    out_path = workspace / "demo_output.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"✓ Full output saved → {out_path}")


if __name__ == "__main__":
    main()
