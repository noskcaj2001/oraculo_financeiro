import logging
from typing import Optional
import pandas as pd
from supabase import create_client, Client

from config import SUPABASE_URL, SUPABASE_KEY, REQUIRED_COLUMNS

logger = logging.getLogger(__name__)

_client: Optional[Client] = None

UPSERT_BATCH_SIZE = 500


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client


def upsert_prices(df: pd.DataFrame) -> None:
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"DataFrame faltando colunas obrigatórias: {missing}")

    client = get_client()
    records = df[REQUIRED_COLUMNS].copy()
    records["date"] = records["date"].astype(str)
    rows = records.to_dict(orient="records")

    total = 0
    for i in range(0, len(rows), UPSERT_BATCH_SIZE):
        batch = rows[i : i + UPSERT_BATCH_SIZE]
        client.table("prices").upsert(batch, on_conflict="ticker,date").execute()
        total += len(batch)
        logger.info(f"Upsert prices: {total}/{len(rows)} linhas")


def fetch_prices(ticker: str, start: str, end: str) -> pd.DataFrame:
    client = get_client()
    response = (
        client.table("prices")
        .select("*")
        .eq("ticker", ticker)
        .gte("date", start)
        .lte("date", end)
        .order("date")
        .execute()
    )
    if not response.data:
        return pd.DataFrame(columns=REQUIRED_COLUMNS)
    df = pd.DataFrame(response.data)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df


def upsert_signals(df: pd.DataFrame) -> None:
    required = ["ticker", "date", "signal", "confidence", "model_version"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"DataFrame faltando colunas: {missing}")

    client = get_client()
    records = df[required].copy()
    records["date"] = records["date"].astype(str)
    rows = records.to_dict(orient="records")

    for i in range(0, len(rows), UPSERT_BATCH_SIZE):
        batch = rows[i : i + UPSERT_BATCH_SIZE]
        client.table("signals").upsert(batch, on_conflict="ticker,date,model_version").execute()


def fetch_latest_signal(ticker: str) -> Optional[dict]:
    client = get_client()
    response = (
        client.table("signals")
        .select("*")
        .eq("ticker", ticker)
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    return response.data[0]
