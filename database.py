# database.py
# ---------------------------------------------------------
# VoxShield - Local Storage Layer
# SIH 2026 | PS ID: SIH26104
# ---------------------------------------------------------
# This file just sets up the SQLite database and the ORM
# model for storing threat logs. Kept it separate from
# main.py so the FastAPI routes file doesn't get cluttered.
#
# We're using SQLAlchemy because it's what we studied in our
# DBMS + mini project labs, and SQLite is enough for a local
# prototype (no need to spin up Postgres for a hackathon demo).

from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import datetime

# using a simple file based sqlite db, sits right next to the project
DATABASE_URL = "sqlite:///./voxshield.db"

# check_same_thread=False needed because FastAPI/uvicorn will
# hit the db from different worker threads (async routes + ws)
engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


class ThreatLog(Base):
    """
    One row = one analysis window (roughly every ~1-2 sec chunk
    of streamed audio). We store the extracted acoustic features
    plus the final verdict so we can show a history ledger on the
    dashboard and also use it later for report generation / graphs.
    """

    __tablename__ = "threat_logs"

    id = Column(Integer, primary_key=True, index=True)

    # groups all logs coming from the same mic session together
    session_id = Column(String, index=True)

    # mean spectral centroid across the audio chunk (in Hz)
    spectral_centroid_mean = Column(Float)

    # variance of the MFCC coefficients (13 coeff -> flattened variance)
    mfcc_variance = Column(Float)

    # model/heuristic confidence that this chunk is a spoofed voice (0-100)
    spoof_confidence = Column(Float)

    # final call -> "SAFE" or "SPOOF_DETECTED"
    verdict = Column(String)

    # timestamp so the ledger can be sorted / shown chronologically
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


def init_db():
    # creates the table if it doesn't already exist
    # (won't touch existing data, safe to call on every startup)
    Base.metadata.create_all(bind=engine)


def get_db():
    # small helper, mainly used by the /fetch-telemetry endpoint
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
