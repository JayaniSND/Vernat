"""
routers/materials.py — AI wall-material detection via Gemini Vision
"""

import io
import os

from fastapi import APIRouter, File, HTTPException, UploadFile

router = APIRouter()

VALID = {"concrete", "brick", "glass", "adobe", "plaster"}
PROMPT = (
    "What is the primary wall material of this building? "
    "Reply with just one word: concrete, brick, glass, adobe, or plaster"
)


@router.post("/detect-material")
async def detect_material(file: UploadFile = File(...)):
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(503, "GEMINI_API_KEY not configured")

    data = await file.read()

    try:
        import google.generativeai as genai
        import PIL.Image

        genai.configure(api_key=api_key)
        model    = genai.GenerativeModel("gemini-1.5-flash")
        image    = PIL.Image.open(io.BytesIO(data))
        result   = model.generate_content([PROMPT, image])
        material = result.text.strip().lower().split()[0]
        if material not in VALID:
            material = "concrete"
        return {"material": material}

    except ImportError:
        raise HTTPException(503, "google-generativeai package not installed")
    except Exception as exc:
        raise HTTPException(500, f"Detection failed: {exc}")
