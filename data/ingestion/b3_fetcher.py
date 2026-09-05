import logging
from datetime import date
import pandas as pd
import yfinance as yf

from config import TICKERS_MVP, REQUIRED_COLUMNS

logger = logging.getLogger(__name__)

_YFINANCE_TO_STANDARD = {
    "Open": "open",
    "High": "high",
    "Low": "low",
    "Close": "close",
    "Volume": "volume",
}


def fetch_prices(ticker: str, start: str, end: str) -> pd.DataFrame:
    if not ticker.endswith(".SA"):
        logger.warning(f"Ticker '{ticker}' não tem sufixo .SA — adicionando automaticamente")
        ticker = ticker + ".SA"

    try:
        raw = yf.download(ticker, start=start, end=end, auto_adjust=True, progress=False)
        if raw.empty:
            logger.warning(f"yfinance não retornou dados para {ticker} ({start} → {end})")
            return pd.DataFrame(columns=REQUIRED_COLUMNS)

        # yfinance pode retornar MultiIndex quando baixa um único ticker
        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = raw.columns.droplevel(1)

        df = raw.rename(columns=_YFINANCE_TO_STANDARD)
        df = df[list(_YFINANCE_TO_STANDARD.values())].copy()

        df.index.name = "date"
        df = df.reset_index()
        df["date"] = pd.to_datetime(df["date"]).dt.date
        df["ticker"] = ticker

        df = df[REQUIRED_COLUMNS]
        df["volume"] = df["volume"].astype("Int64")

        logger.info(f"Coletados {len(df)} registros para {ticker}")
        return df

    except Exception as e:
        logger.error(f"Erro ao buscar {ticker}: {e}")
        return pd.DataFrame(columns=REQUIRED_COLUMNS)


def fetch_all_tickers(start: str, end: str) -> pd.DataFrame:
    frames = []
    for ticker in TICKERS_MVP:
        df = fetch_prices(ticker, start=start, end=end)
        if not df.empty:
            frames.append(df)

    if not frames:
        logger.warning("Nenhum dado coletado para nenhum ticker")
        return pd.DataFrame(columns=REQUIRED_COLUMNS)

    result = pd.concat(frames, ignore_index=True)
    logger.info(f"Total coletado: {len(result)} registros ({len(frames)} tickers)")
    return result
