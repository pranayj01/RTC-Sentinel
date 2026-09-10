import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.mark.parametrize(
    ("payload", "quality"),
    [
        ({"rtt": 80, "jitter": 10, "packetLoss": 0.5, "bitrate": 48_000}, "excellent"),
        ({"rtt": 220, "jitter": 30, "packetLoss": 2, "bitrate": 28_000}, "good"),
        ({"rtt": 350, "jitter": 60, "packetLoss": 4, "bitrate": 18_000}, "fair"),
        ({"rtt": 700, "jitter": 100, "packetLoss": 8, "bitrate": 10_000}, "poor"),
        ({"rtt": 900, "jitter": 130, "packetLoss": 12, "bitrate": 6_000}, "critical"),
    ],
)
def test_predicts_quality(payload: dict[str, float], quality: str) -> None:
    response = client.post("/predict-quality", json=payload)
    assert response.status_code == 200
    assert response.json()["quality"] == quality
    assert 0 <= response.json()["confidence"] <= 1


def test_rejects_missing_input() -> None:
    response = client.post(
        "/predict-quality",
        json={"rtt": 80, "jitter": 10, "packetLoss": 0.5},
    )
    assert response.status_code == 422


def test_rejects_incorrect_types() -> None:
    response = client.post(
        "/predict-quality",
        json={"rtt": "fast", "jitter": 10, "packetLoss": 0.5, "bitrate": 48_000},
    )
    assert response.status_code == 422


def test_reports_model_information() -> None:
    response = client.get("/model/info")
    assert response.status_code == 200
    assert response.json() == {
        "name": "rtc-sentinel-quality-baseline",
        "version": "1.0.0",
        "type": "deterministic-baseline",
        "features": ["rtt", "jitter", "packetLoss", "bitrate"],
        "labels": ["excellent", "good", "fair", "poor", "critical"],
    }
