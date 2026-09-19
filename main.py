# main.py
# ---------------------------------------------------------
# VoxShield - AI-Powered Real-Time Detection and Prevention
# of Voice Cloning Impersonation Attacks
#
# Smart India Hackathon 2026 | Problem Statement: SIH26104
# ---------------------------------------------------------

import json
import uuid
import os
import numpy as np
import librosa

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import init_db, get_db, ThreatLog, SessionLocal

app = FastAPI(title="VoxShield Backend - SIH26104")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ----------------------------------------------------------------
# Configuration / Constants
# ----------------------------------------------------------------
SAMPLE_RATE = 16000          
SPOOF_THRESHOLD = 88.0       
MIN_SAMPLES_FOR_ANALYSIS = SAMPLE_RATE  

MFCC_VAR_HUMAN_FLOOR = 45.0
CENTROID_SYNTHETIC_BAND = (1500, 2600)


def extract_features(audio_float: np.ndarray, sr: int = SAMPLE_RATE):
    if np.all(audio_float == 0):
        audio_float = audio_float + 1e-6

    mfcc = librosa.feature.mfcc(y=audio_float, sr=sr, n_mfcc=13)
    centroid = librosa.feature.spectral_centroid(y=audio_float, sr=sr)

    mfcc_variance_per_coeff = np.var(mfcc, axis=1)
    mfcc_var = float(np.mean(mfcc_variance_per_coeff))
    centroid_mean = float(np.mean(centroid))

    return {
        "centroid_mean": centroid_mean,
        "mfcc_var": mfcc_var,
        "mfcc_matrix": mfcc,
    }


def score_spoof_confidence(centroid_mean: float, mfcc_var: float) -> float:
    score = 0.0

    if mfcc_var < MFCC_VAR_HUMAN_FLOOR:
        deficit = MFCC_VAR_HUMAN_FLOOR - mfcc_var
        score += min(55.0, deficit * 1.4)
    else:
        score += 5.0

    low, high = CENTROID_SYNTHETIC_BAND
    if low <= centroid_mean <= high:
        score += 40.0
    else:
        score += 8.0

    return float(max(0.0, min(100.0, score)))


def pcm16_bytes_to_float32(raw_bytes: bytes) -> np.ndarray:
    int16_arr = np.frombuffer(raw_bytes, dtype=np.int16)
    float_arr = int16_arr.astype(np.float32) / 32768.0
    return float_arr


def save_log(db: Session, session_id: str, centroid_mean: float,
             mfcc_var: float, confidence: float, verdict: str) -> ThreatLog:
    entry = ThreatLog(
        session_id=session_id,
        spectral_centroid_mean=centroid_mean,
        mfcc_variance=mfcc_var,
        spoof_confidence=confidence,
        verdict=verdict,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


# ----------------------------------------------------------------
# Static & HTML File Routes
# ----------------------------------------------------------------

@app.get("/")
def serve_index():
    index_path = os.path.join(BASE_DIR, "index.html")
    return FileResponse(index_path)


@app.get("/style.css")
def serve_css():
    css_path = os.path.join(BASE_DIR, "style.css")
    return FileResponse(css_path, media_type="text/css")


@app.get("/app.js")
def serve_js():
    js_path = os.path.join(BASE_DIR, "app.js")
    return FileResponse(js_path, media_type="application/javascript")


@app.get("/fetch-telemetry")
def fetch_telemetry(limit: int = 50, db: Session = Depends(get_db)):
    rows = (
        db.query(ThreatLog)
        .order_by(ThreatLog.id.desc())
        .limit(limit)
        .all()
    )

    result = []
    for r in rows:
        result.append({
            "id": r.id,
            "session_id": r.session_id,
            "spectral_centroid_mean": round(r.spectral_centroid_mean, 2),
            "mfcc_variance": round(r.mfcc_variance, 2),
            "spoof_confidence": round(r.spoof_confidence, 2),
            "verdict": r.verdict,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {"count": len(result), "logs": result}


@app.websocket("/stream-audio")
async def stream_audio(ws: WebSocket):
    await ws.accept()

    session_id = str(uuid.uuid4())[:8]
    buffer = np.array([], dtype=np.float32)
    db = SessionLocal()

    print(f"[VoxShield] Client connected -> session {session_id}")

    try:
        while True:
            raw_chunk = await ws.receive_bytes()

            chunk_float = pcm16_bytes_to_float32(raw_chunk)
            buffer = np.concatenate((buffer, chunk_float))

            if len(buffer) >= MIN_SAMPLES_FOR_ANALYSIS:
                features = extract_features(buffer, sr=SAMPLE_RATE)
                confidence = score_spoof_confidence(
                    features["centroid_mean"], features["mfcc_var"]
                )

                verdict = "SPOOF_DETECTED" if confidence >= SPOOF_THRESHOLD else "SAFE"

                log_entry = save_log(
                    db,
                    session_id,
                    features["centroid_mean"],
                    features["mfcc_var"],
                    confidence,
                    verdict,
                )

                await ws.send_text(json.dumps({
                    "session_id": session_id,
                    "centroid_mean": round(features["centroid_mean"], 2),
                    "mfcc_var": round(features["mfcc_var"], 2),
                    "confidence": round(confidence, 2),
                    "verdict": verdict,
                    "log_id": log_entry.id,
                }))

                buffer = np.array([], dtype=np.float32)

    except WebSocketDisconnect:
        print(f"[VoxShield] Session {session_id} disconnected")
    except Exception as e:
        print(f"[VoxShield] Error in session {session_id}: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)