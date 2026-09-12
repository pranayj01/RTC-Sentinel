import base64

import numpy as np
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def pcm_payload(samples: np.ndarray, sample_rate: int = 16_000) -> dict[str, str | int]:
    pcm = np.clip(samples, -1, 1)
    encoded = (pcm * 32_767).astype("<i2").tobytes()
    return {
        "encoding": "pcm_s16le",
        "sampleRate": sample_rate,
        "pcmBase64": base64.b64encode(encoded).decode("ascii"),
    }


def test_analyzes_silence_and_returns_audio_features() -> None:
    response = client.post("/analyze-audio", json=pcm_payload(np.zeros(8_000)))

    assert response.status_code == 200
    result = response.json()
    assert result["label"] == "silence"
    assert 0 <= result["confidence"] <= 1
    assert result["durationMs"] == 500
    assert result["features"]["rmsEnergy"] == 0
    assert len(result["features"]["mfcc"]) == 13
    assert len(result["features"]["melSpectrogram"]) == 16


def test_resamples_browser_audio_without_changing_reported_duration() -> None:
    response = client.post(
        "/analyze-audio",
        json=pcm_payload(np.zeros(16_384), sample_rate=48_000),
    )

    assert response.status_code == 200
    result = response.json()
    assert result["label"] == "silence"
    assert result["durationMs"] == 341.33


def test_rejects_invalid_or_undersized_pcm() -> None:
    invalid = client.post(
        "/analyze-audio",
        json={"sampleRate": 16_000, "pcmBase64": "not base64"},
    )
    assert invalid.status_code == 422

    too_short = client.post(
        "/analyze-audio",
        json=pcm_payload(np.zeros(100)),
    )
    assert too_short.status_code == 422


def test_reports_audio_model_information() -> None:
    response = client.get("/audio/model/info")

    assert response.status_code == 200
    info = response.json()
    assert info["name"] == "rtc-sentinel-audio-classifier"
    assert info["type"] == "machine-learning"
    assert info["labels"] == ["speech", "silence", "noise"]
    assert info["algorithm"] in {"logistic-regression", "random-forest"}
    assert 0 <= info["metrics"]["f1Macro"] <= 1
    assert len(info["metrics"]["confusionMatrix"]) == 3
