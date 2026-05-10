# Vernat.
**Climate Justice through vernacular architectural practices.**
Tackling urban heat islands with computer vision, 3D reconstruction, and thermal simulation.

> *"Western architecture was imposed on climates it was never designed for. Centuries of vernacular wisdom — jali screens, courtyards, badgirs, lime wash — were discarded. Cities are now paying for it in heat, energy, and lives."*

---

## What it does

Vernat takes a floorplan image, reconstructs it as a navigable 3D model, simulates how heat moves through the space across a 24-hour solar cycle, and recommends culturally-grounded vernacular interventions, jali screens, green roofs, courtyard openings, lime wash, earthen walls, ranked by thermal impact and cost.

---

## Pipeline

```
Floorplan image (JPG / PNG / hand sketch)
      │
      ├─ CubiCasa5K (HRNetV2 semantic segmentation)
      │    → room type + bounding box per room
      │    → fallback: Gemini 1.5 Flash Vision API
      │    → fallback: DEMO_PRESET (4-room layout)
      │
      ├─ OpenCV (CLAHE → bilateral filter → Otsu → Hough)
      │    → wall line detection (used for window placement)
      │
      ├─ Open3D hollow wall extrusion
      │    → 4 wall boxes per room + directed window slabs + door gap
      │    → .ply mesh served via FastAPI
      │
      ├─ Gemini 1.5 Flash Vision API
      │    → compass north direction detection
      │
      ├─ pysolar + pvlib
      │    → solar altitude + azimuth, hourly, for lat/lon
      │    → direct solar gain per surface
      │
      ├─ 24-hour thermal simulation (custom physics)
      │    → solar gain − thermal mass decay − convective loss
      │    → per-material time-series temperatures
      │
      ├─ NetworkX ventilation graph (Not shown in demo)
      │    → max-flow / Dijkstra dead zone detection
      │
      └─ FAISS + Gemini 2.5 Flash RAG
           → vernacular prescription engine
           → ranked by thermal impact + cost tier
```

---

## Tech Stack

### Backend (Python 3.12)

| Component | Library / Version |
|---|---|
| API server | FastAPI 0.111.0 · Uvicorn 0.29.0 |
| Room detection (primary) | CubiCasa5K — HRNetV2 semantic segmentation (cloned from GitHub) |
| Room detection (fallback) | Gemini 1.5 Flash Vision API via `google-generativeai` 0.8.3 |
| Computer vision | OpenCV 4.9.0 (CLAHE, bilateral filter, Otsu, Canny, HoughLinesP) |
| 3D mesh generation | Open3D 0.19.0 |
| Deep learning runtime | PyTorch ≥ 1.9 · torchvision ≥ 0.10 |
| Solar position | pysolar 0.11 · pvlib 0.10.5 |
| Ventilation graph | NetworkX 3.3 (max-flow / Dijkstra) |
| Vector store | FAISS-cpu 1.8.0 |
| LLM / RAG | Gemini 2.5 Flash via `google-generativeai` |
| Numerics | NumPy 1.26.4 · SciPy 1.13.0 |
| Image processing | Pillow 10.3.0 |
| Mesh utilities | trimesh 4.3.2 |
| Object detection | Ultralytics (YOLOv8) 8.2.0 |
| Environment | python-dotenv 1.0.1 |

### Frontend (Node / Browser)

| Component | Library / Version |
|---|---|
| UI framework | React 19.2.5 · React DOM 19.2.5 |
| Build tool | Vite 8.0.10 |
| 3D viewer | Three.js 0.184 (OrbitControls · PLYLoader · WireframeGeometry · GridHelper) |
| Compiler | React Compiler (`babel-plugin-react-compiler` 1.0.0 via `@rolldown/plugin-babel`) |
| Type checking | TypeScript types for React 19 |
| Fonts | Cormorant Garamond (serif headings) · Inter (body) — Google Fonts |

---

## Setup

```bash
# Backend
cd backend
pip install -r requirements.txt
# CubiCasa5K (room detector — cloned during setup):
git clone https://github.com/CubiCasa/CubiCasa5k.git
# Download model weights → ~/.cache/cubicasa5k/model_best_val_loss_var.pkl
# (or set CUBICASA_MODEL_PATH env var)

cp .env.example .env   # add GEMINI_API_KEY
python -m uvicorn main:app --reload

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`

---

## Vernacular techniques database

| Technique | Origin | Cooling effect | Cost |
|---|---|---|---|
| Jali screen | Rajasthan, Mughal India | −3.5°C | Low |
| Central courtyard | India, Middle East, Mediterranean | −5.0°C | High |
| Badgir (wind tower) | Iran, Pakistan, UAE | −7.0°C | Medium |
| Lime wash | Rajasthan, Greece, Morocco | −4.0°C | Very low |
| Rammed earth walls | India, Iran, West Africa | −6.0°C | Low |
| Verandah / deep overhang | India, SE Asia, Brazil | −2.5°C | Medium |
| Green roof | Global vernacular | −3.0°C | Medium |
| Reflecting pool / hauz | Mughal India, Persia | −2.0°C | Medium |
| Night purge ventilation | India, Morocco, Iran | −3.5°C | Very low |
| Permeable paving | Global traditional urbanism | −1.5°C | Low |

---

## Research + Sources

- **Vernacular cooling — India:** https://youtube.com/shorts/vjFkufP1A_w
- **Vernacular cooling — Middle East:** https://sustainability.hapres.com/htmls/JSR_1395_Detail.html
- **Native American architectural practices:** https://folklife-media.si.edu/docs/festival/program-book-articles/FESTBK1979_07.pdf
- **Urban heat island land use:** https://www.mdpi.com/2413-8851/7/3/76
- **Vastu Shastra spatial principles:** traditional Indian architectural canon
- **Feng Shui spatial orientation:** traditional Chinese architectural canon
- **COLMAP 3D reconstruction:** https://demuc.de/colmap/
- **Schönberger, J. L., & Frahm, J. M. (2016).** Structure-from-motion revisited. *CVPR.* https://demuc.de/papers/schoenberger2016mvs.pdf

---

## How Vernat tackles Climate Justice

Urban heat islands disproportionately affect low-income communities in the Global South, these are the same communities where western-style glass-and-concrete architecture was imposed on climates it was never designed for. Vernat makes passive cooling interventions accessible to city planners, housing authorities, NGOs, and communities. All without requiring an architect, AC, or expensive retrofits.

