import argparse
import json
from pathlib import Path

import joblib

from app.ml_model import MODEL_PATH, train_model_bundle


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train and evaluate the RTC Sentinel QoS classifier"
    )
    parser.add_argument("--output", type=Path, default=MODEL_PATH)
    parser.add_argument("--samples-per-class", type=int, default=120)
    parser.add_argument("--random-state", type=int, default=42)
    arguments = parser.parse_args()

    bundle = train_model_bundle(arguments.samples_per_class, arguments.random_state)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, arguments.output)
    metadata_path = arguments.output.with_suffix(".json")
    metadata_path.write_text(json.dumps(bundle["metadata"], indent=2) + "\n", encoding="utf-8")
    print(json.dumps(bundle["metadata"], indent=2))


if __name__ == "__main__":
    main()
