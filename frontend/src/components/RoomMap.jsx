const W = 620, H = 400, PAD = 24

// Fixed ground-floor layout. Coordinates are fractions of the canvas interior.
const ROOMS = [
  {
    id: "living",   label: "Living Room", heat: 0.55,
    x: 0,    y: 0,    w: 0.60, h: 0.54,
    wins: [{ edge: "left", p: 0.40, l: 0.32 }],
  },
  {
    id: "kitchen",  label: "Kitchen",     heat: 0.88,
    x: 0.60, y: 0,    w: 0.40, h: 0.54,
    wins: [{ edge: "top",  p: 0.50, l: 0.45 }],
  },
  {
    id: "bathroom", label: "Bathroom",    heat: 0.40,
    x: 0,    y: 0.54, w: 0.22, h: 0.46,
    wins: [],
  },
  {
    id: "bedroom",  label: "Bedroom",     heat: 0.28,
    x: 0.22, y: 0.54, w: 0.38, h: 0.46,
    wins: [{ edge: "bottom", p: 0.50, l: 0.45 }],
  },
  {
    id: "bedroom2", label: "Bedroom 2",   heat: 0.33,
    x: 0.60, y: 0.54, w: 0.40, h: 0.46,
    wins: [{ edge: "right",  p: 0.45, l: 0.38 }],
  },
]

function heatColor(s) {
  const r = Math.round(220 * s + 20)
  const g = Math.round(70  * (1 - Math.abs(s * 2 - 1)) + 10)
  const b = Math.round(200 * (1 - s) + 20)
  return `rgb(${r},${g},${b})`
}

// Returns {x, y, w, h} in absolute SVG pixels for a window notch on a room edge.
function winRect(rx, ry, rw, rh, { edge, p, l }) {
  const T = 5
  if (edge === "left")   return { x: rx,          y: ry + p * rh - l * rh / 2, w: T,      h: l * rh }
  if (edge === "right")  return { x: rx + rw - T, y: ry + p * rh - l * rh / 2, w: T,      h: l * rh }
  if (edge === "top")    return { x: rx + p * rw - l * rw / 2, y: ry,           w: l * rw, h: T }
  /* bottom */           return { x: rx + p * rw - l * rw / 2, y: ry + rh - T,  w: l * rw, h: T }
}

export default function RoomMap({ onView3D }) {
  const CW = W - 2 * PAD
  const CH = H - 2 * PAD

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100vh", background: "#0f0f0f",
      color: "#e0e0e0", fontFamily: "sans-serif", gap: 14, padding: 20,
    }}>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ margin: 0, color: "#e07a3a", fontSize: 20 }}>Floor Plan — Heat Map</h2>
        <p style={{ margin: "4px 0 0", opacity: 0.5, fontSize: 12 }}>
          Simulated surface temperatures · peak solar noon · ground floor
        </p>
      </div>

      <svg width={W} height={H} style={{ borderRadius: 8, border: "1px solid #2a2a2a" }}>
        <rect width={W} height={H} fill="#161616" />

        {ROOMS.map(room => {
          const rx = PAD + room.x * CW
          const ry = PAD + room.y * CH
          const rw = room.w * CW
          const rh = room.h * CH
          const col  = heatColor(room.heat)
          const peak = Math.round(room.heat * 28 + 26)

          return (
            <g key={room.id}>
              <rect x={rx} y={ry} width={rw} height={rh}
                fill={col} fillOpacity={0.55} stroke="#777" strokeWidth={1} />

              <text x={rx + rw / 2} y={ry + rh / 2 - 7}
                textAnchor="middle" dominantBaseline="auto"
                fill="#fff" fontSize={11} fontWeight={600}>
                {room.label}
              </text>
              <text x={rx + rw / 2} y={ry + rh / 2 + 10}
                textAnchor="middle" dominantBaseline="auto"
                fill="#fff" fontSize={10} opacity={0.72}>
                {peak}°C peak
              </text>

              {room.wins.map((w, i) => {
                const r = winRect(rx, ry, rw, rh, w)
                return <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h}
                  fill="#ffdd44" opacity={0.95} />
              })}
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", gap: 20, fontSize: 11, opacity: 0.65 }}>
        {[{ s: 0.88, label: "Hot" }, { s: 0.55, label: "Warm" }, { s: 0.28, label: "Cool" }].map(
          ({ s, label }) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 12, height: 12, borderRadius: 2,
                             background: heatColor(s), display: "inline-block" }} />
              {label}
            </span>
          )
        )}
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 12, height: 6, background: "#ffdd44", display: "inline-block" }} />
          Windows
        </span>
      </div>

      <button
        onClick={onView3D}
        style={{
          padding: "12px 32px", borderRadius: 8, border: "none",
          background: "#e07a3a", color: "#fff",
          fontWeight: 600, fontSize: 14, cursor: "pointer",
        }}>
        View 3D Model →
      </button>
    </div>
  )
}
