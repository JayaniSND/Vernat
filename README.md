# Vernat
### Climate justice through vernacular architectural practices. Tackling urban heat islands with computer vision, 3D reconstruction, and thermal simulation.

---

## Inspiration

Across much of the World, glass-and-concrete buildings bake in climates they were never designed for. The problem hits hardest for those without AC or the means to retrofit but it affects everyone. Higher energy bills, hotter streets, more strained grids. A city full of buildings fighting their own climate instead of working with it.

This was never just one culture's problem, and the solutions were never just one culture's invention. Every civilization developed its own building intelligence, tuned to its own climate.
 
Indian architecture formalised this in Vastu Shastra: a system of spatial orientation based on sun position, cardinal directions, and airflow that determined where rooms sat, where openings faced, and how a building breathed. Chinese architecture did the same through Feng Shui, positioning structures to work with prevailing winds and solar paths rather than against them. Native American peoples built with the land: cliff dwellings carved into south-facing rock faces for winter sun and summer shade, adobe structures with thick thermal mass that absorbed heat by day and released it at night. Across the Middle East and North Africa, wind catchers and courtyard layouts were engineering solutions, not aesthetic ones.

---

## What It Does

Vernat takes a floor plan image (including hand-drawn sketches) and reconstructs it as a navigable 3D model, simulates how heat moves through the space across a 24-hour solar cycle, and recommends vernacular interventions ranked by thermal impact and cost: jali screens, green roofs, courtyard openings, lime wash, earthen walls, etc.

---

## How It's Built

Each stage was chosen because a general-purpose model couldn't do the job.

| Layer | Tool | Role |
|---|---|---|
| Perception | **CubiCasa5k** | Multi-task model trained on floor plans, accurate room and wall segmentation from architectural images |
| Sketch understanding | **Gemini 1.5 Flash Vision** | Handles messy hand-drawn sketches, labels rooms, identifies openings, detects building orientation from GPS context |
| 3D geometry | **Open3D** | Extrudes the detected 2D floor plan into a volumetric mesh for solar simulation |
| Solar physics | **pysolar + pvlib** | Sun-position tracking by latitude, longitude, date, and time: calculates which walls receive direct radiation and when |
| Knowledge retrieval | **FAISS + VERNACULAR_DB** | Local vector search over a curated database of culturally appropriate passive cooling techniques, filtered by location and available materials |
| Output generation | **Gemini 2.5 Flash** | Synthesises the solar analysis and retrieved techniques into concrete architectural advice |
| Visualisation | **Physics engine → Three.js** | Time-series solar data serialised to JSON and rendered as an animated 3D heat simulation in the browser |

---

## Challenges We Ran Into

**Floor plan segmentation was harder than it looked.**
OpenCV kept producing wrong geometry. Missed walls, phantom rooms, bad thresholds. Tuning parameters didn't give the most accurate results. Thus, we switched to CubiCasa5k, a model specifically trained on floor plans. 

**CubiCasa5k wasn't easy to load either.**
Encountered underdocumented dependencies, checkpoint loading issues. Had to work through it before anything could run end-to-end.

**The sun was going the wrong direction.**
Early simulations had it tracing a non-east-west arc, a coordinate axis alignment bug. We defined a consistent world-space reference frame and realigned the solar position vectors. After that, the 24-hour simulation finally made physical sense.

---

## What's Next for Vernat

- **COLMAP integration** : 3D reconstruction from video. Walk around a building, get a mesh.
- **Vegetation and shade graphics** : Canopy cover and greenery layers for richer visualisations.
- **Drone survey mode** : Urban-scale heat mapping from aerial video for city planners and NGOs.
- **Neighbourhood analysis** : Expand from single buildings to block-level passive cooling strategies.

---

## References

1. [Vernacular cooling techniques — India (short film)](https://youtube.com/shorts/vjFkufP1A_w?si=0EHD25sF8aor2q80)
2. [Vernacular passive cooling techniques — Middle East](https://sustainability.hapres.com/htmls/JSR_1395_Detail.html) · Journal of Sustainability Research
3. [Native American building practices](https://folklife-media.si.edu/docs/festival/program-book-articles/FESTBK1979_07.pdf) · Smithsonian Folklife Festival
4. [Land surveying for urban heat analysis](https://www.mdpi.com/2413-8851/7/3/76) · Urban Science, MDPI
5. [COLMAP — structure-from-motion & MVS](https://demuc.de/colmap/) · [paper](https://demuc.de/papers/schoenberger2016mvs.pdf)
6. [CubiCasa5k — floor plan parsing model](https://github.com/cubicasa/cubicasa5k) · [paper](https://arxiv.org/pdf/1904.01920)
7. [FAISS — efficient similarity search](https://github.com/facebookresearch/faiss) · Meta Research
