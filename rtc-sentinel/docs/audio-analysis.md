# Audio signal analysis

Phase 11 adds opt-in microphone signal analysis to an active authenticated call. It answers a narrow question—whether a short frame most resembles speech, silence, or noise—and does not perform speech recognition or transcription.

## Data flow and privacy

1. The browser's Web Audio API samples 16,384 values from the local microphone every three seconds while analysis is enabled.
2. The client converts the samples to little-endian signed 16-bit PCM and sends the base64-encoded frame through the authenticated Node API.
3. Node validates the request and forwards it to FastAPI. FastAPI decodes the frame in memory, resamples it to 16 kHz, extracts features, and returns a classification.
4. The response is displayed in the call dashboard. Raw PCM is not written to PostgreSQL, Redis, logs, or model artifacts.

Analysis is off by default. Guests cannot use the protected endpoint. Disabling the control stops new frames from being submitted. Because the system sends microphone waveforms to the local analytics service, a production deployment should additionally document retention controls, transport encryption, user consent, and regional privacy requirements.

## Signal features

The FastAPI service uses Librosa to compute:

- RMS energy, which summarizes signal loudness.
- Zero-crossing rate, which describes how often the waveform changes sign.
- Spectral centroid, which approximates the frequency spectrum's center of mass.
- Thirteen Mel-frequency cepstral coefficients (MFCCs).
- A sixteen-band mean Mel spectrogram.

The model vector contains the mean and standard deviation of RMS, zero-crossing rate, normalized spectral centroid, and each MFCC: 32 values in total. The API also returns compact feature summaries for inspection in the client.

## Starter dataset and model selection

The reproducible generator uses seed `42` and creates 180 half-second, 16 kHz examples, balanced across the three output labels. Its source patterns approximate:

- clean speech with harmonic, pitch, syllable-envelope, and low-noise synthesis;
- silence with zero or very low background energy;
- fan/hum, traffic-like broadband noise, keyboard impulses, and music-like tones.

The split is stratified: 135 training samples and 45 holdout samples. Logistic regression and random forest are trained and compared by macro F1. Random forest is selected.

| Model               | Accuracy | Macro precision | Macro recall | Macro F1 |
| ------------------- | -------: | --------------: | -----------: | -------: |
| Logistic regression |   0.9778 |          0.9792 |       0.9778 |   0.9778 |
| Random forest       |   1.0000 |          1.0000 |       1.0000 |   1.0000 |

Selected-model confusion matrix; rows are actual and columns are predicted in `speech`, `silence`, `noise` order:

| Actual \ Predicted | Speech | Silence | Noise |
| ------------------ | -----: | ------: | ----: |
| Speech             |     15 |       0 |     0 |
| Silence            |      0 |      15 |     0 |
| Noise              |      0 |       0 |    15 |

These results measure separation of generated patterns that resemble the training generator. They do not establish performance on real microphones, speakers, rooms, accents, devices, codecs, or mixed sound. The next evaluation step is a consented, labeled real-audio corpus with speaker-disjoint train/test splits, per-noise-source reporting, class calibration, and drift monitoring.

## API contract

FastAPI owns the model endpoints:

```http
POST /analyze-audio
Content-Type: application/json

{
  "encoding": "pcm_s16le",
  "sampleRate": 48000,
  "pcmBase64": "<base64 PCM frame>"
}
```

```json
{
  "label": "speech",
  "confidence": 0.91,
  "durationMs": 341.33,
  "features": {
    "rmsEnergy": 0.125,
    "zeroCrossingRate": 0.083,
    "spectralCentroidHz": 1280.0,
    "mfcc": [0.0],
    "melSpectrogram": [0.0]
  }
}
```

`mfcc` contains 13 values and `melSpectrogram` contains 16. `GET /audio/model/info` returns the selected algorithm, feature names, dataset metadata, candidate metrics, confusion matrix, and limitations.

The browser calls the protected Node proxy at `POST /analytics/analyze-audio`. Missing or invalid JWTs are rejected. Invalid payloads return `400 VALIDATION_ERROR`; a failed or invalid FastAPI response returns `503 AUDIO_ANALYSIS_UNAVAILABLE`.

## Reproduce training and tests

```bash
cd ml-service
python -m app.train_audio_model
pytest
```

The Docker test target installs the pinned dependencies, trains both QoS and audio artifacts, runs Ruff, and executes pytest:

```bash
docker build --target test -f infrastructure/docker/ml-service.Dockerfile .
```
