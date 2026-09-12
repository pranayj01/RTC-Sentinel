from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import librosa
import numpy as np
from sklearn.ensemble import RandomForestClassifier
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

from app.audio import AudioChunk, AudioFeatures, AudioPrediction

LABELS = ("speech", "silence", "noise")
MODEL_PATH = Path(__file__).parent / "artifacts" / "audio_model.joblib"
SAMPLE_RATE = 16_000
FEATURE_NAMES = (
    "rmsMean",
    "rmsStd",
    "zcrMean",
    "zcrStd",
    "centroidMeanNormalized",
    "centroidStdNormalized",
    *(f"mfcc{index}Mean" for index in range(13)),
    *(f"mfcc{index}Std" for index in range(13)),
)


def extract_audio_features(
    samples: np.ndarray, sample_rate: int
) -> tuple[np.ndarray, AudioFeatures]:
    audio = np.asarray(samples, dtype=np.float32)
    frame_length = min(2_048, len(audio))
    hop_length = max(128, frame_length // 4)
    rms_frames = librosa.feature.rms(y=audio, frame_length=frame_length, hop_length=hop_length)[0]
    zcr_frames = librosa.feature.zero_crossing_rate(
        audio, frame_length=frame_length, hop_length=hop_length
    )[0]
    centroid_frames = librosa.feature.spectral_centroid(
        y=audio, sr=sample_rate, n_fft=frame_length, hop_length=hop_length
    )[0]
    mel_power = librosa.feature.melspectrogram(
        y=audio,
        sr=sample_rate,
        n_fft=frame_length,
        hop_length=hop_length,
        n_mels=16,
        power=2.0,
    )
    mel_db = librosa.power_to_db(mel_power, ref=1.0, top_db=80)
    mfcc_frames = librosa.feature.mfcc(S=mel_db, n_mfcc=13)

    vector = np.asarray(
        [
            float(np.mean(rms_frames)),
            float(np.std(rms_frames)),
            float(np.mean(zcr_frames)),
            float(np.std(zcr_frames)),
            float(np.mean(centroid_frames) / (sample_rate / 2)),
            float(np.std(centroid_frames) / (sample_rate / 2)),
            *np.mean(mfcc_frames, axis=1).tolist(),
            *np.std(mfcc_frames, axis=1).tolist(),
        ],
        dtype=float,
    )
    public = AudioFeatures(
        rmsEnergy=round(float(np.mean(rms_frames)), 6),
        zeroCrossingRate=round(float(np.mean(zcr_frames)), 6),
        spectralCentroidHz=round(float(np.mean(centroid_frames)), 2),
        mfcc=[round(float(value), 4) for value in np.mean(mfcc_frames, axis=1)],
        melSpectrogram=[round(float(value), 4) for value in np.mean(mel_db, axis=1)],
    )
    return vector, public


def _speech_sample(rng: np.random.Generator, sample_rate: int, length: int) -> np.ndarray:
    time = np.arange(length) / sample_rate
    fundamental = rng.uniform(90, 260)
    signal = sum(
        np.sin(2 * np.pi * fundamental * harmonic * time + rng.uniform(0, 2 * np.pi)) / harmonic
        for harmonic in range(1, 7)
    )
    syllable_rate = rng.uniform(2.5, 6)
    envelope = np.clip(
        0.15 + 0.85 * np.sin(2 * np.pi * syllable_rate * time + rng.uniform(0, 2 * np.pi)) ** 2,
        0,
        1,
    )
    signal = signal * envelope * rng.uniform(0.08, 0.3)
    signal += rng.normal(0, rng.uniform(0.001, 0.008), length)
    return np.clip(signal, -1, 1).astype(np.float32)


def _noise_sample(rng: np.random.Generator, sample_rate: int, length: int) -> np.ndarray:
    time = np.arange(length) / sample_rate
    kind = int(rng.integers(0, 4))
    amplitude = rng.uniform(0.03, 0.28)
    if kind == 0:
        signal = rng.normal(0, amplitude, length)
    elif kind == 1:
        signal = amplitude * np.sin(2 * np.pi * rng.uniform(40, 120) * time)
        signal += rng.normal(0, amplitude * 0.35, length)
    elif kind == 2:
        signal = np.zeros(length)
        for _ in range(int(rng.integers(4, 18))):
            position = int(rng.integers(0, length - 80))
            signal[position : position + 80] += np.hanning(80) * rng.uniform(0.2, 0.8)
        signal += rng.normal(0, 0.005, length)
    else:
        frequencies = rng.uniform(180, 1_200, 4)
        signal = sum(np.sin(2 * np.pi * frequency * time) for frequency in frequencies)
        signal *= amplitude / 4
    return np.clip(signal, -1, 1).astype(np.float32)


def _silence_sample(rng: np.random.Generator, length: int) -> np.ndarray:
    return rng.normal(0, rng.uniform(0, 0.0015), length).astype(np.float32)


def generate_audio_dataset(
    samples_per_class: int = 60, random_state: int = 42
) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(random_state)
    length = SAMPLE_RATE // 2
    rows: list[np.ndarray] = []
    labels: list[str] = []
    generators = {
        "speech": lambda: _speech_sample(rng, SAMPLE_RATE, length),
        "silence": lambda: _silence_sample(rng, length),
        "noise": lambda: _noise_sample(rng, SAMPLE_RATE, length),
    }
    for label in LABELS:
        for _ in range(samples_per_class):
            vector, _ = extract_audio_features(generators[label](), SAMPLE_RATE)
            rows.append(vector)
            labels.append(label)
    order = rng.permutation(len(rows))
    return np.asarray(rows)[order], np.asarray(labels)[order]


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


def train_audio_model_bundle(samples_per_class: int = 60, random_state: int = 42) -> dict[str, Any]:
    features, labels = generate_audio_dataset(samples_per_class, random_state)
    train_features, test_features, train_labels, test_labels = train_test_split(
        features,
        labels,
        test_size=0.25,
        random_state=random_state,
        stratify=labels,
    )
    candidates = {
        "logistic-regression": make_pipeline(
            StandardScaler(), LogisticRegression(max_iter=500, random_state=random_state)
        ),
        "random-forest": RandomForestClassifier(
            n_estimators=100, max_depth=12, random_state=random_state, n_jobs=1
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
    metadata = {
        "name": "rtc-sentinel-audio-classifier",
        "version": "1.0.0",
        "type": "machine-learning",
        "algorithm": selected_name,
        "labels": list(LABELS),
        "features": list(FEATURE_NAMES),
        "training": {
            "source": "seeded synthetic speech-like, silence, and environmental-noise signals",
            "randomSeed": random_state,
            "samples": len(features),
            "testSamples": len(test_features),
            "sampleRate": SAMPLE_RATE,
        },
        "metrics": evaluations[selected_name],
        "candidates": evaluations,
        "limitations": "Synthetic starter data is not evidence of production audio accuracy.",
    }
    return {"model": candidates[selected_name], "metadata": metadata}


class AudioModel:
    def __init__(self, bundle: dict[str, Any] | None = None) -> None:
        self.bundle = bundle or (
            joblib.load(MODEL_PATH) if MODEL_PATH.exists() else train_audio_model_bundle()
        )

    def predict(self, chunk: AudioChunk) -> AudioPrediction:
        samples = chunk.samples()
        model_samples = (
            samples
            if chunk.sampleRate == SAMPLE_RATE
            else librosa.resample(
                samples,
                orig_sr=chunk.sampleRate,
                target_sr=SAMPLE_RATE,
            )
        )
        vector, public_features = extract_audio_features(model_samples, SAMPLE_RATE)
        model = self.bundle["model"]
        label = str(model.predict(vector.reshape(1, -1))[0])
        confidence = float(np.max(model.predict_proba(vector.reshape(1, -1))[0]))
        return AudioPrediction(
            label=label,
            confidence=round(confidence, 4),
            durationMs=round(len(samples) / chunk.sampleRate * 1_000, 2),
            features=public_features,
        )

    def warm(self) -> None:
        vector, _ = extract_audio_features(np.zeros(SAMPLE_RATE // 2), SAMPLE_RATE)
        self.bundle["model"].predict_proba(vector.reshape(1, -1))

    def info(self) -> dict[str, Any]:
        return self.bundle["metadata"]


@lru_cache
def get_audio_model() -> AudioModel:
    return AudioModel()
