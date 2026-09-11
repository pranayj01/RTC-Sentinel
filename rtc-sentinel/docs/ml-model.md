# ML call-quality classifier

## Why ML?

The deterministic Phase 8 engine is transparent and dependable, but fixed thresholds cannot learn interactions or adapt to labeled production outcomes. Phase 10 establishes a reproducible classical-ML pipeline so future real call data can be evaluated without changing the prediction API.

## Data and labels

No real user audio or telemetry is bundled with this project. Training uses 600 seeded synthetic QoS samples balanced across `excellent`, `good`, `fair`, `poor`, and `critical`.

Each sample contains RTT, jitter, packet loss, bitrate, and audio level. Network values are sampled within the Phase 8 threshold bands, at least one dimension is forced into the target band, and the Phase 8 worst-dimension rule supplies the label. Audio level is included as a forward-compatible feature but does not influence these generated labels.

The split is stratified: 450 samples train the candidates and 150 remain as an unseen test set. Seed `42` makes the data, split, models, and reported results repeatable.

## Candidate results

| Model                  |   Accuracy | Macro precision | Macro recall |   Macro F1 |
| ---------------------- | ---------: | --------------: | -----------: | ---------: |
| Logistic regression    |     0.7067 |          0.7096 |       0.7067 |     0.7031 |
| Random forest          |     0.9467 |          0.9480 |       0.9467 |     0.9466 |
| Gradient boosting      | **0.9733** |      **0.9754** |   **0.9733** | **0.9733** |
| Deterministic baseline |     1.0000 |          1.0000 |       1.0000 |     1.0000 |

Gradient boosting is selected by macro F1. Its confusion matrix uses rows as actual labels and columns as predicted labels in this order: Excellent, Good, Fair, Poor, Critical.

| Actual / predicted | Excellent | Good | Fair | Poor | Critical |
| ------------------ | --------: | ---: | ---: | ---: | -------: |
| Excellent          |        27 |    3 |    0 |    0 |        0 |
| Good               |         0 |   30 |    0 |    0 |        0 |
| Fair               |         0 |    0 |   30 |    0 |        0 |
| Poor               |         0 |    0 |    0 |   30 |        0 |
| Critical           |         0 |    0 |    0 |    1 |       29 |

## Serving and reproducibility

The Docker image runs `python -m app.train_model` during its build and stores the selected estimator plus metadata with Joblib. FastAPI loads that trusted, image-local artifact and returns the winning class with its `predict_proba` confidence. `GET /model/info` exposes the selected algorithm, dataset provenance, metrics for all candidates, baseline metrics, and confusion matrices.

To train manually in an environment where scikit-learn can load its native libraries:

```bash
cd ml-service
python -m app.train_model
```

## Limitations

The deterministic baseline scores 100% because it generated the synthetic ground truth. The ML result therefore does not demonstrate an improvement yet; it demonstrates the training, evaluation, selection, serialization, and serving pipeline. Production claims require consented, anonymized real-call outcomes, leakage checks, cross-validation, class-drift monitoring, and calibration. Audio level will only become meaningful after real labels or the Phase 11 audio-analysis pipeline are available.
