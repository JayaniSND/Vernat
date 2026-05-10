// frontend/src/App.jsx
import { useState, useRef } from "react"
import Upload        from "./components/Upload"
import Questionnaire from "./components/Questionnaire"
import RoomMap       from "./components/RoomMap"
import Viewer        from "./components/Viewer"
import { Prescriptions } from "./components/panels"

function getClimateZone(lat) {
  const a = Math.abs(lat)
  if (a < 23) return "tropical"
  if (a < 35) return "subtropical"
  if (a < 50) return "temperate"
  return "cold"
  //understanding subretion based on coordinates
}

const MAT_MAP = {
  "terracotta tiles": "brick",
  "green roof":       "plaster",
  "adobe":            "brick",
}

function buildSurfaces({ wallMaterial, roofMaterial, windowCoverage }) {
  const wallMat   = MAT_MAP[wallMaterial] ?? wallMaterial
  const roofMat   = MAT_MAP[roofMaterial] ?? roofMaterial
  const glassFrac = windowCoverage / 100
  const wallArea  = 20
  return [
    { material: wallMat,  area_m2: Math.max(1, Math.round(wallArea * (1 - glassFrac))) },
    { material: "glass",  area_m2: Math.max(1, Math.round(wallArea * glassFrac)) },
    { material: wallMat,  area_m2: Math.max(1, Math.round(wallArea * (1 - glassFrac))) },
    { material: roofMat,  area_m2: 30 },
  ]
}

// Static scene tree — matches RoomMap layout
const SCENE_ROOMS = [
  { id: "living",   label: "Living Room", area: 22.5, material: "plaster"  },
  { id: "kitchen",  label: "Kitchen",     area: 9.8,  material: "concrete" },
  { id: "bathroom", label: "Bathroom",    area: 5.2,  material: "concrete" },
  { id: "bedroom",  label: "Bedroom",     area: 14.3, material: "brick"    },
  { id: "bedroom2", label: "Bedroom 2",   area: 13.1, material: "brick"    },
]

const MAT_DOT = {
  concrete: "#9E9E9E",
  brick:    "#C1440E",
  glass:    "#7EC8E3",
  wood:     "#A0522D",
  metal:    "#78909C",
  plaster:  "#B0BEC5",
}

function RoomRow({ room, ventRoom, thermalData, isSelected, onSelect, onFocusRoom }) {
  const [hovered, setHovered] = useState(false)
  const dot = room.color ?? MAT_DOT[room.material] ?? "#555"
  const peakTemp = thermalData?.surfaces?.[0]?.peak_temp ?? null

  function handleClick() {
    onSelect(room.id)
    if (onFocusRoom) onFocusRoom(room)
  }

  return (
    <div>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={handleClick}
        style={{
          padding: "8px 16px",
          display: "flex", alignItems: "center", gap: 10,
          borderBottom: "1px solid #1f1f1f",
          borderLeft: isSelected ? `3px solid ${dot}` : "3px solid transparent",
          background: isSelected ? "#1c1c1c" : hovered ? "#222" : "transparent",
          cursor: "pointer",
          transition: "background 0.1s",
        }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: "#252525",
          border: `1.5px solid ${dot}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: dot }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "#d0d0d0", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {room.label}
          </div>
          <div style={{ fontSize: 10, color: "#555", marginTop: 1 }}>
            {room.area_m2 ?? room.area} m² · {room.material}
          </div>
        </div>
        {ventRoom && (
          <div style={{
            fontSize: 10, fontWeight: 600,
            color: ventRoom.is_dead_zone ? "#e05a3a" : "#4a9a5a",
            flexShrink: 0,
          }}>
            {ventRoom.is_dead_zone ? "dead" : `${ventRoom.ach} ACH`}
          </div>
        )}
      </div>

      {isSelected && (
        <div style={{
          padding: "10px 16px 12px 19px",
          background: "#191919",
          borderLeft: `3px solid ${dot}`,
          borderBottom: "1px solid #1f1f1f",
          display: "flex", flexWrap: "wrap", gap: "8px 20px",
        }}>
          <Kv k="Area"     v={`${room.area_m2 ?? room.area} m²`} />
          <Kv k="Volume"   v={room.volume_m3 ? `${room.volume_m3} m³` : "—"} />
          <Kv k="Material" v={room.material} />
          {peakTemp != null && <Kv k="Peak temp" v={`${peakTemp}°C`} />}
        </div>
      )}
    </div>
  )
}

function Kv({ k, v }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{k}</div>
      <div style={{ fontSize: 11, color: "#aaa", fontWeight: 500 }}>{v}</div>
    </div>
  )
}

function StatRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
      <span style={{ fontSize: 11, color: "#555" }}>{label}</span>
      <span style={{ fontSize: 11, color: "#aaa", fontWeight: 500 }}>{value}</span>
    </div>
  )
}

export default function App() {
  const [step,          setStep]          = useState(1)
  const [location,      setLocation]      = useState({ lat: "", lon: "", name: "" })
  const [addr,          setAddr]          = useState({ city: "", state: "", country: "" })
  const [reconJob,      setReconJob]      = useState(null)
  const [buildingPhoto, setBuildingPhoto] = useState(null)
  const [meshUrl,       setMeshUrl]       = useState(null)
  const [thermalData,   setThermalData]   = useState(null)
  const [ventData,      setVentData]      = useState(null)
  const [prescriptions, setPrescriptions] = useState([])
  const [activeHour,    setActiveHour]    = useState(14)
  const [showAfter,     setShowAfter]     = useState(false)
  const [loadingMsg,    setLoadingMsg]    = useState(null)
  const [selectedRoom,  setSelectedRoom]  = useState(null)
  const viewerRef = useRef(null)

  const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api"

  // ── Step 1 handlers ───────────────────────────────────────────────────────
  function handleGeolocate() {
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation({
        lat: pos.coords.latitude.toFixed(5),
        lon: pos.coords.longitude.toFixed(5),
        name: "Current location",
      }),
      () => alert("Geolocation denied or unavailable.")
    )
  }

  async function handleGeocode() {
    const q = [addr.city, addr.state, addr.country].filter(Boolean).join(", ")
    if (!q) { alert("Enter at least a city name."); return }
    const res  = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`
    )
    const data = await res.json()
    if (data.length) {
      setLocation({
        lat: parseFloat(data[0].lat).toFixed(5),
        lon: parseFloat(data[0].lon).toFixed(5),
        name: data[0].display_name,
      })
    } else {
      alert("Location not found. Try a different search.")
    }
  }

  function handleContinue() {
    const lat = parseFloat(location.lat)
    const lon = parseFloat(location.lon)
    if (isNaN(lat) || isNaN(lon)) {
      alert("Please look up a location or use geolocation.")
      return
    }
    setStep(2)
  }

  function onUploadComplete(job, photo) {
    setReconJob(job)
    setBuildingPhoto(photo ?? null)
    setStep(3)
  }

  async function handleQuestionnaireDone(props) {
    const lat = parseFloat(location.lat)
    const lon = parseFloat(location.lon)

    setMeshUrl(`${API}/reconstruction/mesh/${reconJob?.job_id}`)
    setStep(5)

    // ── Thermal simulation ─────────────────────────────────────────────────
    setLoadingMsg("Running thermal simulation…")
    let thermal = null
    try {
      console.log("[thermal] POST", `${API}/thermal/simulate`)
      const res = await fetch(`${API}/thermal/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: reconJob?.job_id, lat, lon, surfaces: buildSurfaces(props) }),
      })
      thermal = await res.json()
      console.log("[thermal] result:", thermal)
      setThermalData(thermal)
    } catch (err) {
      console.error("[thermal] failed:", err)
    }

    // ── Ventilation analysis ───────────────────────────────────────────────
    setLoadingMsg("Analysing ventilation…")
    let vent = null
    try {
      console.log("[ventilation] POST", `${API}/ventilation/analyse`)
      const res = await fetch(`${API}/ventilation/analyse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lon }),
      })
      vent = await res.json()
      console.log("[ventilation] result:", vent)
      setVentData(vent)
    } catch (err) {
      console.error("[ventilation] failed:", err)
    }

    // ── Prescription recommendations ───────────────────────────────────────
    setLoadingMsg("Generating recommendations…")
    try {
      const worstSurface = thermal?.surfaces?.find(s => s.is_worst)
      const deadZones    = vent?.rooms?.filter(r => r.is_dead_zone).map(r => r.id) ?? []
      console.log("[prescription] POST", `${API}/prescription/recommend`)
      const res = await fetch(`${API}/prescription/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worst_surface_material: worstSurface?.material ?? props.wallMaterial,
          peak_temp_c:            worstSurface?.peak_temp ?? 42,
          dead_zone_rooms:        deadZones,
          climate_zone:           getClimateZone(lat),
          lat, lon,
        }),
      })
      const rx = await res.json()
      console.log("[prescription] result:", rx)
      setPrescriptions(rx.prescriptions ?? [])
    } catch (err) {
      console.error("[prescription] failed:", err)
    }

    setLoadingMsg(null)
  }

  // ── Step 1: Location ──────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", color: "#111",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        backgroundColor: "#f5f5f0",
        backgroundImage: [
          "linear-gradient(#e0e0e0 1px, transparent 1px)",
          "linear-gradient(90deg, #e0e0e0 1px, transparent 1px)",
          "linear-gradient(#ebebeb 1px, transparent 1px)",
          "linear-gradient(90deg, #ebebeb 1px, transparent 1px)",
          "linear-gradient(rgba(245,245,240,0.80), rgba(245,245,240,0.80))",
          "url('/buildings.jpg')",
        ].join(", "),
        backgroundSize: "50px 50px, 50px 50px, 10px 10px, 10px 10px, cover, cover",
        backgroundPosition: "-1px -1px, -1px -1px, -1px -1px, -1px -1px, center, center",
        backgroundAttachment: "fixed",
      }}>
        <div style={{ width: 520, padding: "44px 48px", background: "rgba(255,255,255,0.93)",
                      borderRadius: 16, border: "1px solid rgba(0,0,0,0.08)",
                      boxShadow: "0 12px 60px rgba(0,0,0,0.13)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <img src="/59135.jpg" alt="Vernat logo"
              style={{ width: 42, height: 42, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
            <span style={{
              fontSize: 36, fontWeight: 700, color: "#111",
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              letterSpacing: "-0.02em", lineHeight: 1,
            }}>Vernat.</span>
          </div>
          <p style={{
            fontSize: 16, color: "#e07a3a", fontWeight: 600,
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            margin: "0 0 6px", lineHeight: 1.4, letterSpacing: "0.01em",
          }}>
            Climate Justice through vernacular architectural practices
          </p>
          <p style={{ color: "#888", fontSize: 13, marginBottom: 32, marginTop: 0, lineHeight: 1.5 }}>
            An effort to relieve Urban Heat Islands
          </p>

          <button onClick={handleGeolocate} style={onboardSecondaryBtn}>
            Use current location
          </button>

          <div style={{ margin: "18px 0", textAlign: "center", fontSize: 11, color: "#888",
                        display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, height: 1, background: "#d8d8d8" }} />
            or search manually
            <div style={{ flex: 1, height: 1, background: "#d8d8d8" }} />
          </div>

          <label style={{ fontSize: 11, color: "#777", fontWeight: 500 }}>
            City
            <input type="text" value={addr.city}
              onChange={e => setAddr(a => ({ ...a, city: e.target.value }))}
              placeholder="e.g. London" style={onboardInput} />
          </label>

          <div style={{ display: "flex", gap: 10, margin: "10px 0" }}>
            <label style={{ flex: 1, fontSize: 11, color: "#777", fontWeight: 500 }}>
              State / Region
              <input type="text" value={addr.state}
                onChange={e => setAddr(a => ({ ...a, state: e.target.value }))}
                placeholder="e.g. California" style={onboardInput} />
            </label>
            <label style={{ flex: 1, fontSize: 11, color: "#777", fontWeight: 500 }}>
              Country
              <input type="text" value={addr.country}
                onChange={e => setAddr(a => ({ ...a, country: e.target.value }))}
                placeholder="e.g. United States" style={onboardInput} />
            </label>
          </div>

          <button onClick={handleGeocode} style={{ ...onboardSecondaryBtn, marginBottom: 10 }}>
            Look up coordinates
          </button>

          {location.lat && location.lon && (
            <div style={{ fontSize: 11, color: "#444", marginBottom: 14,
                          padding: "8px 12px", background: "#f0f7f0", borderRadius: 8,
                          border: "1px solid #c8e6c9", lineHeight: 1.5 }}>
              <span style={{ color: "#388e3c", marginRight: 6 }}>✓</span>
              {location.lat}, {location.lon}
              {location.name && location.name !== "Current location" && (
                <div style={{ color: "#666", marginTop: 2, fontSize: 10,
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {location.name}
                </div>
              )}
            </div>
          )}

          <button onClick={handleContinue} style={onboardPrimaryBtn}>
            Continue →
          </button>
        </div>
      </div>
    )
  }

  // ── Step 2: Upload ────────────────────────────────────────────────────────
  if (step === 2) {
    return (
      <div style={{ height: "100vh" }}>
        <Upload API={API} onComplete={onUploadComplete} />
      </div>
    )
  }

  // ── Step 3: Questionnaire ─────────────────────────────────────────────────
  if (step === 3) {
    return (
      <Questionnaire
        API={API}
        buildingPhoto={buildingPhoto}
        onDone={handleQuestionnaireDone}
      />
    )
  }

  // ── Step 4: 2D room map ───────────────────────────────────────────────────
  if (step === 4) {
    return (
      <div style={{ height: "100vh", background: "#0f0f0f", position: "relative",
                    fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif" }}>
        <RoomMap onView3D={() => setStep(5)} />
        {loadingMsg && (
          <div style={{
            position: "absolute", bottom: 28, left: "50%", transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.85)", padding: "8px 20px", borderRadius: 20,
            fontSize: 12, color: "#e07a3a", whiteSpace: "nowrap",
            border: "1px solid #333",
          }}>
            {loadingMsg}
          </div>
        )}
      </div>
    )
  }

  // ── Step 5: Professional 3D viewer layout ─────────────────────────────────
  const sceneRooms = (reconJob?.rooms ?? SCENE_ROOMS).map(r => ({
    id:        r.id,
    label:     r.label ?? r.id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    area_m2:   r.area_m2 ?? r.area ?? 0,
    volume_m3: r.volume_m3 ?? null,
    material:  r.material ?? r.type ?? "concrete",
    color:     r.color ?? MAT_DOT[r.material ?? r.type] ?? "#888",
    centroid:  r.centroid ?? [0, 0, 0],
    bbox_m:    r.bbox_m ?? null,
  }))
  const totalArea = sceneRooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0).toFixed(1)

  function handleFocusRoom(room) {
    viewerRef.current?.focusRoom(room.centroid)
    viewerRef.current?.pulseRoom(room.id)
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
      overflow: "hidden", background: "#111",
    }}>

      {/* ── Top toolbar ──────────────────────────────────────────────────── */}
      <div style={{
        height: 64, flexShrink: 0,
        background: "#111", borderBottom: "1px solid #222",
        display: "flex", alignItems: "center",
        padding: "0 16px", gap: 12, zIndex: 20,
      }}>

        {/* Logo */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 220, gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <img src="/59135.jpg" alt="Vernat"
              style={{ width: 30, height: 30, borderRadius: 5, objectFit: "cover", flexShrink: 0 }} />
            <span style={{
              color: "#fff", fontWeight: 700, fontSize: 22,
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              letterSpacing: "-0.01em", lineHeight: 1,
            }}>
              Vernat.
            </span>
            {location.lat && (
              <span style={{ fontSize: 11, color: "#444", fontWeight: 400 }}>
                {parseFloat(location.lat).toFixed(2)}°
              </span>
            )}
          </div>
          <div style={{
            fontSize: 11, color: "#555", paddingLeft: 39,
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            letterSpacing: "0.03em", fontStyle: "italic",
          }}>
            Climate Justice through vernacular architecture
          </div>
        </div>

        {/* Center: pill toggle */}
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <div style={{
            display: "flex", gap: 2,
            background: "#1e1e1e", borderRadius: 22, padding: 3,
            border: "1px solid #2a2a2a",
          }}>
            <button onClick={() => setShowAfter(false)} style={pillBtn(!showAfter)}>
              Before
            </button>
            <button onClick={() => setShowAfter(true)} style={pillBtn(showAfter)}>
              After
            </button>
          </div>
        </div>

        {/* Right: time controls + upload */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 160, justifyContent: "flex-end" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#1e1e1e", borderRadius: 8, padding: "5px 10px",
            border: "1px solid #2a2a2a",
          }}>
            <button onClick={() => setActiveHour(h => Math.max(0, h - 1))} style={arrowBtn}>
              ‹
            </button>
            <span style={{
              color: "#e0e0e0", fontSize: 13, fontWeight: 600,
              minWidth: 40, textAlign: "center",
              fontVariantNumeric: "tabular-nums",
            }}>
              {String(activeHour).padStart(2, "0")}:00
            </span>
            <button onClick={() => setActiveHour(h => Math.min(23, h + 1))} style={arrowBtn}>
              ›
            </button>
          </div>

          <button onClick={() => setStep(2)} style={toolbarBtn}>
            Upload new
          </button>
        </div>
      </div>

      {/* ── Main row ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left sidebar */}
        <aside style={{
          width: 280, flexShrink: 0,
          background: "#1a1a1a", borderRight: "1px solid #222",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{
            padding: "10px 16px", borderBottom: "1px solid #222",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#555",
                           textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Scene
            </span>
            <span style={{ fontSize: 10, color: "#444" }}>
              {sceneRooms.length} rooms
            </span>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {sceneRooms.map(room => (
              <RoomRow
                key={room.id}
                room={room}
                ventRoom={ventData?.rooms?.find(r => r.id === room.id)}
                thermalData={thermalData}
                isSelected={selectedRoom === room.id}
                onSelect={id => setSelectedRoom(prev => prev === id ? null : id)}
                onFocusRoom={handleFocusRoom}
              />
            ))}
          </div>

          <div style={{ padding: "12px 16px", borderTop: "1px solid #222" }}>
            <StatRow label="Total floor area" value={`${totalArea} m²`} />
            <StatRow label="Rooms" value={sceneRooms.length} />
            {loadingMsg && (
              <div style={{
                marginTop: 10, fontSize: 11, color: "#e07a3a",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <span style={{
                  display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                  background: "#e07a3a", flexShrink: 0,
                }} />
                {loadingMsg}
              </div>
            )}
          </div>
        </aside>

        {/* Center: 3D viewer */}
        <main style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <Viewer
            ref={viewerRef}
            meshUrl={meshUrl}
            activeHour={activeHour}
            showAfter={showAfter}
            rooms={reconJob?.rooms ?? []}
          />
          {loadingMsg && !thermalData && (
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(0,0,0,0.45)",
            }}>
              <div style={{
                background: "rgba(10,10,10,0.9)", padding: "14px 28px",
                borderRadius: 10, fontSize: 14, color: "#e07a3a",
                border: "1px solid #333", letterSpacing: "0.01em",
              }}>
                {loadingMsg}
              </div>
            </div>
          )}
        </main>

        {/* Right panel — graph paper light mode */}
        <aside style={{
          width: 380, flexShrink: 0,
          backgroundColor: "#f5f5f0",
          backgroundImage: [
            "linear-gradient(#e0e0e0 1px, transparent 1px)",
            "linear-gradient(90deg, #e0e0e0 1px, transparent 1px)",
            "linear-gradient(#ebebeb 1px, transparent 1px)",
            "linear-gradient(90deg, #ebebeb 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "50px 50px, 50px 50px, 10px 10px, 10px 10px",
          backgroundPosition: "-1px -1px, -1px -1px, -1px -1px, -1px -1px",
          borderLeft: "1px solid #d8d8d0",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{
            padding: "20px 24px 18px",
            borderBottom: "1px solid #efefef",
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: "#bbb",
              textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6,
            }}>
              Analysis
            </div>
            <div style={{
              fontSize: 20, fontWeight: 800, color: "#111",
              letterSpacing: "-0.02em", lineHeight: 1.15,
            }}>
              Vernacular<br />Interventions
            </div>
            {prescriptions.length > 0 ? (
              <div style={{ marginTop: 6, fontSize: 12, color: "#999" }}>
                {prescriptions.length} recommendations ranked by impact
              </div>
            ) : thermalData ? (
              <div style={{ marginTop: 8, fontSize: 12, color: "#bbb",
                            display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "#e07a3a", display: "inline-block", flexShrink: 0,
                }} />
                {loadingMsg ?? "Processing…"}
              </div>
            ) : null}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
            <Prescriptions items={prescriptions} loading={!!thermalData && prescriptions.length === 0} />
          </div>
        </aside>
      </div>
    </div>
  )
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const onboardPrimaryBtn = {
  width: "100%", padding: "11px 0", border: "none", borderRadius: 8,
  cursor: "pointer", fontWeight: 600, fontSize: 14,
  background: "#e07a3a", color: "#fff",
  marginTop: 4,
}

const onboardSecondaryBtn = {
  width: "100%", padding: "10px 0", border: "1px solid #d0d0d0", borderRadius: 8,
  cursor: "pointer", fontWeight: 500, fontSize: 13,
  background: "#f5f5f5", color: "#444",
}

const onboardInput = {
  display: "block", width: "100%", marginTop: 5,
  padding: "8px 10px", border: "1px solid #d0d0d0", borderRadius: 7,
  background: "#fff", color: "#111", fontSize: 13,
  boxSizing: "border-box", outline: "none",
}

function pillBtn(active) {
  return {
    padding: "5px 18px",
    borderRadius: 18,
    border: "none",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    background: active ? "#e07a3a" : "transparent",
    color: active ? "#fff" : "#666",
    transition: "background 0.15s, color 0.15s",
  }
}

const arrowBtn = {
  background: "transparent",
  border: "none",
  color: "#666",
  cursor: "pointer",
  fontSize: 18,
  lineHeight: 1,
  padding: "0 2px",
  fontWeight: 300,
}

const toolbarBtn = {
  background: "#252525",
  border: "1px solid #333",
  borderRadius: 7,
  color: "#bbb",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
  padding: "6px 14px",
  whiteSpace: "nowrap",
}
