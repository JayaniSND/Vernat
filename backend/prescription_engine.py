"""
prescription_engine.py
----------------------
Vernacular prescription engine.

1. Curated database of traditional cooling techniques (embedded at startup)
2. FAISS vector store for semantic retrieval
3. LLM (Claude) generates ranked, contextualised recommendations
   based on heat profile + ventilation dead zones
"""

import os
import json
import logging
from dataclasses import dataclass, field

import numpy as np
import faiss
import google.generativeai as genai

logger = logging.getLogger(__name__)

# ── Vernacular technique database ─────────────────────────────────────────────
# Each entry: name, description, climate zones, intervention type,
# expected cooling effect, materials, cultural origin

VERNACULAR_DB: list[dict] = [
    {
        "id": "jali_screen",
        "name": "Jali screen",
        "description": (
            "Perforated stone or terracotta lattice screen fitted to windows and openings. "
            "Diffuses direct solar radiation while allowing air movement. "
            "Perforation ratio 30–50% balances privacy, light, and airflow. "
            "Geometry optimised for prevailing wind direction."
        ),
        "climate_zones": ["hot-dry", "hot-humid", "composite"],
        "intervention": "facade",
        "delta_temp_c": -3.5,
        "materials": ["terracotta", "stone", "compressed earth"],
        "origin": "Rajasthan, Gujarat, Mughal India",
        "cost_tier": "low",
    },
    {
        "id": "central_courtyard",
        "name": "Central courtyard (chowk)",
        "description": (
            "Open central space surrounded by rooms on all sides. "
            "Acts as a thermal buffer: cool air pools at night, radiates to sky. "
            "Stack effect draws hot air up and out. "
            "Water feature amplifies evaporative cooling by 2–4°C."
        ),
        "climate_zones": ["hot-dry", "composite"],
        "intervention": "layout",
        "delta_temp_c": -5.0,
        "materials": ["any"],
        "origin": "Indian subcontinent, Middle East, Mediterranean",
        "cost_tier": "high",
    },
    {
        "id": "badgir_wind_tower",
        "name": "Badgir (wind tower / wind catcher)",
        "description": (
            "Tall tower with directional scoops that catch prevailing wind at height "
            "and channel it down into living spaces. Windward scoops pressurize; "
            "leeward scoops draw stale air out via negative pressure. "
            "Can reduce indoor temperature by 6–10°C in hot-dry climates."
        ),
        "climate_zones": ["hot-dry"],
        "intervention": "roof",
        "delta_temp_c": -7.0,
        "materials": ["brick", "mud plaster"],
        "origin": "Iran, Pakistan, UAE, Egypt",
        "cost_tier": "medium",
    },
    {
        "id": "lime_wash",
        "name": "Lime wash (high-albedo surface treatment)",
        "description": (
            "Traditional lime-based whitewash applied to exterior walls and roofs. "
            "Albedo 0.7–0.85 vs concrete 0.2–0.3. "
            "Reduces surface temperature by 8–15°C on direct sun exposure. "
            "Breathable — unlike synthetic paints — suits earthen and masonry walls. "
            "Traditional in Rajasthan, North Africa, Aegean."
        ),
        "climate_zones": ["hot-dry", "hot-humid", "composite", "temperate"],
        "intervention": "surface",
        "delta_temp_c": -4.0,
        "materials": ["lime", "natural pigments"],
        "origin": "Global — Rajasthan, Greece, Morocco, Mexico",
        "cost_tier": "very-low",
    },
    {
        "id": "earthen_walls",
        "name": "Rammed earth / adobe walls",
        "description": (
            "High thermal mass earthen construction delays heat transfer by 8–12 hours. "
            "Peak outdoor heat at 2pm reaches interior near midnight — "
            "when temperatures have dropped and night purge can flush heat. "
            "Combined with thick walls (400–600mm), reduces peak indoor temp significantly."
        ),
        "climate_zones": ["hot-dry", "composite"],
        "intervention": "structure",
        "delta_temp_c": -6.0,
        "materials": ["earth", "clay", "straw"],
        "origin": "India, Iran, West Africa, Southwest USA",
        "cost_tier": "low",
    },
    {
        "id": "verandah_overhang",
        "name": "Verandah / deep overhang",
        "description": (
            "Deep projecting roof overhang or covered verandah shades walls and windows "
            "from high-angle summer sun while allowing low-angle winter sun. "
            "Overhang depth = window height × tan(90 - summer_sun_altitude). "
            "Standard in Indian bungalow, Southeast Asian shophouse, Brazilian varanda."
        ),
        "climate_zones": ["hot-humid", "composite", "hot-dry"],
        "intervention": "facade",
        "delta_temp_c": -2.5,
        "materials": ["any"],
        "origin": "India, Southeast Asia, Brazil, Caribbean",
        "cost_tier": "medium",
    },
    {
        "id": "green_roof",
        "name": "Planted roof / green roof",
        "description": (
            "Vegetation layer on flat roof reduces surface temperature through "
            "evapotranspiration and insulation. Can drop roof surface temp by 20–40°C "
            "vs bare concrete. Traditional sod roofs (Scandinavia), terrace gardens "
            "(Mughal), and planted flat roofs (West Africa) all exploit this principle."
        ),
        "climate_zones": ["hot-humid", "composite", "temperate"],
        "intervention": "roof",
        "delta_temp_c": -3.0,
        "materials": ["soil", "gravel", "local plants"],
        "origin": "Global vernacular",
        "cost_tier": "medium",
    },
    {
        "id": "water_feature",
        "name": "Reflecting pool / hauz / kund",
        "description": (
            "Indoor or courtyard water body exploits evaporative cooling. "
            "1m² of open water surface evaporates ~2.4 MJ/day in hot-dry conditions "
            "— equivalent to a 600W air conditioner running 24 hours. "
            "Hauz (Mughal), kund (stepwell), salsabil (Persian fountain) all serve this role."
        ),
        "climate_zones": ["hot-dry", "composite"],
        "intervention": "interior",
        "delta_temp_c": -2.0,
        "materials": ["stone", "tile", "water"],
        "origin": "Mughal India, Persia, North Africa",
        "cost_tier": "medium",
    },
    {
        "id": "night_purge_ventilation",
        "name": "Night purge ventilation",
        "description": (
            "Open high-level openings at night to flush stored heat from thermal mass "
            "using cool night air. Requires temperature swing >8°C between day and night. "
            "Effective in hot-dry and composite climates. "
            "Traditional haveli and riad designs exploit this passively."
        ),
        "climate_zones": ["hot-dry", "composite"],
        "intervention": "ventilation",
        "delta_temp_c": -3.5,
        "materials": ["existing openings"],
        "origin": "India, Morocco, Iran",
        "cost_tier": "very-low",
    },
    {
        "id": "perforated_paving",
        "name": "Permeable / perforated paving",
        "description": (
            "Paving with holes or gaps allows rainwater infiltration and supports "
            "evaporative cooling of ground surface. Reduces urban runoff and lowers "
            "surface temperature vs sealed asphalt. Traditional stone cobbles, "
            "laterite blocks, and sand-set paving all achieve this naturally."
        ),
        "climate_zones": ["hot-humid", "composite", "temperate"],
        "intervention": "ground",
        "delta_temp_c": -1.5,
        "materials": ["stone", "laterite", "gravel", "earth"],
        "origin": "Global traditional urbanism",
        "cost_tier": "low",
    },
]


# ── Simple text embedding (TF-IDF-like for hackathon speed) ──────────────────

def _embed_text(text: str, vocab_size: int = 512) -> np.ndarray:
    """
    Lightweight deterministic embedding using character n-gram hashing.
    Replace with a real sentence-transformer in production.
    """
    vec = np.zeros(vocab_size, dtype=np.float32)
    text = text.lower()
    for i in range(len(text) - 2):
        trigram = text[i:i+3]
        idx = hash(trigram) % vocab_size
        vec[idx] += 1.0
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec /= norm
    return vec


# ── FAISS index ───────────────────────────────────────────────────────────────

class VernacularIndex:

    def __init__(self):
        self.dim = 512
        self.index = faiss.IndexFlatL2(self.dim)
        self.entries: list[dict] = []
        self._build()

    def _build(self) -> None:
        vectors = []
        for entry in VERNACULAR_DB:
            text = f"{entry['name']} {entry['description']} {' '.join(entry['climate_zones'])}"
            vec  = _embed_text(text, self.dim)
            vectors.append(vec)
            self.entries.append(entry)

        matrix = np.stack(vectors).astype(np.float32)
        self.index.add(matrix)
        logger.info(f"FAISS index built with {len(self.entries)} vernacular techniques")

    def search(self, query: str, k: int = 4) -> list[dict]:
        """Retrieve top-k most relevant techniques for a query."""
        q_vec = _embed_text(query, self.dim).reshape(1, -1)
        _, indices = self.index.search(q_vec, k)
        return [self.entries[i] for i in indices[0] if i < len(self.entries)]


# ── LLM prescription ──────────────────────────────────────────────────────────

@dataclass
class PrescriptionRequest:
    worst_surface_material: str
    peak_temp_c: float
    dead_zone_rooms: list[str]
    climate_zone: str = "hot-dry"
    lat: float = 23.0
    lon: float = 77.0


@dataclass
class Prescription:
    technique_id: str
    name: str
    rationale: str
    delta_temp_c: float
    cost_tier: str
    cultural_note: str
    priority: int


def generate_prescriptions(req: PrescriptionRequest,
                            index: VernacularIndex) -> list[Prescription]:
    """
    1. Build a semantic query from the building's heat profile
    2. Retrieve top-k techniques from FAISS
    3. Send to Claude for ranked, contextualised recommendations
    """
    query = (
        f"building with {req.worst_surface_material} walls, "
        f"peak temperature {req.peak_temp_c:.1f}°C, "
        f"climate zone {req.climate_zone}, "
        f"ventilation dead zones in: {', '.join(req.dead_zone_rooms) or 'none'}"
    )

    retrieved = index.search(query, k=5)

    # Format retrieved techniques for LLM context
    context = json.dumps(retrieved, indent=2)

    prompt = f"""You are an expert in vernacular architecture and passive cooling design.

A building analysis has returned the following heat profile:
- Dominant wall material: {req.worst_surface_material}
- Peak indoor surface temperature: {req.peak_temp_c:.1f}°C
- Climate zone: {req.climate_zone}
- Location: lat={req.lat:.2f}, lon={req.lon:.2f}
- Ventilation dead zones (rooms with no airflow path to exterior): {req.dead_zone_rooms}

The following vernacular cooling techniques have been retrieved as potentially relevant:
{context}

Based on this heat profile, provide a ranked list of 3–4 specific interventions.
For each, explain WHY it fits this specific building's problems.
Include the cultural origin and why this technique evolved for this climate.
Emphasise that western-imported architecture ignored these solutions.

Respond ONLY as a JSON array of objects with these fields:
technique_id, name, rationale, delta_temp_c, cost_tier, cultural_note, priority (1=highest)

No preamble. No markdown fences. Pure JSON array only."""

    genai.configure(api_key=os.environ['GEMINI_API_KEY'])
    model = genai.GenerativeModel('gemini-2.5-flash')
    response = model.generate_content(prompt)
    raw = response.text.strip()
    if raw.startswith('```'):
        raw = raw.split(chr(10), 1)[-1].rsplit('```', 1)[0].strip()

    try:
        items = json.loads(raw)
    except json.JSONDecodeError:
        # Fallback: return top retrieved techniques without LLM ranking
        logger.warning("LLM JSON parse failed, using retrieved techniques directly")
        items = [
            {
                "technique_id": t["id"],
                "name": t["name"],
                "rationale": t["description"][:200],
                "delta_temp_c": t["delta_temp_c"],
                "cost_tier": t["cost_tier"],
                "cultural_note": t["origin"],
                "priority": i + 1,
            }
            for i, t in enumerate(retrieved[:4])
        ]

    return [Prescription(**item) for item in items]


def prescriptions_to_json(prescriptions: list[Prescription]) -> list[dict]:
    return [
        {
            "priority": p.priority,
            "technique_id": p.technique_id,
            "name": p.name,
            "rationale": p.rationale,
            "delta_temp_c": p.delta_temp_c,
            "cost_tier": p.cost_tier,
            "cultural_note": p.cultural_note,
        }
        for p in sorted(prescriptions, key=lambda x: x.priority)
    ]
