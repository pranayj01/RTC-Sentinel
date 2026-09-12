import base64
import binascii
from typing import Annotated, Literal

import numpy as np
from pydantic import BaseModel, Field, field_validator

AudioLabel = Literal["speech", "silence", "noise"]


class AudioChunk(BaseModel):
    encoding: Literal["pcm_s16le"] = "pcm_s16le"
    sampleRate: Annotated[int, Field(strict=True, ge=8_000, le=96_000)]
    pcmBase64: Annotated[str, Field(strict=True, min_length=1, max_length=50_000)]

    @field_validator("pcmBase64")
    @classmethod
    def valid_pcm(cls, value: str) -> str:
        try:
            decoded = base64.b64decode(value, validate=True)
        except (ValueError, binascii.Error) as error:
            raise ValueError("pcmBase64 must be valid base64") from error
        if len(decoded) < 4_096 or len(decoded) > 32_768 or len(decoded) % 2 != 0:
            raise ValueError("PCM must contain between 2048 and 16384 signed 16-bit samples")
        return value

    def samples(self) -> np.ndarray:
        raw = base64.b64decode(self.pcmBase64, validate=True)
        return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32_768.0


class AudioFeatures(BaseModel):
    rmsEnergy: float
    zeroCrossingRate: float
    spectralCentroidHz: float
    mfcc: list[float]
    melSpectrogram: list[float]


class AudioPrediction(BaseModel):
    label: AudioLabel
    confidence: Annotated[float, Field(ge=0, le=1)]
    durationMs: float
    features: AudioFeatures
