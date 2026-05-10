import { useState, useEffect, useRef } from "react"

const GRAPH_PAPER = {
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
}

const ROOF_OPTS = ["concrete", "terracotta tiles", "metal", "green roof"]
const WALL_OPTS = ["concrete", "brick", "glass", "adobe", "plaster"]

export default function Questionnaire({ API, buildingPhoto, onDone }) {
  const [roof,      setRoof]      = useState("concrete")
  const [wall,      setWall]      = useState("concrete")
  const [windows,   setWindows]   = useState(30)
  const [floors,    setFloors]    = useState(2)
  const [photo,     setPhoto]     = useState(buildingPhoto ?? null)
  const [detecting, setDetecting] = useState(false)
  const [detected,  setDetected]  = useState(null)
  const photoRef = useRef()

  async function runDetection(file) {
    setDetecting(true)
    setDetected(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const res  = await fetch(`${API}/detect-material`, { method: "POST", body: form })
      if (!res.ok) return
      const data = await res.json()
      if (data.material && WALL_OPTS.includes(data.material)) {
        setWall(data.material)
        setDetected(data.material)
      }
    } catch (_) {}
    setDetecting(false)
  }

  useEffect(() => {
    if (buildingPhoto) runDetection(buildingPhoto)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handlePhotoChange(file) {
    if (!file) return
    setPhoto(file)
    runDetection(file)
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", color: "#111",
      fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
      ...GRAPH_PAPER,
    }}>
      <div style={{
        width: 440, padding: 36,
        background: "rgba(255,255,255,0.93)",
        borderRadius: 14, border: "1px solid rgba(0,0,0,0.08)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.1)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <img src="/59135.jpg" alt="Vernat"
            style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover" }} />
          <span style={{
            fontSize: 28, fontWeight: 700, color: "#111",
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            letterSpacing: "-0.01em", lineHeight: 1,
          }}>Vernat.</span>
        </div>
        <h2 style={{
          marginTop: 4, marginBottom: 4, color: "#111",
          fontSize: 22, fontWeight: 700,
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          letterSpacing: "-0.01em",
        }}>
          Building Properties
        </h2>
        <p style={{ color: "#888", fontSize: 13, marginBottom: 24, marginTop: 0 }}>
          Calibrate the thermal simulation for your building.
        </p>

        <Field label="Roof material">
          <Sel value={roof} onChange={setRoof} options={ROOF_OPTS} />
        </Field>

        <Field mt={14}
          label={
            <>Wall material{detected &&
              <span style={{ marginLeft: 8, fontSize: 11, color: "#388e3c" }}>
                ✓ AI detected: {detected}
              </span>}
            </>
          }>
          <Sel value={wall} onChange={setWall} options={WALL_OPTS} />
        </Field>

        <Field mt={14} label={`Window coverage: ${windows}%`}>
          <input type="range" min={10} max={80} value={windows}
            onChange={e => setWindows(Number(e.target.value))}
            style={{ width: "100%", marginTop: 6, accentColor: "#e07a3a" }} />
          <div style={{ display: "flex", justifyContent: "space-between",
                        fontSize: 10, color: "#aaa", marginTop: 2 }}>
            <span>10%</span><span>80%</span>
          </div>
        </Field>

        <Field mt={14} label="Number of floors">
          <Sel value={String(floors)} onChange={v => setFloors(Number(v))}
            options={["1", "2", "3", "4", "5"]} />
        </Field>

        {/* Exterior photo for AI material detection */}
        <div
          onClick={() => photoRef.current.click()}
          style={{
            marginTop: 20, padding: 14, borderRadius: 8, cursor: "pointer",
            textAlign: "center",
            border: `1px dashed ${photo ? "#81c784" : "#d0d0d0"}`,
            background: photo ? "#f1f8f1" : "#fafafa",
          }}>
          <div style={{ fontSize: 12, color: photo ? "#388e3c" : "#888" }}>
            {detecting
              ? "Detecting wall material…"
              : photo
              ? `✓  ${photo.name ?? "photo uploaded"} — click to change`
              : "Upload exterior photo for AI material detection"}
          </div>
          <div style={{ fontSize: 10, color: "#bbb", marginTop: 3 }}>optional</div>
          <input ref={photoRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={e => handlePhotoChange(e.target.files[0])} />
        </div>

        <button
          onClick={() => onDone({ roofMaterial: roof, wallMaterial: wall, windowCoverage: windows, floors })}
          style={{
            width: "100%", marginTop: 24, padding: "12px 0", border: "none",
            borderRadius: 8, background: "#e07a3a", color: "#fff",
            fontWeight: 700, fontSize: 14, cursor: "pointer",
            boxShadow: "0 4px 14px rgba(224,122,58,0.35)",
          }}>
          Analyse building →
        </button>
      </div>
    </div>
  )
}

function Field({ label, mt = 0, children }) {
  return (
    <div style={{ marginTop: mt }}>
      <div style={{ fontSize: 12, color: "#555", fontWeight: 500, marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  )
}

function Sel({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        display: "block", width: "100%", padding: "8px 10px",
        border: "1px solid #d0d0d0", borderRadius: 6,
        background: "#fff", color: "#111", fontSize: 13,
        outline: "none",
      }}>
      {options.map(o => <option key={o}>{o}</option>)}
    </select>
  )
}
