// frontend/src/components/Viewer.jsx
// Three.js scene: mesh + heatmap colour overlay + vernacular feature rendering

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import { PLYLoader }     from "three/examples/jsm/loaders/PLYLoader"

// Map temperature → colour (blue=cool, red=hot)
function tempToColor(t, tMin = 25, tMax = 55) {
  const norm = Math.max(0, Math.min(1, (t - tMin) / (tMax - tMin)))
  const r = Math.round(norm * 255)
  const b = Math.round((1 - norm) * 255)
  return new THREE.Color(r / 255, 0, b / 255)
}

function applyHeatmap(geometry, thermalData, activeHour) {
  if (!thermalData) return
  const count    = geometry.attributes.position.count
  const colors   = geometry.attributes.color.array
  const surfaces = thermalData.surfaces ?? []
  const perVertex = Math.ceil(count / Math.max(surfaces.length, 1))
  for (let i = 0; i < count; i++) {
    const surfIdx = Math.min(Math.floor(i / perVertex), surfaces.length - 1)
    const surf    = surfaces[surfIdx]
    const temp    = surf ? surf.temp_series[activeHour] ?? 30 : 30
    const col     = tempToColor(temp)
    colors[i * 3]     = col.r
    colors[i * 3 + 1] = col.g
    colors[i * 3 + 2] = col.b
  }
  geometry.attributes.color.needsUpdate = true
}

function applyPositionHeatmap(geometry, intensity = 1) {
  const pos    = geometry.attributes.position.array
  const count  = geometry.attributes.position.count
  const colors = geometry.attributes.color.array
  for (let i = 0; i < count; i++) {
    const x    = pos[i * 3]
    const z    = pos[i * 3 + 2]
    const base = Math.max(0, Math.min(1, (Math.sin(x * 0.3) + Math.sin(z * 0.3) + 1) / 2))
    const t    = base * intensity
    colors[i * 3]     = t
    colors[i * 3 + 1] = 0.1
    colors[i * 3 + 2] = 1 - t
  }
  geometry.attributes.color.needsUpdate = true
}

function sunStateForHour(hour) {
  const isDay = hour >= 6 && hour <= 18
  const t     = (hour - 6) / 12          // 0 → sunrise, 1 → sunset
  const angle = t * Math.PI              // 0 → π arc
  return {
    isDay,
    angle,
    x: 15 * Math.cos(Math.PI - angle),   // east (+x) to west (-x)
    y: 15 * Math.sin(angle),             // rises and sets
    z: -5,
  }
}



function makeRoomLabel(name, colorHex) {
  const W = 256, H = 64
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext("2d")

  const r = 10
  ctx.fillStyle = colorHex + "cc"
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(W - r, 0)
  ctx.arcTo(W, 0, W, r, r)
  ctx.lineTo(W, H - r)
  ctx.arcTo(W, H, W - r, H, r)
  ctx.lineTo(r, H)
  ctx.arcTo(0, H, 0, H - r, r)
  ctx.lineTo(0, r)
  ctx.arcTo(0, 0, r, 0, r)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = "#ffffff"
  ctx.font = "bold 16px sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(name, W / 2, H / 2)

  const texture = new THREE.CanvasTexture(canvas)
  const mesh    = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.25),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  )
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

const Viewer = forwardRef(function Viewer({ meshUrl, activeHour, showAfter, rooms = [] }, ref) {
  const mountRef      = useRef(null)
  const sceneRef      = useRef(null)
  const meshRef       = useRef(null)
  const afterGroupRef = useRef(null)
  const sunMeshRef    = useRef(null)
  const sunLightRef   = useRef(null)
  const wireframeRef  = useRef(null)
  const roomGroupRef  = useRef(null)
  const cameraRef     = useRef(null)
  const controlsRef   = useRef(null)
  const lerpRef       = useRef(null)
  const roomMeshesRef = useRef({})

  // ── Scene setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current
    if (!el) return

    const w = el.clientWidth, h = el.clientHeight
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(w, h)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.domElement.style.display = "block"
    el.appendChild(renderer.domElement)

    const scene  = new THREE.Scene()
    scene.background = new THREE.Color(0x111111)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 1000)
    camera.position.set(0, 5, 15)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    cameraRef.current   = camera
    controlsRef.current = controls

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.4))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(5, 10, 5)
    scene.add(dir)

    // Ground grid
    scene.add(new THREE.GridHelper(50, 50, 0x333333, 0x222222))

    // Sun sphere
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffdd44 })
    )
    sunMeshRef.current = sunMesh
    scene.add(sunMesh)

    // Sun directional light
    const sunLight = new THREE.DirectionalLight(0xffeeaa, 1.5)
    sunLightRef.current = sunLight
    scene.add(sunLight)

    // Load mesh
    const loader = new PLYLoader()
    loader.load(
      meshUrl,
      (geometry) => {
        geometry.computeVertexNormals()

        const count  = geometry.attributes.position.count
        const colors = new Float32Array(count * 3)
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
        const { angle: initAngle } = sunStateForHour(activeHour)
        applyPositionHeatmap(geometry, Math.max(0, Math.sin(initAngle)))

        const mat  = new THREE.MeshPhongMaterial({ vertexColors: true })
        const mesh = new THREE.Mesh(geometry, mat)
        meshRef.current = mesh
        scene.add(mesh)

        // Wireframe overlay — architectural polygon mesh look
        const wireGeo  = new THREE.WireframeGeometry(geometry)
        const wireMat  = new THREE.LineBasicMaterial({
          color: 0xff6600, transparent: true, opacity: 0.3,
        })
        const wireLine = new THREE.LineSegments(wireGeo, wireMat)
        wireframeRef.current = wireLine
        scene.add(wireLine)

        // Centre camera on mesh
        const box = new THREE.Box3().setFromObject(mesh)
        const c   = box.getCenter(new THREE.Vector3())
        controls.target.copy(c)
        camera.position.set(c.x + 10, c.y + 12, c.z + 20)
        controls.update()
      },
      undefined,
      (err) => console.error("Mesh load error", err)
    )

    // Animation loop
    let animId
    function animate() {
      animId = requestAnimationFrame(animate)
      // Camera lerp (focus-room animation)
      const lerp = lerpRef.current
      if (lerp) {
        const t = Math.min(lerp.frame / lerp.totalFrames, 1)
        const s = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t // ease in-out
        camera.position.lerpVectors(lerp.startCam, lerp.endCam, s)
        controls.target.lerpVectors(lerp.startTarget, lerp.endTarget, s)
        lerp.frame++
        if (lerp.frame > lerp.totalFrames) lerpRef.current = null
      }
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    window.addEventListener("resize", onResize)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener("resize", onResize)
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [meshUrl])

  // ── Update heatmap colours and sun when hour changes ──────────────────────
  useEffect(() => {
    const { isDay, angle, x, y, z } = sunStateForHour(activeHour)
    const intensity = Math.max(0, Math.sin(angle))

    if (meshRef.current) {
      applyPositionHeatmap(meshRef.current.geometry, intensity)
    }

    if (sunMeshRef.current) {
      sunMeshRef.current.position.set(x, y, z)
      sunMeshRef.current.visible = isDay
    }

    if (sunLightRef.current) {
      sunLightRef.current.position.set(x, y, z)
      sunLightRef.current.intensity = isDay ? 1.5 * intensity : 0.1
    }
  }, [activeHour])

  // ── Toggle vernacular overlay ──────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current
    const mesh  = meshRef.current
    if (!scene || !mesh) return

    if (afterGroupRef.current) {
      scene.remove(afterGroupRef.current)
      afterGroupRef.current = null
    }

    if (!showAfter) return

    const box    = new THREE.Box3().setFromObject(mesh)
    const center = new THREE.Vector3()
    box.getCenter(center)
    const group  = new THREE.Group()

    // ── Terracotta brise-soleil grid on west face ───────────────────────────
    const COLS = 8, ROWS = 10
    const BOX_W = 0.15, BOX_H = 0.15, BOX_D = 0.1
    const GAP   = 0.05
    const stepZ = BOX_W + GAP   // 0.20m centre-to-centre
    const stepY = BOX_H + GAP
    const gridW = COLS * BOX_W + (COLS - 1) * GAP   // 1.55m
    const wallX = box.min.x - BOX_D / 2

    const tileMat = new THREE.MeshPhongMaterial({ color: 0xC1440E })
    const tileGeo = new THREE.BoxGeometry(BOX_D, BOX_H, BOX_W)
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const tile = new THREE.Mesh(tileGeo, tileMat)
        tile.position.set(
          wallX,
          box.min.y + BOX_H / 2 + r * stepY,
          center.z - gridW / 2 + BOX_W / 2 + c * stepZ
        )
        group.add(tile)
      }
    }

    // ── Plant spheres along the base ────────────────────────────────────────
    const plantMat = new THREE.MeshPhongMaterial({ color: 0x2d8a2d })
    const plantGeo = new THREE.SphereGeometry(0.3, 12, 12)
    for (let c = 0; c < COLS; c++) {
      const plant = new THREE.Mesh(plantGeo, plantMat)
      plant.position.set(
        wallX,
        box.min.y + 0.3,
        center.z - gridW / 2 + BOX_W / 2 + c * stepZ
      )
      group.add(plant)
    }

    // ── Semi-transparent green roof plane ───────────────────────────────────
    const size = new THREE.Vector3()
    box.getSize(size)
    const roof = new THREE.Mesh(
      new THREE.PlaneGeometry(size.x, size.z),
      new THREE.MeshPhongMaterial({
        color: 0x3a7a3a, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
      })
    )
    roof.rotation.x = -Math.PI / 2
    roof.position.set(center.x, box.max.y + 0.01, center.z)
    group.add(roof)

    scene.add(group)
    afterGroupRef.current = group
  }, [showAfter])

  // ── Room floor planes + floating labels ───────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    if (roomGroupRef.current) {
      scene.remove(roomGroupRef.current)
      roomGroupRef.current = null
    }

    if (!rooms || rooms.length === 0) return

    const group   = new THREE.Group()
    const meshMap = {}

    for (const room of rooms) {
      const bbox = room.bbox_m
      if (!bbox) continue
      const { x, z, w, d } = bbox
      const color = room.color ?? "#666666"
      const label = room.id ?? room.type ?? "room"

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
        })
      )
      floor.rotation.x = -Math.PI / 2
      floor.position.set(x + w / 2, 0.02, z + d / 2)
      group.add(floor)
      meshMap[room.id] = floor

      const labelMesh = makeRoomLabel(label, color)
      labelMesh.position.set(x + w / 2, 0.08, z + d / 2)
      group.add(labelMesh)
    }

    scene.add(group)
    roomGroupRef.current  = group
    roomMeshesRef.current = meshMap
  }, [rooms])

  // ── Expose focusRoom / pulseRoom to parent via ref ────────────────────────
  useImperativeHandle(ref, () => ({
    focusRoom(centroid) {
      if (!cameraRef.current || !controlsRef.current) return
      const [cx, cy, cz] = centroid ?? [0, 0, 0]
      lerpRef.current = {
        startCam:    cameraRef.current.position.clone(),
        startTarget: controlsRef.current.target.clone(),
        endCam:      new THREE.Vector3(cx + 4, cy + 5, cz + 8),
        endTarget:   new THREE.Vector3(cx, cy, cz),
        frame: 0, totalFrames: 60,
      }
    },
    pulseRoom(roomId) {
      const mesh = roomMeshesRef.current[roomId]
      if (!mesh) return
      let t = 0
      const iv = setInterval(() => {
        t++
        mesh.material.opacity = 0.35 + 0.55 * Math.abs(Math.sin(t * 0.18))
        if (t > 70) { clearInterval(iv); mesh.material.opacity = 0.35 }
      }, 25)
    },
  }), [])

  return (
    <div ref={mountRef} style={{ width: "100%", height: "100%", position: "relative", touchAction: "none" }}>
      {/* Heatmap legend */}
      <div style={{
        position: "absolute", top: 16, right: 16,
        background: "rgba(0,0,0,0.6)", borderRadius: 8, padding: "10px 14px",
        fontSize: 11, color: "#fff",
      }}>
        <div style={{ marginBottom: 4, fontWeight: 500 }}>Surface temp</div>
        <div style={{
          width: 20, height: 100,
          background: "linear-gradient(to bottom, #ff0000, #0000ff)",
          borderRadius: 4, margin: "4px auto",
        }} />
        <div>55°C</div>
        <div style={{ marginTop: 78 }}>25°C</div>
      </div>
    </div>
  )
})

export default Viewer
