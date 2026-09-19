# VoxShield — SIH26104

AI-Powered Real-Time Detection and Prevention of Voice Cloning Impersonation Attacks.

## Files
- `database.py` — SQLite + SQLAlchemy model for `ThreatLog`
- `main.py` — FastAPI backend, `/stream-audio` websocket + DSP/scoring engine
- `index.html` — single page dashboard (mic capture, live metrics, ledger)

## Setup

```bash
pip install fastapi uvicorn sqlalchemy librosa numpy python-multipart websockets
```

## Run

```bash
python main.py
```

Then open **http://localhost:8000** in Chrome (mic permission needed).
Click **Start Monitoring**, allow mic access, and speak. Metrics update roughly
once per second (each ~1 sec / 16000-sample window). Try playing back a
recorded/synthetic voice clip near the mic to see how the verdict shifts.

## How detection works (current prototype stage)

This build uses a **heuristic DSP scorer**, not a trained neural classifier yet —
that's flagged clearly in the code comments and is meant to be swappable later
(e.g. with an LCNN/RawNet2 model trained on ASVspoof 2019 + WaveFake, which is
what our research slides reference). The two signals combined right now:

1. **MFCC variance** — real human speech has more frame-to-frame variance across
   the 13 MFCC coefficients; synthetic/vocoder speech tends to be smoother.
2. **Spectral centroid band** — a lot of TTS/vocoder output we sampled during
   dataset exploration clustered in a fairly narrow centroid range.

Threshold for flagging `SPOOF_DETECTED` is **88% confidence** (config value
`SPOOF_THRESHOLD` in `main.py`).

## Known limitations (good to mention in the demo / PPT)
- Heuristic scoring, not a trained model — next milestone is bolting on a real
  classifier trained on ASVspoof/WaveFake without changing the streaming pipeline.
- `ScriptProcessorNode` is used on the frontend for simplicity; production version
  should migrate to `AudioWorklet`.
- Non-overlapping 1-second analysis windows — could add overlapping windows for
  smoother/faster detection.
