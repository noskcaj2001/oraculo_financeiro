"""
Pipeline de embedding: lê preços do Supabase, gera resumos semanais por ticker,
embeda via OpenAI e indexa no Qdrant.
"""
import hashlib
import logging
import uuid
from datetime import date, timedelta

import pandas as pd
from openai import OpenAI
from qdrant_client.models import PointStruct

from config import OPENAI_API_KEY, TICKERS_MVP
from data.processing.feature_engineering import compute_all_features
from storage import supabase_client as supa
from storage import qdrant_client as qdrant
from storage.supabase_client import get_client as get_supa

logger = logging.getLogger(__name__)

EMBED_MODEL = "text-embedding-3-small"

_openai: OpenAI | None = None


def _get_openai() -> OpenAI:
    global _openai
    if _openai is None:
        _openai = OpenAI(api_key=OPENAI_API_KEY)
    return _openai


# ---------------------------------------------------------------------------
# Geração de texto de resumo
# ---------------------------------------------------------------------------

def _trend_label(pct_change: float) -> str:
    if pct_change > 1.5:
        return "forte alta"
    if pct_change > 0.3:
        return "leve alta"
    if pct_change < -1.5:
        return "forte queda"
    if pct_change < -0.3:
        return "leve queda"
    return "lateralização"


def build_weekly_summary(group: pd.DataFrame, ticker: str, week_start: date) -> str:
    week_end = group["date"].max()
    open_price = group.loc[group["date"] == group["date"].min(), "close"].values[0]
    close_price = group.loc[group["date"] == group["date"].max(), "close"].values[0]
    high = group["high"].max()
    low = group["low"].min()
    avg_volume = int(group["volume"].mean())
    pct_change = (close_price - open_price) / open_price * 100
    trend = _trend_label(pct_change)

    rsi_val = f"{group['rsi'].mean():.1f}" if "rsi" in group.columns and not group["rsi"].isna().all() else "n/d"
    macd_val = f"{group['macd'].mean():.3f}" if "macd" in group.columns and not group["macd"].isna().all() else "n/d"
    vol_val = f"{group['volatility_20d'].mean():.4f}" if "volatility_20d" in group.columns and not group["volatility_20d"].isna().all() else "n/d"

    return (
        f"{ticker} | Semana {week_start} a {week_end}: "
        f"abertura R${open_price:.2f}, fechamento R${close_price:.2f} ({pct_change:+.2f}%), "
        f"máxima R${high:.2f}, mínima R${low:.2f}. "
        f"Volume médio: {avg_volume:,}. "
        f"RSI médio: {rsi_val}, MACD médio: {macd_val}, Volatilidade 20d: {vol_val}. "
        f"Tendência semanal: {trend}."
    )


def _doc_id(ticker: str, week_start: date) -> str:
    key = f"{ticker}_{week_start}"
    return str(uuid.UUID(hashlib.md5(key.encode()).hexdigest()))


# ---------------------------------------------------------------------------
# Pipeline principal
# ---------------------------------------------------------------------------

def embed_texts(texts: list[str]) -> list[list[float]]:
    client = _get_openai()
    response = client.embeddings.create(model=EMBED_MODEL, input=texts)
    return [item.embedding for item in response.data]


def run_embedding_pipeline(
    tickers: list[str] | None = None,
    start: str | None = None,
    end: str | None = None,
    batch_size: int = 50,
) -> int:
    tickers = tickers or TICKERS_MVP
    end_date = date.fromisoformat(end) if end else date.today()
    start_date = date.fromisoformat(start) if start else end_date - timedelta(days=365)

    qdrant.ensure_collection()

    total_indexed = 0
    supa_client = get_supa()

    for ticker in tickers:
        logger.info(f"Gerando embeddings para {ticker}...")
        df = supa.fetch_prices(ticker, str(start_date), str(end_date))
        if df.empty:
            logger.warning(f"Sem dados para {ticker}, pulando.")
            continue

        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values("date")

        # Calcula RSI, MACD, Bollinger e volatilidade em memória
        # para que build_weekly_summary inclua valores reais no texto do embedding
        df = compute_all_features(df)

        # Agrupar por semana ISO
        df["week_start"] = df["date"].dt.to_period("W").apply(lambda p: p.start_time.date())

        points = []
        meta_rows = []

        for week_start, group in df.groupby("week_start"):
            doc_id = _doc_id(ticker, week_start)
            text = build_weekly_summary(group, ticker, week_start)

            period_label = str(week_start)
            meta_rows.append({
                "doc_id": doc_id,
                "ticker": ticker,
                "source": "yfinance",
                "doc_type": "price_summary",
                "period": period_label,
            })

            # Guardar texto e metadados para embed em batch
            points.append((doc_id, text, ticker, period_label, str(week_start)))

        # Embed em batches
        for i in range(0, len(points), batch_size):
            chunk = points[i : i + batch_size]
            texts = [p[1] for p in chunk]
            vectors = embed_texts(texts)

            qdrant_points = [
                PointStruct(
                    id=p[0],
                    vector=vec,
                    payload={
                        "ticker": p[2],
                        "period": p[3],
                        "week_start": p[4],
                        "text": p[1],
                        "source": "yfinance",
                        "doc_type": "price_summary",
                    },
                )
                for p, vec in zip(chunk, vectors)
            ]
            qdrant.upsert_points(qdrant_points)

        # Persistir metadados no Supabase
        if meta_rows:
            supa_client.table("embeddings_meta").upsert(
                meta_rows, on_conflict="doc_id"
            ).execute()

        total_indexed += len(points)
        print(f"  {ticker}: {len(points)} resumos semanais indexados.")

    logger.info(f"Pipeline de embedding concluído. Total: {total_indexed} documentos.")
    return total_indexed


def run_news_pipeline(max_age_days: int = 7, batch_size: int = 50) -> int:
    """
    Busca notícias via RSS, gera embeddings e faz upsert no Qdrant.
    doc_id é hash MD5 da URL — upsert idempotente, sem duplicatas.
    """
    from data.ingestion.news_fetcher import fetch_news

    news_items = fetch_news(max_age_days=max_age_days)
    if not news_items:
        logger.warning("Nenhuma notícia encontrada. Pipeline encerrado.")
        return 0

    qdrant.ensure_collection()
    supa_client = get_supa()

    points_data = [
        (item["doc_id"], item["text"], item["ticker"], item["published"],
         item["source"], item["url"], item["title"])
        for item in news_items
    ]

    meta_rows = [
        {
            "doc_id":   item["doc_id"],
            "ticker":   item["ticker"],
            "source":   item["source"],
            "doc_type": "news_article",
            "period":   item["published"],
        }
        for item in news_items
    ]

    total_indexed = 0
    for i in range(0, len(points_data), batch_size):
        chunk = points_data[i : i + batch_size]
        texts = [p[1] for p in chunk]
        vectors = embed_texts(texts)

        qdrant_points = [
            PointStruct(
                id=p[0],
                vector=vec,
                payload={
                    "ticker":   p[2],
                    "period":   p[3],
                    "source":   p[4],
                    "url":      p[5],
                    "title":    p[6],
                    "text":     p[1],
                    "doc_type": "news_article",
                },
            )
            for p, vec in zip(chunk, vectors)
        ]
        qdrant.upsert_points(qdrant_points)
        total_indexed += len(chunk)

    if meta_rows:
        supa_client.table("embeddings_meta").upsert(
            meta_rows, on_conflict="doc_id"
        ).execute()

    logger.info(f"Pipeline de notícias concluído. Total: {total_indexed} artigos indexados.")
    print(f"  Notícias: {total_indexed} artigos indexados no Qdrant.")
    return total_indexed


if __name__ == "__main__":
    count = run_embedding_pipeline()
    print(f"\nTotal indexado no Qdrant: {count} documentos.")
