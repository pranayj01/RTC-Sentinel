from typing import Annotated, Literal

from pydantic import BaseModel, Field

QualityLabel = Literal["excellent", "good", "fair", "poor", "critical"]


class QualityFeatures(BaseModel):
    rtt: Annotated[float, Field(strict=True, ge=0)]
    jitter: Annotated[float, Field(strict=True, ge=0)]
    packetLoss: Annotated[float, Field(strict=True, ge=0, le=100)]
    bitrate: Annotated[float, Field(strict=True, ge=0)]


class QualityPrediction(BaseModel):
    quality: QualityLabel
    confidence: float = Field(ge=0, le=1)


def _upper_bound_tier(value: float, bounds: tuple[float, ...]) -> int:
    return next((index for index, bound in enumerate(bounds) if value < bound), 4)


def _bitrate_tier(bitrate: float) -> int:
    if bitrate >= 32_000:
        return 0
    if bitrate >= 24_000:
        return 1
    if bitrate >= 16_000:
        return 2
    if bitrate >= 8_000:
        return 3
    return 4


def predict_quality(features: QualityFeatures) -> QualityPrediction:
    tiers = (
        _upper_bound_tier(features.rtt, (150, 250, 400, 800)),
        _upper_bound_tier(features.jitter, (20, 40, 70, 120)),
        _upper_bound_tier(features.packetLoss, (1, 2.5, 5, 10)),
        _bitrate_tier(features.bitrate),
    )
    labels: tuple[QualityLabel, ...] = ("excellent", "good", "fair", "poor", "critical")
    return QualityPrediction(quality=labels[max(tiers)], confidence=1.0)
