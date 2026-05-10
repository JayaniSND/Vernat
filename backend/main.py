"""
Vernat — FastAPI backend
"""

from contextlib import asynccontextmanager

import cv2
import open3d
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from routers import reconstruction, thermal, ventilation, prescription, materials

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    cv2.getBuildInformation()
    _ = open3d.geometry.TriangleMesh()
    yield


app = FastAPI(
    title="Vernat API",
    description="Urban heat mitigation via vernacular architecture + AI",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(reconstruction.router, prefix="/api/reconstruction", tags=["reconstruction"])
app.include_router(thermal.router,        prefix="/api/thermal",        tags=["thermal"])
app.include_router(ventilation.router,    prefix="/api/ventilation",    tags=["ventilation"])
app.include_router(prescription.router,   prefix="/api/prescription",   tags=["prescription"])
app.include_router(materials.router,      prefix="/api",                tags=["materials"])


@app.get("/")
def root():
    return {"status": "ok", "project": "Vernat"}
