import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "CubiCasa5k"))

"""
cubicasa_detector.py
--------------------
Primary room detector using the CubiCasa5K semantic segmentation model.

Architecture facts (from CubiCasa5k/eval.py + svg_loader.py):
  - Model: hg_furukawa_original, initialised with n_classes=51 then final layers
    replaced to output 44 channels (21 heatmaps + 12 rooms + 11 icons).
  - Image normalisation: BGR float32, 2*(x/255)-1  → [-1, 1].
  - split_prediction(pred, (H, W), [21,12,11]) → heatmaps, rooms, icons.
  - rooms is softmax (12, H, W); argmax over axis-0 gives the class map.

Room class indices (eval.py room_cls list):
  0 Background  1 Outdoor   2 Wall      3 Kitchen   4 Living Room
  5 Bedroom     6 Bath      7 Hallway   8 Railing   9 Storage
  10 Garage    11 Other rooms

Model weights:
  Download model_best_val_loss_var.pkl from the CubiCasa5K release and place at
  ~/.cache/cubicasa5k/model_best_val_loss_var.pkl  or set CUBICASA_MODEL_PATH.
"""

import logging
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Class index → our room type string (skip 0 Background, 1 Outdoor, 2 Wall, 8 Railing)
_ROOM_TYPE_MAP: dict[int, str] = {
    3:  "kitchen",
    4:  "living",
    5:  "bedroom",
    6:  "bathroom",
    7:  "hallway",
    9:  "other",    # storage
    10: "other",    # garage
    11: "other",    # other rooms
}

_ROOM_LABELS = [
    "Background", "Outdoor", "Wall", "Kitchen", "Living Room",
    "Bedroom", "Bath", "Hallway", "Railing", "Storage", "Garage", "Other rooms",
]

_MODEL_PATH = Path(os.environ.get(
    "CUBICASA_MODEL_PATH",
    str(Path.home() / ".cache" / "cubicasa5k" / "model_best_val_loss_var.pkl"),
))

_N_CLASSES = 44           # 21 heatmaps + 12 rooms + 11 icons
_SPLIT     = [21, 12, 11]


def detect_rooms_cubicasa(image_path: Path) -> list[dict]:
    """
    Run CubiCasa5K inference on a floorplan image.

    Returns room dicts compatible with detect_room_types_gemini():
      [{"type": str, "label": str, "x_pct": float, "y_pct": float,
        "width_pct": float, "height_pct": float, "source": "cubicasa"}, ...]

    Returns [] on any failure so the caller can fall back to Gemini.
    """
    try:
        import torch
        from floortrans.models import get_model
        from floortrans.post_prosessing import split_prediction
    except ImportError:
        logger.info("CubiCasa5K (floortrans) not on sys.path — skipping")
        return []

    if not _MODEL_PATH.exists():
        logger.info(
            f"CubiCasa5K weights not found at {_MODEL_PATH} — skipping. "
            "Download model_best_val_loss_var.pkl or set CUBICASA_MODEL_PATH."
        )
        return []

    try:
        # Replicate eval.py: init with 51, then replace final layers for 44 classes
        model = get_model("hg_furukawa_original", 51)
        model.conv4_   = torch.nn.Conv2d(256, _N_CLASSES, bias=True, kernel_size=1)
        model.upsample = torch.nn.ConvTranspose2d(
            _N_CLASSES, _N_CLASSES, kernel_size=4, stride=4
        )
        checkpoint = torch.load(str(_MODEL_PATH), map_location="cpu")
        state = checkpoint.get("model_state", checkpoint)
        model.load_state_dict(state, strict=False)
        model.eval()
        logger.info("CubiCasa5K model loaded")
    except Exception as exc:
        logger.warning(f"CubiCasa5K model load failed: {exc}")
        return []

    try:
        # Normalise to [-1,1] matching svg_loader.py: fplan = 2*(fplan/255.0)-1
        img_bgr = cv2.imread(str(image_path))
        if img_bgr is None:
            return []
        img_h, img_w = img_bgr.shape[:2]

        img_f = img_bgr.astype(np.float32) / 255.0 * 2.0 - 1.0
        inp   = torch.tensor(img_f).permute(2, 0, 1).unsqueeze(0)  # (1,3,H,W)

        with torch.no_grad():
            pred = model(inp)

        # split_prediction interpolates back to (img_h, img_w) and applies softmax
        _, rooms, _ = split_prediction(pred, (img_h, img_w), _SPLIT)
        rooms_seg   = np.argmax(rooms, axis=0)   # (H, W) values 0-11

        result   = []
        min_area = img_h * img_w * 0.005          # ignore blobs < 0.5 % of image

        for class_idx, room_type in _ROOM_TYPE_MAP.items():
            mask = (rooms_seg == class_idx).astype(np.uint8) * 255
            contours, _ = cv2.findContours(
                mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            for cnt in contours:
                if cv2.contourArea(cnt) < min_area:
                    continue
                x, y, w, h = cv2.boundingRect(cnt)
                result.append({
                    "type":       room_type,
                    "label":      _ROOM_LABELS[class_idx],
                    "x_pct":      round(x / img_w, 4),
                    "y_pct":      round(y / img_h, 4),
                    "width_pct":  round(w / img_w, 4),
                    "height_pct": round(h / img_h, 4),
                    "source":     "cubicasa",
                })

        logger.info(f"CubiCasa5K detected {len(result)} rooms")
        return result

    except Exception as exc:
        logger.warning(f"CubiCasa5K inference failed: {exc}")
        return []


# ── Gemini Vision fallback ─────────────────────────────────────────────────────

def _detect_rooms_gemini(image_path: Path) -> list[dict]:
    """Gemini Vision fallback. Returns [] on any failure."""
    import json

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return []
    try:
        import google.generativeai as genai
        import PIL.Image

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        img   = PIL.Image.open(str(image_path))

        prompt = (
            "This is a hand-drawn or architectural floorplan with solid black lines as walls "
            "and dotted lines as room dividers. Identify every labeled room. "
            "For each room estimate its bounding box as a fraction of total image dimensions. "
            "Return ONLY a JSON array, no markdown:\n"
            '[{"type":"living","label":"Living Room","x_pct":0.05,"y_pct":0.30,'
            '"width_pct":0.45,"height_pct":0.45}]\n'
            "Valid types: bedroom kitchen bathroom living dining hallway study other. "
            "Ignore compass arrows and dimension text."
        )
        resp = model.generate_content([prompt, img])
        text = resp.text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        rooms = json.loads(text)
        for r in rooms:
            r["source"] = "gemini"
        logger.info(f"Gemini detected {len(rooms)} rooms")
        return rooms
    except Exception as exc:
        logger.warning(f"Gemini room detection failed: {exc}")
        return []


# ── Demo preset — last-resort fallback ────────────────────────────────────────

_DEMO_PRESET: list[dict] = [
    {
        "type": "living", "label": "Living Room", "source": "demo",
        "x_pct": 0.05, "y_pct": 0.30, "width_pct": 0.45, "height_pct": 0.45,
    },
    {
        "type": "kitchen", "label": "Kitchen", "source": "demo",
        "x_pct": 0.55, "y_pct": 0.05, "width_pct": 0.40, "height_pct": 0.40,
    },
    {
        "type": "bedroom", "label": "Bedroom", "source": "demo",
        "x_pct": 0.05, "y_pct": 0.05, "width_pct": 0.45, "height_pct": 0.40,
    },
    {
        "type": "bathroom", "label": "Bathroom", "source": "demo",
        "x_pct": 0.55, "y_pct": 0.50, "width_pct": 0.40, "height_pct": 0.40,
    },
]


# ── Public entry point ─────────────────────────────────────────────────────────

def detect_rooms(image_path: Path) -> list[dict]:
    """
    Primary entry point for room detection.
    Chain: CubiCasa5K → Gemini Vision → DEMO_PRESET.

    Always returns at least the demo preset — never raises.
    The 'source' key on each room dict is 'cubicasa', 'gemini', or 'demo'.
    """
    fname = image_path.name.lower()

    # Force demo preset for known demo filenames
    if "plan1" in fname or "demo" in fname:
        logger.info("Demo filename detected — using DEMO_PRESET")
        return list(_DEMO_PRESET)

    # Try CubiCasa5K
    rooms = detect_rooms_cubicasa(image_path)
    if len(rooms) >= 2:
        return rooms

    # Fall back to Gemini
    logger.info("CubiCasa5K found <2 rooms — trying Gemini")
    rooms = _detect_rooms_gemini(image_path)
    if len(rooms) >= 2:
        return rooms

    # Final fallback: demo preset
    logger.info("Both detectors insufficient — using DEMO_PRESET")
    return list(_DEMO_PRESET)
