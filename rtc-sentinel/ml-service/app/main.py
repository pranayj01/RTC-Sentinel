from fastapi import FastAPI

from app.ml_model import get_quality_model
from app.quality import QualityFeatures, QualityPrediction

app = FastAPI(title="RTC Sentinel Analytics Service", version="0.8.5")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/predict-quality", response_model=QualityPrediction)
async def quality_prediction(features: QualityFeatures) -> QualityPrediction:
    return get_quality_model().predict(features)


@app.get("/model/info")
async def model_info() -> dict[str, object]:
    return get_quality_model().info()
