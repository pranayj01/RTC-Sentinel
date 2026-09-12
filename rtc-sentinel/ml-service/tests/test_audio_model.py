from collections import Counter

import numpy as np

from app.audio_model import (
    LABELS,
    AudioModel,
    extract_audio_features,
    generate_audio_dataset,
    train_audio_model_bundle,
)


def test_extracts_requested_signal_features() -> None:
    sample_rate = 16_000
    time = np.arange(8_000) / sample_rate
    samples = (0.2 * np.sin(2 * np.pi * 220 * time)).astype(np.float32)

    vector, features = extract_audio_features(samples, sample_rate)

    assert len(vector) == 32
    assert features.rmsEnergy > 0
    assert features.zeroCrossingRate > 0
    assert features.spectralCentroidHz > 0
    assert len(features.mfcc) == 13
    assert len(features.melSpectrogram) == 16


def test_audio_dataset_is_seeded_and_balanced() -> None:
    first_features, first_labels = generate_audio_dataset(samples_per_class=3, random_state=7)
    second_features, second_labels = generate_audio_dataset(samples_per_class=3, random_state=7)

    assert np.allclose(first_features, second_features)
    assert (first_labels == second_labels).all()
    assert Counter(first_labels) == Counter({label: 3 for label in LABELS})


def test_trains_and_evaluates_classical_audio_models() -> None:
    bundle = train_audio_model_bundle(samples_per_class=8, random_state=7)
    info = bundle["metadata"]

    assert set(info["candidates"]) == {"logistic-regression", "random-forest"}
    assert info["algorithm"] in info["candidates"]
    assert info["metrics"] == info["candidates"][info["algorithm"]]
    assert info["metrics"]["f1Macro"] >= 0.5
    assert len(info["metrics"]["confusionMatrix"]) == 3

    model = AudioModel(bundle)
    assert model.info()["labels"] == list(LABELS)
