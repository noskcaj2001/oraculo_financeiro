from datetime import date, timedelta
import numpy as np
import pandas as pd
import pytest

from data.processing.feature_engineering import compute_all_features

FEATURE_COLS = [
    "rsi", "macd", "macd_signal", "macd_diff",
    "bb_upper", "bb_middle", "bb_lower", "volatility_20d",
]


def _make_price_df(ticker: str = "PETR4.SA", n: int = 60, seed: int = 42) -> pd.DataFrame:
    start = date(2024, 1, 2)
    dates = [start + timedelta(days=i) for i in range(n)]
    np.random.seed(seed)
    close = 30 + np.cumsum(np.random.randn(n) * 0.5)
    return pd.DataFrame({
        "ticker": ticker,
        "date":   dates,
        "open":   close * 0.99,
        "high":   close * 1.01,
        "low":    close * 0.98,
        "close":  close,
        "volume": np.random.randint(100_000, 1_000_000, n),
    })


def test_compute_all_features_columns_exist():
    df = _make_price_df(n=60)
    result = compute_all_features(df)
    for col in FEATURE_COLS:
        assert col in result.columns, f"Coluna ausente: {col}"


def test_no_nan_after_warmup():
    df = _make_price_df(n=60)
    result = compute_all_features(df)
    for col in FEATURE_COLS:
        assert result[col].isna().sum() == 0, f"NaN encontrado em '{col}' após remoção do warmup"


def test_grouped_by_ticker():
    df_a = _make_price_df(ticker="PETR4.SA", n=60, seed=42)
    df_b = _make_price_df(ticker="VALE3.SA", n=60, seed=99)
    # Intercalar os tickers propositalmente (ordem embaralhada)
    combined = pd.concat([df_a, df_b]).sample(frac=1, random_state=0).reset_index(drop=True)
    result = compute_all_features(combined)

    # Cada ticker deve ter features calculadas de forma independente
    tickers = result["ticker"].unique()
    assert set(tickers) == {"PETR4.SA", "VALE3.SA"}

    # RSI de PETR4 não deve ser igual ao RSI de VALE3 (séries diferentes)
    rsi_petr = result[result["ticker"] == "PETR4.SA"]["rsi"].values
    rsi_vale = result[result["ticker"] == "VALE3.SA"]["rsi"].values
    assert not np.allclose(rsi_petr[:len(rsi_vale)], rsi_vale[:len(rsi_petr)])


def test_empty_dataframe_passthrough():
    import pandas as pd
    from config import REQUIRED_COLUMNS
    empty = pd.DataFrame(columns=REQUIRED_COLUMNS)
    result = compute_all_features(empty)
    assert result.empty


def test_output_rows_less_than_input():
    df = _make_price_df(n=60)
    result = compute_all_features(df)
    # Período de aquecimento máximo = 26 (MACD longa) → sempre menos linhas
    assert len(result) < len(df)
    assert len(result) > 0
