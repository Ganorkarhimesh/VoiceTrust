# VoiceTrust — SIH26104

AI-Powered Real-Time Detection and Prevention of Voice Cloning Impersonation Attacks.

## Files
- `database.py` — SQLite + SQLAlchemy model for `ThreatLog`
- `main.py` — FastAPI backend, `/stream-audio` websocket + DSP/scoring engine
- `index.html` — single page dashboard (mic capture, live metrics, ledger)

## Setup

Install the dependencies one by one in your VSCode terminal (inside the project folder):

```bash
pip install fastapi
```

```bash
pip install uvicorn
```

```bash
pip install sqlalchemy
```

```bash
pip install librosa
```

```bash
pip install numpy
```

```bash
pip install python-multipart
```

```bash
pip install websockets
```

Or, if you'd rather do it in one shot:

```bash
pip install fastapi uvicorn sqlalchemy librosa numpy python-multipart websockets
```   



**Notes:**
- If `pip` isn't recognized, use `pip3` instead, or `python -m pip install <package>`.
- `librosa` is a heavier package (pulls in `numba`, `soundfile`, `scipy`, etc.) —
  it can take a couple of minutes to install, that's normal.

### Fixing yellow underline / "import could not be resolved" errors

If VSCode shows yellow squiggly lines under the imports in `main.py` or
`database.py` even after installing the packages above, that's a **Pylance
editor warning**, not an actual code bug — it means VSCode is pointed at a
different Python interpreter than the one you installed the packages into.

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and run **"Python: Select
   Interpreter"**. Pick the same environment you ran `pip install` in
   (especially important if you're using a virtual environment / venv).
2. Reload VSCode: `Ctrl+Shift+P` → **"Developer: Reload Window"**.
3. Confirm the packages installed correctly by running:
   ```bash
   python -c "import fastapi; import librosa; import sqlalchemy"
   ```
   No errors printed = the packages are fine, it was purely an editor/interpreter
   mismatch.
4. Still stuck? Run `python -m pip show fastapi` and check the `Location:` path
   it prints against the interpreter path shown in the bottom-right corner of
   VSCode. If they don't match, that's the mismatch — switch the interpreter to
   match the install location.

## Run

```bash
python main.py
```
and

```bash
python -m uvicorn main:app --reload
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

<img width="1917" height="1063" alt="Screenshot 2026-09-11 110655" src="https://github.com/user-attachments/assets/08146d3d-f773-4689-8202-2becb142b080" />
<img width="1916" height="906" alt="Screenshot 2026-09-11 110716" src="https://github.com/user-attachments/assets/40d7c19c-b4c1-4f4e-a655-bd22f403911e" />
<img width="1917" height="893" alt="Screenshot 2026-09-11 110735" src="https://github.com/user-attachments/assets/aa5c24b7-18d6-4c87-a66c-f9ffc00015cf" />
<img width="1916" height="940" alt="Screenshot 2026-09-11 110851" src="https://github.com/user-attachments/assets/50a76ba7-3c3e-4d00-8fa6-352ce6dba434" />
<img width="1912" height="892" alt="Screenshot 2026-09-11 110929" src="https://github.com/user-attachments/assets/52cb123c-c602-4e8b-99c5-73cf4b378824" />
<img width="1907" height="892" alt="Screenshot 2026-09-11 111729" src="https://github.com/user-attachments/assets/83f36f3e-e559-49c8-8fe1-cff5534d7976" />
