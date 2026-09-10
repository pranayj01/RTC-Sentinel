from fastapi import FastAPI

from app.quality import QualityFeatures, QualityPrediction, predict_quality

app = FastAPI(title="RTC Sentinel Analytics Service", version="0.8.0")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/predict-quality", response_model=QualityPrediction)
async def quality_prediction(features: QualityFeatures) -> QualityPrediction:
    return predict_quality(features)


@app.get("/model/info")
async def model_info() -> dict[str, str | list[str]]:
    return {
        "name": "rtc-sentinel-quality-baseline",
        "version": "1.0.0",
        "type": "deterministic-baseline",
        "features": ["rtt", "jitter", "packetLoss", "bitrate"],
        "labels": ["excellent", "good", "fair", "poor", "critical"],
    }
