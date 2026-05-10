"""
ventilation_graph.py
--------------------
Models room airflow as a weighted directed graph.

  Nodes  : rooms (identified from mesh segmentation or user input)
  Edges  : openings between rooms (doors, windows, jali screens)
  Weights: cross-sectional area × wind_alignment_factor

Algorithms:
  - Max-flow (Ford-Fulkerson via NetworkX)     → total ventilation capacity
  - Dijkstra shortest path to exterior         → dead zone detection
  - Air changes per hour (ACH) per room

Dead zones: rooms with no viable path to an exterior opening.
These become primary targets for vernacular interventions.
"""

import math
import logging
from dataclasses import dataclass, field

import networkx as nx
import numpy as np

logger = logging.getLogger(__name__)

EXTERIOR_NODE = "__exterior__"


@dataclass
class Room:
    id: str
    volume_m3: float
    is_exterior: bool = False
    centroid: np.ndarray = field(default_factory=lambda: np.zeros(3))


@dataclass
class Opening:
    from_room: str
    to_room: str
    area_m2: float
    normal: np.ndarray              # direction air flows through
    opening_type: str = "door"      # door | window | jali | gap


@dataclass
class VentilationResult:
    graph: nx.DiGraph
    ach_per_room: dict[str, float]          # air changes per hour
    dead_zones: list[str]                   # room IDs with no exterior path
    max_flow_value: float                   # total airflow capacity m³/s
    shortest_paths: dict[str, list[str]]    # room → path to exterior
    room_scores: dict[str, float]           # 0 (dead) → 1 (well ventilated)


class VentilationGraph:

    def __init__(self, wind_direction_deg: float = 270.0,
                 wind_speed_ms: float = 2.0):
        """
        wind_direction_deg: compass bearing wind is blowing FROM (270 = westerly)
        wind_speed_ms: mean wind speed
        """
        self.wind_dir_rad = math.radians(wind_direction_deg)
        self.wind_speed   = wind_speed_ms
        self.G = nx.DiGraph()

        # Add exterior as a super-node (infinite supply/sink)
        self.G.add_node(EXTERIOR_NODE, volume=1e9, is_exterior=True)

    def add_room(self, room: Room) -> None:
        self.G.add_node(room.id,
                        volume=room.volume_m3,
                        is_exterior=room.is_exterior,
                        centroid=room.centroid.tolist())

    def add_opening(self, opening: Opening) -> None:
        """
        Edge weight = effective airflow capacity (m³/s).
        Q = Cd × A × v_effective
        where v_effective = wind_speed × cos(angle between wind and opening normal)
        Cd ≈ 0.6 (discharge coefficient for sharp-edged openings)
        """
        Cd = 0.61

        # Wind vector (horizontal)
        wind_vec = np.array([
            math.cos(self.wind_dir_rad),
            0.0,
            math.sin(self.wind_dir_rad),
        ])

        # Alignment: how well does wind push through this opening?
        opening_normal_h = opening.normal.copy()
        opening_normal_h[1] = 0
        norm = np.linalg.norm(opening_normal_h)
        if norm > 1e-6:
            opening_normal_h /= norm

        alignment = float(np.dot(wind_vec, opening_normal_h))
        v_eff     = self.wind_speed * max(alignment, 0.0)
        capacity  = Cd * opening.area_m2 * v_eff

        # Add bidirectional edges with capacity
        self.G.add_edge(opening.from_room, opening.to_room,
                        capacity=capacity,
                        area=opening.area_m2,
                        opening_type=opening.opening_type,
                        alignment=alignment)
        self.G.add_edge(opening.to_room, opening.from_room,
                        capacity=capacity * 0.5,   # return flow reduced
                        area=opening.area_m2,
                        opening_type=opening.opening_type,
                        alignment=alignment)

    def connect_exterior_openings(self, exterior_openings: list[Opening]) -> None:
        """Connect rooms with exterior-facing windows/doors to the exterior node."""
        for op in exterior_openings:
            Cd        = 0.61
            wind_vec  = np.array([math.cos(self.wind_dir_rad), 0, math.sin(self.wind_dir_rad)])
            alignment = max(float(np.dot(wind_vec, op.normal)), 0.0)
            capacity  = Cd * op.area_m2 * self.wind_speed * alignment

            self.G.add_edge(EXTERIOR_NODE, op.from_room,
                            capacity=capacity,
                            area=op.area_m2,
                            opening_type=op.opening_type)
            self.G.add_edge(op.from_room, EXTERIOR_NODE,
                            capacity=capacity,
                            area=op.area_m2,
                            opening_type=op.opening_type)

    def analyse(self) -> VentilationResult:
        """
        Run max-flow and Dijkstra, compute ACH, identify dead zones.
        """
        rooms = [n for n in self.G.nodes if n != EXTERIOR_NODE]

        # ── Max-flow (Ford-Fulkerson) ─────────────────────────────────────────
        # Total ventilation capacity of the building
        try:
            flow_value, _ = nx.maximum_flow(
                self.G, EXTERIOR_NODE, rooms[0] if rooms else EXTERIOR_NODE,
                capacity="capacity",
                flow_func=nx.algorithms.flow.shortest_augmenting_path,
            )
        except Exception:
            flow_value = 0.0

        # ── Dijkstra: shortest path from each room to exterior ────────────────
        # Weight = 1 / capacity (higher capacity = shorter effective distance)
        weighted = self.G.copy()
        for u, v, data in weighted.edges(data=True):
            cap = data.get("capacity", 0.001)
            weighted[u][v]["distance"] = 1.0 / max(cap, 0.001)

        shortest_paths: dict[str, list[str]] = {}
        dead_zones: list[str] = []

        for room in rooms:
            try:
                path = nx.dijkstra_path(weighted, room, EXTERIOR_NODE,
                                        weight="distance")
                shortest_paths[room] = path
            except nx.NetworkXNoPath:
                dead_zones.append(room)
                shortest_paths[room] = []

        # ── ACH per room ──────────────────────────────────────────────────────
        ach_per_room: dict[str, float] = {}
        for room in rooms:
            volume = self.G.nodes[room].get("volume", 50.0)
            # Sum inflow capacity from all neighbours
            inflow = sum(
                data.get("capacity", 0.0)
                for _, _, data in self.G.in_edges(room, data=True)
            )
            # ACH = (m³/s × 3600) / volume_m³
            ach_per_room[room] = (inflow * 3600) / max(volume, 1.0)

        # ── Ventilation score 0–1 ─────────────────────────────────────────────
        max_ach = max(ach_per_room.values(), default=1.0)
        room_scores = {
            r: ach_per_room.get(r, 0.0) / max(max_ach, 0.001)
            for r in rooms
        }
        for dz in dead_zones:
            room_scores[dz] = 0.0

        logger.info(
            f"Ventilation analysis: {len(dead_zones)} dead zones / "
            f"{len(rooms)} rooms · max-flow = {flow_value:.3f} m³/s"
        )

        return VentilationResult(
            graph=self.G,
            ach_per_room=ach_per_room,
            dead_zones=dead_zones,
            max_flow_value=flow_value,
            shortest_paths=shortest_paths,
            room_scores=room_scores,
        )


def ventilation_to_json(result: VentilationResult) -> dict:
    rooms = [n for n in result.graph.nodes if n != EXTERIOR_NODE]
    return {
        "max_flow_m3s": round(result.max_flow_value, 4),
        "dead_zones": result.dead_zones,
        "rooms": [
            {
                "id": r,
                "ach": round(result.ach_per_room.get(r, 0), 2),
                "score": round(result.room_scores.get(r, 0), 3),
                "is_dead_zone": r in result.dead_zones,
                "path_to_exterior": result.shortest_paths.get(r, []),
            }
            for r in rooms
        ],
        "edges": [
            {
                "from": u, "to": v,
                "capacity": round(d.get("capacity", 0), 4),
                "opening_type": d.get("opening_type", "unknown"),
            }
            for u, v, d in result.graph.edges(data=True)
            if u != EXTERIOR_NODE and v != EXTERIOR_NODE
        ],
    }


# ── Quick demo builder ────────────────────────────────────────────────────────

def build_example_graph() -> VentilationGraph:
    """
    Example: 3-room apartment (living, bedroom, kitchen)
    with exterior windows in living and kitchen only.
    Bedroom is a potential dead zone depending on door size.
    """
    vg = VentilationGraph(wind_direction_deg=270, wind_speed_ms=3.0)

    vg.add_room(Room("living",   volume_m3=45, centroid=np.array([0,  1.2, 0])))
    vg.add_room(Room("bedroom",  volume_m3=20, centroid=np.array([5,  1.2, 0])))
    vg.add_room(Room("kitchen",  volume_m3=15, centroid=np.array([0,  1.2, 6])))

    # Interior doors
    vg.add_opening(Opening("living", "bedroom", area_m2=1.8,
                            normal=np.array([1, 0, 0]), opening_type="door"))
    vg.add_opening(Opening("living", "kitchen", area_m2=1.8,
                            normal=np.array([0, 0, 1]), opening_type="door"))

    # Exterior windows
    vg.connect_exterior_openings([
        Opening("living",  "__exterior__", area_m2=1.5,
                normal=np.array([-1, 0, 0]), opening_type="window"),
        Opening("kitchen", "__exterior__", area_m2=0.8,
                normal=np.array([0, 0, -1]), opening_type="window"),
    ])

    return vg
