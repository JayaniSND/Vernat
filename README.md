# Heat

Climate Justice through vernacular architectural practices.

Tackling urban heat islands with computer vision, 3D reconstruction, and thermal simulation.

---

## Pipeline

```
Video → FFmpeg frame extraction
      → COLMAP SfM (sparse point cloud + camera poses)
      → COLMAP MVS (dense point cloud → mesh)
      → YOLOv8 surface material tagging
      → pysolar solar position + ray casting
      → NASA POWER climate data
      → 24-hour time-series thermal simulation
      → Max-flow room ventilation graph
      → RAG vernacular prescription engine (FAISS + LLM)
      → Before/after comparison output
```

---

## Stack

| Layer | Technology |
|---|---|
| 3D Reconstruction | COLMAP (SfM + MVS) |
| Frame extraction | FFmpeg |
| Material detection | YOLOv8 |
| Solar position | pysolar / pvlib |
| Climate data | NASA POWER API |
| Thermal simulation | Custom physics loop |
| Ventilation model | NetworkX (max-flow) |
| Vector store | FAISS |
| LLM | Claude API / GPT-4o |
| 3D viewer | Three.js |
| Backend | FastAPI |
| Frontend | React + Three.js |

---

## Setup

```bash
# Backend
cd backend
pip install -r requirements.txt

# Frontend
cd frontend
npm install
npm run dev
```

---

## References

Schönberger, J. L., & Frahm, J. M. (2016). Structure-from-motion revisited. CVPR.
https://demuc.de/papers/schoenberger2016mvs.pdf

