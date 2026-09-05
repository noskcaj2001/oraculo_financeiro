"""
Cotações em tempo real via yfinance fast_info com cache Redis.
TTL padrão de 60s — adequado para o delay de ~15 min do yfinance B3 gratuito.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

import yfinance as yf

from config import TICKERS_MVP
from storage.redis_client import get_quote, set_quote

logger = logging.getLogger(__name__)

QUOTE_TTL = 60


def fetch_quote(ticker: str) -> dict:
    """
    Retorna cotação para um ticker.

    Fluxo: Redis hit → retorna imediatamente (cached=True)
           Redis miss → yf.Ticker.fast_info → set_quote() → retorna (cached=False)

    Campos: ticker, price, prev_close, pct_change, volume,
            day_high, day_low, currency, cached
    """
    cached = get_quote(ticker)
    if cached is not None:
        cached["cached"] = True
        return cached

    try:
        info = yf.Ticker(ticker).fast_info
        price      = float(info.last_price      or 0)
        prev_close = float(info.previous_close  or 0)
        pct_change = (price - prev_close) / prev_close * 100 if prev_close else 0.0

        data = {
            "ticker":     ticker,
            "price":      round(price, 2),
            "prev_close": round(prev_close, 2),
            "pct_change": round(pct_change, 2),
            "volume":     int(info.three_month_average_volume or 0),
            "day_high":   round(float(info.day_high or 0), 2),
            "day_low":    round(float(info.day_low  or 0), 2),
            "currency":   getattr(info, "currency", "BRL"),
            "cached":     False,
        }
    except Exception as exc:
        logger.warning(f"Erro ao buscar cotação de {ticker}: {exc}")
        data = {
            "ticker": ticker, "price": 0.0, "prev_close": 0.0,
            "pct_change": 0.0, "volume": 0, "day_high": 0.0,
            "day_low": 0.0, "currency": "BRL", "cached": False,
        }

    set_quote(ticker, {k: v for k, v in data.items() if k != "cached"}, ttl=QUOTE_TTL)
    return data


def fetch_all_quotes(tickers: list[str] | None = None) -> list[dict]:
    """Busca cotações de todos os TICKERS_MVP em paralelo."""
    tickers = tickers or TICKERS_MVP
    results: list[dict] = []

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(fetch_quote, t): t for t in tickers}
        for future in as_completed(futures):
            try:
                results.append(future.result())
            except Exception as exc:
                logger.warning(f"Erro no future de {futures[future]}: {exc}")

    return sorted(results, key=lambda d: d["ticker"])


if __name__ == "__main__":
    import json
    logging.basicConfig(level=logging.INFO)
    quotes = fetch_all_quotes()
    for q in quotes:
        sign = "+" if q["pct_change"] >= 0 else ""
        print(f"{q['ticker']:<12} R$ {q['price']:>8.2f}  {sign}{q['pct_change']:>+.2f}%  "
              f"cached={'sim' if q['cached'] else 'não'}")
