"""
surface_tagger.py
-----------------
Detects surface materials from video frames using YOLOv8
and projects labels onto the 3D mesh faces.

Material classes and their thermal properties:
  concrete  → high thermal mass, low albedo
  brick     → medium thermal mass, medium albedo
  glass     → low thermal mass, very low albedo (high solar gain)
  wood      → low thermal mass, medium albedo
  metal     → very low thermal mass, very low albedo
  plaster   → medium thermal mass, high albedo
"""

from pathlib import Path
from dataclasses import dataclass, field

import numpy as np
import cv2
from ultralytics import YOLO


# Thermal properties per material
# u_value: W/m²K (thermal transmittance — lower = better insulator)
# albedo:  0–1   (solar reflectance — higher = reflects more heat)
# mass:    kg/m² (thermal mass — higher = slower to heat/cool)
MATERIAL_PROPERTIES: dict[str, dict] = {
    "concrete": {"u_value": 3.5, "albedo": 0.25, "mass": 480, "color": "#9E9E9E"},
    "brick":    {"u_value": 2.2, "albedo": 0.40, "mass": 200, "color": "#C1440E"},
    "glass":    {"u_value": 5.8, "albedo": 0.08, "mass":  10, "color": "#A8D8EA"},
    "wood":     {"u_value": 0.9, "albedo": 0.35, "mass":  50, "color": "#A0522D"},
    "metal":    {"u_value": 6.0, "albedo": 0.15, "mass":  20, "color": "#78909C"},
    "plaster":  {"u_value": 1.8, "albedo": 0.65, "mass":  80, "color": "#F5F5F0"},
}

DEFAULT_MATERIAL = "concrete"


@dataclass
class TaggedSurface:
    face_index: int
    material: str
    confidence: float
    properties: dict = field(default_factory=dict)

    def __post_init__(self):
        self.properties = MATERIAL_PROPERTIES.get(
            self.material, MATERIAL_PROPERTIES[DEFAULT_MATERIAL]
        )


class SurfaceTagger:
    """
    Uses YOLOv8 segmentation on video frames to classify
    surface materials, then projects results onto mesh faces.
    """

    # Map YOLO class names → our material categories
    YOLO_TO_MATERIAL: dict[str, str] = {
        "wall":         "concrete",
        "brick":        "brick",
        "window":       "glass",
        "door":         "wood",
        "ceiling":      "plaster",
        "floor":        "concrete",
        "roof":         "concrete",
        "metal":        "metal",
        "wood":         "wood",
    }

    def __init__(self, model_weights: str = "yolov8n-seg.pt"):
        self.model = YOLO(model_weights)

    def tag_frames(self, frame_paths: list[Path],
                   sample_every: int = 5) -> dict[str, float]:
        """
        Run YOLOv8 over sampled frames.
        Returns a dict of material → average confidence across frames.
        """
        material_scores: dict[str, list[float]] = {m: [] for m in MATERIAL_PROPERTIES}

        sampled = frame_paths[::sample_every]
        for frame_path in sampled:
            img = cv2.imread(str(frame_path))
            if img is None:
                continue
            results = self.model(img, verbose=False)
            for result in results:
                if result.boxes is None:
                    continue
                for box in result.boxes:
                    cls_name = result.names[int(box.cls[0])].lower()
                    material = self.YOLO_TO_MATERIAL.get(cls_name)
                    if material:
                        material_scores[material].append(float(box.conf[0]))

        # Average confidence per material
        return {
            mat: float(np.mean(scores)) if scores else 0.0
            for mat, scores in material_scores.items()
        }

    def dominant_material(self, frame_paths: list[Path]) -> str:
        """Returns the most confidently detected material across all frames."""
        scores = self.tag_frames(frame_paths)
        if not any(scores.values()):
            return DEFAULT_MATERIAL
        return max(scores, key=scores.get)

    def tag_mesh_faces(self, mesh_vertices: np.ndarray,
                       mesh_faces: np.ndarray,
                       frame_paths: list[Path]) -> list[TaggedSurface]:
        """
        Simplified projection: classify faces by their normal direction
        (wall vs floor vs ceiling) and assign material from frame analysis.

        For a full implementation, project camera rays from COLMAP poses
        onto mesh faces and assign per-face materials from frame detections.
        """
        scores = self.tag_frames(frame_paths)

        tagged: list[TaggedSurface] = []
        for i, face in enumerate(mesh_faces):
            v0, v1, v2 = (mesh_vertices[face[j]] for j in range(3))

            # Compute face normal
            normal = np.cross(v1 - v0, v2 - v0)
            norm   = np.linalg.norm(normal)
            if norm < 1e-8:
                continue
            normal /= norm

            # Classify by normal direction
            material = _classify_face_by_normal(normal, scores)
            confidence = scores.get(material, 0.5)
            tagged.append(TaggedSurface(face_index=i,
                                        material=material,
                                        confidence=confidence))

        return tagged


def _classify_face_by_normal(normal: np.ndarray,
                              scores: dict[str, float]) -> str:
    """
    Heuristic: near-vertical normals → walls (use dominant wall material),
    near-horizontal up → ceiling/roof, near-horizontal down → floor.
    """
    vertical_component = abs(normal[1])  # Y up convention

    if vertical_component < 0.3:
        # Wall — pick highest-scoring wall material
        wall_materials = ["concrete", "brick", "plaster", "glass"]
        best = max(wall_materials, key=lambda m: scores.get(m, 0))
        return best
    elif normal[1] > 0.3:
        return "plaster"   # ceiling
    else:
        return "concrete"  # floor
