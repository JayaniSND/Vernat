// frontend/src/components/panels.jsx

// ── ThermalPanel ──────────────────────────────────────────────────────────────
export function ThermalPanel({ data, hour }) {
  if (!data) return null
  const surfaces = data.surfaces ?? []
  const ambient  = data.climate?.ambient_series?.[hour] ?? "–"

  return (
    <div style={{ fontSize: 13 }}>
      <Stat label="Ambient (outside)" value={`${Number(ambient).toFixed(1)}°C`} />
      <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600, opacity: 0.5 }}>
        Surfaces at {hour}:00
      </div>
      {surfaces.map(s => (
        <div key={s.id} style={{
          marginBottom: 10, padding: "10px 12px",
          background: s.is_worst ? "#2a1200" : "#1a1a1a",
          borderRadius: 8,
          borderLeft: s.is_worst ? "3px solid #e07a3a" : "3px solid #333",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ textTransform: "capitalize", fontWeight: 500 }}>
              {s.material}
            </span>
            <span style={{ color: tempColor(s.temp_series?.[hour] ?? 30) }}>
              {(s.temp_series?.[hour] ?? 0).toFixed(1)}°C
            </span>
          </div>
          <div style={{ marginTop: 4, opacity: 0.45, fontSize: 11 }}>
            Peak: {s.peak_temp}°C {s.is_worst ? "⚠ worst surface" : ""}
          </div>
        </div>
      ))}
    </div>
  )
}

function tempColor(t) {
  if (t > 45) return "#ff4444"
  if (t > 38) return "#ff8c00"
  if (t > 32) return "#ffd700"
  return "#66bb6a"
}

function Stat({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between",
                  padding: "8px 0", borderBottom: "1px solid #222" }}>
      <span style={{ opacity: 0.5 }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  )
}

// ── VentilationPanel ──────────────────────────────────────────────────────────
export function VentilationPanel({ data }) {
  if (!data) return null
  const rooms = data.rooms ?? []

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    padding: "8px 0", borderBottom: "1px solid #222", marginBottom: 12 }}>
        <span style={{ opacity: 0.5 }}>Max-flow capacity</span>
        <span style={{ fontWeight: 500 }}>{data.max_flow_m3s} m³/s</span>
      </div>
      <div style={{ marginBottom: 8, fontWeight: 600, opacity: 0.5 }}>
        Room ventilation
      </div>
      {rooms.map(r => (
        <div key={r.id} style={{
          marginBottom: 10, padding: "10px 12px", borderRadius: 8,
          background: r.is_dead_zone ? "#1a0a0a" : "#1a1a1a",
          borderLeft: r.is_dead_zone ? "3px solid #e05a3a" : "3px solid #2a6a3a",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 500, textTransform: "capitalize" }}>{r.id}</span>
            <span style={{ opacity: 0.6, fontSize: 11 }}>{r.ach} ACH</span>
          </div>
          <div style={{ marginTop: 6, height: 4, background: "#222", borderRadius: 2 }}>
            <div style={{
              height: "100%", borderRadius: 2,
              width: `${Math.min(100, r.score * 100)}%`,
              background: r.is_dead_zone ? "#e05a3a" : "#4a9a5a",
            }} />
          </div>
          {r.is_dead_zone && (
            <div style={{ marginTop: 4, fontSize: 11, color: "#e05a3a" }}>
              ⚠ dead zone — no airflow path to exterior
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Prescriptions (light mode) ────────────────────────────────────────────────

const COST_COLOR = {
  "very-low": "#4caf50",
  "low":      "#26a69a",
  "medium":   "#ff9800",
  "high":     "#ef5350",
}

const COST_LABEL = {
  "very-low": "Very Low Cost",
  "low":      "Low Cost",
  "medium":   "Medium Cost",
  "high":     "High Cost",
}

// Distinct accent colors for card left borders (cycles if > 6 items)
const CARD_ACCENTS = ["#e07a3a", "#5c6bc0", "#26a69a", "#ef5350", "#ab47bc", "#29b6f6"]

export function Prescriptions({ items }) {
  if (!items?.length) return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      minHeight: 220, gap: 10, textAlign: "center",
    }}>
      <div style={{ fontSize: 36, opacity: 0.18 }}>🏛</div>
      <div style={{ fontSize: 13, color: "#bbb", lineHeight: 1.5 }}>
        Complete the building analysis<br />to see vernacular recommendations
      </div>
    </div>
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {items.map((p, i) => {
        const accent = CARD_ACCENTS[i % CARD_ACCENTS.length]
        const costColor = COST_COLOR[p.cost_tier] ?? "#999"
        return (
          <div key={p.technique_id} style={{
            background: "#fff",
            borderRadius: 12,
            borderTop: "1px solid #ebebeb",
            borderRight: "1px solid #ebebeb",
            borderBottom: "1px solid #ebebeb",
            borderLeft: `4px solid ${accent}`,
            padding: "14px 16px 14px 16px",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          }}>

            {/* Header row: rank + name */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 11, marginBottom: 10 }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                background: accent, color: "#fff",
                fontSize: 11, fontWeight: 800,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {i + 1}
              </div>
              <div style={{
                fontSize: 16, fontWeight: 700, color: "#111",
                lineHeight: 1.3, paddingTop: 2,
              }}>
                {p.name}
              </div>
            </div>

            {/* Rationale */}
            <div style={{
              fontSize: 13, color: "#555", lineHeight: 1.6,
              marginBottom: 14,
            }}>
              {p.rationale}
            </div>

            {/* Badges row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{
                background: "#e8f4fd",
                color: "#1565c0",
                borderRadius: 8,
                padding: "5px 14px",
                fontSize: 16,
                fontWeight: 800,
                letterSpacing: "-0.01em",
              }}>
                −{Math.abs(p.delta_temp_c)}°C
              </div>
              <div style={{
                background: `${costColor}18`,
                color: costColor,
                borderRadius: 8,
                padding: "5px 12px",
                fontSize: 11,
                fontWeight: 600,
                border: `1px solid ${costColor}33`,
              }}>
                {COST_LABEL[p.cost_tier] ?? p.cost_tier}
              </div>
            </div>

            {/* Cultural note */}
            {p.cultural_note && (
              <div style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid #f2f2f2",
                fontSize: 11,
                color: "#aaa",
                fontStyle: "italic",
                lineHeight: 1.5,
              }}>
                {p.cultural_note}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default Prescriptions
