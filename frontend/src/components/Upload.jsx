import { useState, useRef } from "react"

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

export default function Upload({ API, onComplete }) {
  const [floorplan,  setFloorplan]  = useState(null)
  const [status,     setStatus]     = useState("idle")
  const [message,    setMessage]    = useState("")
  const fpRef  = useRef()

  async function handleSubmit() {
    if (!floorplan) return
    setStatus("uploading")
    setMessage("Detecting walls and rooms…")

    const form = new FormData()
    form.append("file", floorplan)

    try {
      const res    = await fetch(`${API}/reconstruction/upload?scale=50`, {
        method: "POST", body: form,
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.detail ?? "Upload failed")
      setStatus("idle")
      onComplete(result, null, floorplan)
    } catch (e) {
      setStatus("error")
      setMessage(e.message ?? "Upload failed")
    }
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100%", gap: 24,
      ...GRAPH_PAPER,
      color: "#111", fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
    }}>

      {/* Card */}
      <div style={{
        width: 420, background: "rgba(255,255,255,0.92)",
        borderRadius: 14, padding: "36px 32px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.12)",
        border: "1px solid rgba(0,0,0,0.07)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <img src="/59135.jpg" alt="Vernat"
            style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover" }} />
          <span style={{
            fontSize: 28, fontWeight: 700, color: "#111",
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            letterSpacing: "-0.01em", lineHeight: 1,
          }}>
            Vernat.
          </span>
        </div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 28, lineHeight: 1.5 }}>
          Upload a floorplan to reconstruct in 3D and analyse thermal performance.
        </div>

        {status === "idle" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <DropZone
              label="Floorplan image"
              sublabel="JPG · PNG · hand sketch or architectural drawing"
              required
              file={floorplan}
              accent="#e07a3a"
              onClick={() => fpRef.current.click()}
            />
            <input ref={fpRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={e => setFloorplan(e.target.files[0])} />

            <button
              onClick={handleSubmit}
              disabled={!floorplan}
              style={{
                padding: "12px 0", borderRadius: 9, border: "none",
                background: floorplan ? "#e07a3a" : "#e8e8e8",
                color: floorplan ? "#fff" : "#aaa",
                fontSize: 14, fontWeight: 600,
                cursor: floorplan ? "pointer" : "default",
                marginTop: 4,
                boxShadow: floorplan ? "0 4px 14px rgba(224,122,58,0.35)" : "none",
              }}>
              Upload &amp; Continue →
            </button>
          </div>
        )}

        {status === "uploading" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 13, color: "#555" }}>{message}</div>
            <div style={{ marginTop: 8, fontSize: 12, color: "#aaa" }}>
              Usually done in 2–5 seconds
            </div>
          </div>
        )}

        {status === "error" && (
          <div>
            <div style={{
              color: "#c0392b", fontSize: 13, fontWeight: 500,
              background: "#fdf2f0", border: "1px solid #f5c6c0",
              borderRadius: 8, padding: "10px 14px", marginBottom: 10,
              lineHeight: 1.5,
            }}>
              {message}
            </div>
            <div style={{
              color: "#888", fontSize: 11, lineHeight: 1.6,
              background: "#fafafa", border: "1px solid #eee",
              borderRadius: 8, padding: "8px 12px", marginBottom: 14,
            }}>
              <strong style={{ color: "#555" }}>Tips:</strong> use a clear image with labeled rooms,
              visible borders, and good contrast.
            </div>
            <button
              onClick={() => { setStatus("idle"); setMessage("") }}
              style={{
                width: "100%", padding: "10px 0", borderRadius: 8,
                border: "1px solid #d0d0d0", background: "#f5f5f5",
                color: "#444", cursor: "pointer", fontSize: 13, fontWeight: 500,
              }}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function DropZone({ label, sublabel, required, file, accent, onClick }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: file ? "14px 18px" : "20px 18px",
        border: `2px dashed ${file ? accent : hovered ? "#bbb" : "#d0d0d0"}`,
        borderRadius: 10, cursor: "pointer", textAlign: "center",
        background: file ? `${accent}09` : hovered ? "#fafafa" : "transparent",
        transition: "all 0.15s",
      }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: file ? accent : "#555" }}>
        {file ? `✓  ${file.name}` : `${label}${required ? "" : " (optional)"}`}
      </div>
      <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>{sublabel}</div>
    </div>
  )
}
