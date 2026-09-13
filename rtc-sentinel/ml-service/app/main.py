from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.audio import AudioChunk, AudioPrediction
from app.audio_model import get_audio_model
from app.ml_model import get_quality_model
from app.quality import QualityFeatures, QualityPrediction


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    get_audio_model().warm()
    yield


app = FastAPI(
    title="RTC Sentinel Analytics Service",
    version="0.9.5",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/predict-quality", response_model=QualityPrediction)
async def quality_prediction(features: QualityFeatures) -> QualityPrediction:
    return get_quality_model().predict(features)


@app.get("/model/info")
async def model_info() -> dict[str, object]:
    return get_quality_model().info()


@app.post("/analyze-audio", response_model=AudioPrediction)
async def audio_analysis(chunk: AudioChunk) -> AudioPrediction:
    return get_audio_model().predict(chunk)


@app.get("/audio/model/info")
async def audio_model_info() -> dict[str, object]:
    return get_audio_model().info()
