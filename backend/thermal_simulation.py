"""
thermal_simulation.py
---------------------
24-hour time-series thermal simulation.

Physics model per surface per hour:
  ΔT = (solar_gain - convective_loss - thermal_mass_buffer) / thermal_mass

Solar gain:    Q_solar = irradiance × area × (1 - albedo) × cos(incidence_angle)
Convective:    Q_conv  = U × area × (T_surface - T_ambient)
Thermal mass:  acts as a low-pass filter — high mass surfaces heat/cool slowly

Result: time-indexed temperature array cached for instant scrubbing.
"""

import math
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
from pysolar.solar import get_altitude, get_azimuth

logger = logging.getLogger(__name__)

HOURS = list(range(24))
STEFAN_BOLTZMANN = 5.67e-8   # W/m²K⁴


@dataclass
class SolarPosition:
    hour: int
    altitude_deg: float    # above horizon
    azimuth_deg: float     # compass bearing
    irradiance: float      # W/m² (simplified)

    @property
    def altitude_rad(self) -> float:
        return math.radians(self.altitude_deg)

    @property
    def direction_vector(self) -> np.ndarray:
        """Unit vector pointing FROM sun TO scene (for ray casting)."""
        az  = math.radians(self.azimuth_deg)
        alt = self.altitude_rad
        return np.array([
            -math.cos(alt) * math.sin(az),
            -math.sin(alt),
            -math.cos(alt) * math.cos(az),
        ])


@dataclass
class ClimateData:
    ambient_temp_c: list[float]     # hourly ambient °C
    humidity_pct: float
    wind_speed_ms: float


@dataclass
class SurfaceThermalState:
    surface_id: int
    material: str
    area_m2: float
    u_value: float                  # W/m²K
    albedo: float
    thermal_mass: float             # J/m²K  (mass × specific_heat)
    temp_series: list[float] = field(default_factory=list)   # °C per hour


@dataclass
class ThermalSimulationResult:
    surface_states: list[SurfaceThermalState]
    solar_positions: list[SolarPosition]
    climate: ClimateData
    peak_temp_by_surface: dict[int, float]
    worst_surface_id: int
    hours: list[int] = field(default_factory=lambda: list(range(24)))


# ── Solar positions ───────────────────────────────────────────────────────────

def compute_solar_positions(lat: float, lon: float,
                             date: datetime) -> list[SolarPosition]:
    """
    Compute sun altitude and azimuth for every hour of the given date.
    Uses pysolar for accurate ephemeris data.
    """
    positions = []
    for hour in HOURS:
        dt = date.replace(hour=hour, minute=30, tzinfo=timezone.utc)
        altitude = get_altitude(lat, lon, dt)
        azimuth  = get_azimuth(lat, lon, dt)

        # Simple clear-sky irradiance model
        if altitude > 0:
            irradiance = 1000 * math.sin(math.radians(altitude))
        else:
            irradiance = 0.0

        positions.append(SolarPosition(
            hour=hour,
            altitude_deg=altitude,
            azimuth_deg=azimuth,
            irradiance=irradiance,
        ))

    return positions


# ── Climate defaults by geographic region ────────────────────────────────────

def get_climate_defaults(lat: float, lon: float) -> ClimateData:
    abs_lat = abs(lat)
    if abs_lat < 23:
        t_mean, rh, ws = 32.0, 80.0, 2.0       # tropical
    elif abs_lat < 35:
        t_mean, rh, ws = 36.0, 45.0, 3.0       # subtropical
    elif abs_lat < 50:
        t_mean, rh, ws = 22.0, 60.0, 3.5       # temperate
    else:
        t_mean, rh, ws = 8.0, 70.0, 5.0        # cold

    diurnal = [t_mean + 7 * math.sin(math.pi * (h - 6) / 12) for h in HOURS]
    return ClimateData(ambient_temp_c=diurnal, humidity_pct=rh, wind_speed_ms=ws)


# ── Ray casting (solar incidence per surface) ─────────────────────────────────

def compute_solar_incidence(surface_normals: np.ndarray,
                             sun_direction: np.ndarray) -> np.ndarray:
    """
    For each surface normal, compute cos(incidence_angle) with sun direction.
    Returns array of values 0–1. Negative = surface faces away from sun.
    sun_direction: unit vector pointing FROM sun TOWARD scene.
    """
    # Flip sun direction to get vector FROM surface TO sun
    to_sun = -sun_direction / (np.linalg.norm(sun_direction) + 1e-8)
    dots   = surface_normals @ to_sun
    return np.clip(dots, 0, 1)


# ── Core simulation loop ──────────────────────────────────────────────────────

def run_thermal_simulation(
    surfaces: list[dict],           # list of surface dicts from surface_tagger
    surface_normals: np.ndarray,    # (N, 3) unit normals
    lat: float,
    lon: float,
    date: datetime,
) -> ThermalSimulationResult:
    """
    Main 24-hour simulation loop.

    For each hour h:
      For each surface i:
        solar_gain_i  = irradiance_h × cos(incidence_i_h) × area_i × (1 - albedo_i)
        conv_loss_i   = U_i × area_i × (T_i[h] - T_ambient[h])
        dT_i          = (solar_gain_i - conv_loss_i) / thermal_mass_i
        T_i[h+1]      = T_i[h] + dT_i

    Results cached as time-indexed arrays — scrub without recompute.
    """
    solar_positions = compute_solar_positions(lat, lon, date)
    climate         = get_climate_defaults(lat, lon)

    from surface_tagger import MATERIAL_PROPERTIES, DEFAULT_MATERIAL

    # Initialise surface states
    states: list[SurfaceThermalState] = []
    for i, surf in enumerate(surfaces):
        mat   = surf.get("material", DEFAULT_MATERIAL)
        props = MATERIAL_PROPERTIES.get(mat, MATERIAL_PROPERTIES[DEFAULT_MATERIAL])
        area  = surf.get("area_m2", 10.0)

        states.append(SurfaceThermalState(
            surface_id=i,
            material=mat,
            area_m2=area,
            u_value=props["u_value"],
            albedo=props["albedo"],
            thermal_mass=props["mass"] * 840,  # specific heat ≈ 840 J/kgK for masonry
            temp_series=[climate.ambient_temp_c[0]],   # start at ambient
        ))

    # Simulation loop
    for hour in range(23):
        sol  = solar_positions[hour]
        t_amb = climate.ambient_temp_c[hour]

        incidence = compute_solar_incidence(surface_normals, sol.direction_vector)

        for i, state in enumerate(states):
            t_current = state.temp_series[-1]
            cos_inc   = float(incidence[i]) if i < len(incidence) else 0.0

            solar_gain = (
                sol.irradiance * cos_inc * state.area_m2 * (1 - state.albedo)
            )
            conv_loss = state.u_value * state.area_m2 * (t_current - t_amb)

            # Thermal mass dampens rate of change
            dT = (solar_gain - conv_loss) / max(state.thermal_mass * state.area_m2, 1)
            dT = max(-5, min(5, dT))   # cap at ±5°C/hr for stability

            state.temp_series.append(t_current + dT)

    # Peak temperatures
    peak = {s.surface_id: max(s.temp_series) for s in states}
    worst = max(peak, key=peak.get)

    return ThermalSimulationResult(
        surface_states=states,
        solar_positions=solar_positions,
        climate=climate,
        peak_temp_by_surface=peak,
        worst_surface_id=worst,
    )


def simulation_to_json(result: ThermalSimulationResult) -> dict:
    """Serialise result to JSON-safe dict for API response."""
    return {
        "hours": result.hours,
        "surfaces": [
            {
                "id": s.surface_id,
                "material": s.material,
                "temp_series": [round(t, 2) for t in s.temp_series],
                "peak_temp": round(result.peak_temp_by_surface[s.surface_id], 2),
                "is_worst": s.surface_id == result.worst_surface_id,
            }
            for s in result.surface_states
        ],
        "climate": {
            "ambient_series": [round(t, 2) for t in result.climate.ambient_temp_c],
            "humidity_pct": result.climate.humidity_pct,
            "wind_speed_ms": result.climate.wind_speed_ms,
        },
        "solar": [
            {
                "hour": sp.hour,
                "altitude_deg": round(sp.altitude_deg, 2),
                "azimuth_deg": round(sp.azimuth_deg, 2),
                "irradiance": round(sp.irradiance, 1),
            }
            for sp in result.solar_positions
        ],
    }
