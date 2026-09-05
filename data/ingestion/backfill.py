"""
Script de carga inicial: popula 1 ano de histórico para todos os tickers MVP.
Idempotente — upsert não duplica registros existentes.

Uso:
    python data/ingestion/backfill.py
    python data/ingestion/backfill.py --years 2   # histórico de 2 anos
"""
import argparse
import logging
from datetime import date, timedelta

from config import TICKERS_MVP
from data.ingestion.b3_fetcher import fetch_prices
from data.processing.feature_engineering import compute_all_features
from storage.supabase_client import upsert_prices

logger = logging.getLogger(__name__)


def run_backfill(years: int = 1) -> None:
    end = date.today()
    start = end - timedelta(days=365 * years)

    logger.info(f"Iniciando backfill de {years} ano(s): {start} → {end}")
    logger.info(f"Tickers: {TICKERS_MVP}")

    total_inserted = 0

    for i, ticker in enumerate(TICKERS_MVP, start=1):
        print(f"[{i}/{len(TICKERS_MVP)}] Coletando {ticker}...", end=" ", flush=True)

        df = fetch_prices(ticker, start=str(start), end=str(end))
        if df.empty:
            print("sem dados.")
            continue

        df = compute_all_features(df)
        if df.empty:
            print("sem features calculadas.")
            continue

        upsert_prices(df)
        total_inserted += len(df)
        print(f"{len(df)} linhas inseridas.")

    logger.info(f"Backfill concluído. Total: {total_inserted} linhas no Supabase.")
    print(f"\nBackfill concluído — {total_inserted} linhas persistidas.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill histórico de preços da B3")
    parser.add_argument(
        "--years",
        type=int,
        default=1,
        help="Quantos anos de histórico carregar (padrão: 1)",
    )
    args = parser.parse_args()
    run_backfill(years=args.years)


if __name__ == "__main__":
    main()
