from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from app.quality import QualityFeatures, QualityPrediction, rule_based_quality_values

FEATURE_NAMES = ("rtt", "jitter", "packetLoss", "bitrate", "audioLevel")
LABELS = ("excellent", "good", "fair", "poor", "critical")
MODEL_PATH = Path(__file__).parent / "artifacts" / "quality_model.joblib"

TIER_RANGES = (
    ((30, 149.9), (150, 249.9), (250, 399.9), (400, 799.9), (800, 1_200)),
    ((1, 19.9), (20, 39.9), (40, 69.9), (70, 119.9), (120, 180)),
    ((0, 0.99), (1, 2.49), (2.5, 4.99), (5, 9.99), (10, 20)),
    ((32_000, 64_000), (24_000, 31_999), (16_000, 23_999), (8_000, 15_999), (1_000, 7_999)),
)


def generate_training_data(
    samples_per_class: int = 120, random_state: int = 42
) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(random_state)
    rows: list[list[float]] = []
    labels: list[str] = []
    for target_tier, label in enumerate(LABELS):
        for _ in range(samples_per_class):
            tiers = rng.integers(0, target_tier + 1, size=4)
            tiers[rng.integers(0, 4)] = target_tier
            measurements = [
                float(rng.uniform(*TIER_RANGES[index][tier])) for index, tier in enumerate(tiers)
            ]
            rows.append([*measurements, float(rng.uniform(0, 1))])
            labels.append(label)
    order = rng.permutation(len(rows))
    return np.asarray(rows, dtype=float)[order], np.asarray(labels)[order]


def _metrics(expected: np.ndarray, predicted: np.ndarray) -> dict[str, Any]:
    return {
        "accuracy": round(float(accuracy_score(expected, predicted)), 4),
        "precisionMacro": round(
            float(precision_score(expected, predicted, average="macro", zero_division=0)), 4
        ),
        "recallMacro": round(
            float(recall_score(expected, predicted, average="macro", zero_division=0)), 4
        ),
        "f1Macro": round(float(f1_score(expected, predicted, average="macro", zero_division=0)), 4),
        "confusionMatrix": confusion_matrix(expected, predicted, labels=LABELS).tolist(),
    }


def train_model_bundle(samples_per_class: int = 120, random_state: int = 42) -> dict[str, Any]:
    features, labels = generate_training_data(samples_per_class, random_state)
    train_features, test_features, train_labels, test_labels = train_test_split(
        features,
        labels,
        test_size=0.25,
        random_state=random_state,
        stratify=labels,
    )
    candidates = {
        "logistic-regression": make_pipeline(
            StandardScaler(),
            LogisticRegression(max_iter=500, random_state=random_state),
        ),
        "random-forest": RandomForestClassifier(
            n_estimators=80,
            max_depth=12,
            random_state=random_state,
            n_jobs=1,
        ),
        "gradient-boosting": GradientBoostingClassifier(
            n_estimators=60,
            random_state=random_state,
        ),
    }
    evaluations: dict[str, dict[str, Any]] = {}
    for name, candidate in candidates.items():
        candidate.fit(train_features, train_labels)
        evaluations[name] = _metrics(test_labels, candidate.predict(test_features))

    selected_name = max(
        candidates,
        key=lambda name: (evaluations[name]["f1Macro"], evaluations[name]["accuracy"], name),
    )
    baseline_predictions = np.asarray(
        [rule_based_quality_values(*row[:4]) for row in test_features],
    )
    metadata = {
        "name": "rtc-sentinel-qos-classifier",
        "version": "2.0.0",
        "type": "machine-learning",
        "algorithm": selected_name,
        "features": list(FEATURE_NAMES),
        "labels": list(LABELS),
        "training": {
            "source": "seeded synthetic QoS samples labeled by Phase 8 rules",
            "randomSeed": random_state,
            "samples": len(features),
            "testSamples": len(test_features),
        },
        "metrics": evaluations[selected_name],
        "candidates": evaluations,
        "baseline": _metrics(test_labels, baseline_predictions),
    }
    return {"model": candidates[selected_name], "metadata": metadata}


class QualityModel:
    def __init__(self, bundle: dict[str, Any] | None = None) -> None:
        self.bundle = bundle or (
            joblib.load(MODEL_PATH) if MODEL_PATH.exists() else train_model_bundle()
        )

    def predict(self, features: QualityFeatures) -> QualityPrediction:
        row = np.asarray(
            [
                [
                    features.rtt,
                    features.jitter,
                    features.packetLoss,
                    features.bitrate,
                    features.audioLevel,
                ]
            ],
            dtype=float,
        )
        model = self.bundle["model"]
        quality = str(model.predict(row)[0])
        confidence = float(np.max(model.predict_proba(row)[0]))
        return QualityPrediction(quality=quality, confidence=round(confidence, 4))

    def info(self) -> dict[str, Any]:
        return self.bundle["metadata"]


@lru_cache
def get_quality_model() -> QualityModel:
    return QualityModel()
