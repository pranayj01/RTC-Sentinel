from collections import Counter

from app.ml_model import LABELS, QualityModel, generate_training_data, train_model_bundle
from app.quality import QualityFeatures


def test_training_data_is_seeded_and_balanced() -> None:
    first_features, first_labels = generate_training_data(samples_per_class=10, random_state=7)
    second_features, second_labels = generate_training_data(samples_per_class=10, random_state=7)

    assert (first_features == second_features).all()
    assert (first_labels == second_labels).all()
    assert Counter(first_labels) == Counter({label: 10 for label in LABELS})


def test_evaluates_three_models_and_rule_baseline() -> None:
    bundle = train_model_bundle(samples_per_class=15, random_state=7)
    info = bundle["metadata"]

    assert set(info["candidates"]) == {
        "logistic-regression",
        "random-forest",
        "gradient-boosting",
    }
    assert info["algorithm"] in info["candidates"]
    assert info["metrics"] == info["candidates"][info["algorithm"]]
    assert info["baseline"]["accuracy"] == 1.0
    for result in [*info["candidates"].values(), info["baseline"]]:
        assert 0 <= result["accuracy"] <= 1
        assert 0 <= result["precisionMacro"] <= 1
        assert 0 <= result["recallMacro"] <= 1
        assert 0 <= result["f1Macro"] <= 1
        assert len(result["confusionMatrix"]) == 5

    prediction = QualityModel(bundle).predict(
        QualityFeatures(rtt=80, jitter=10, packetLoss=0.5, bitrate=48_000, audioLevel=0.4),
    )
    assert prediction.quality in LABELS
    assert 0 <= prediction.confidence <= 1
