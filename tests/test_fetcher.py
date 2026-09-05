from datetime import date
from unittest.mock import patch, MagicMock
import pandas as pd
import pytest

from config import REQUIRED_COLUMNS
from data.ingestion.b3_fetcher import fetch_prices, fetch_all_tickers


def _make_raw_df() -> pd.DataFrame:
    idx = pd.date_range("2024-01-02", periods=5, freq="B")
    return pd.DataFrame(
        {
            "Open":   [10.0, 11.0, 10.5, 12.0, 11.5],
            "High":   [11.0, 12.0, 11.5, 13.0, 12.5],
            "Low":    [9.5,  10.5, 10.0, 11.5, 11.0],
            "Close":  [10.5, 11.5, 11.0, 12.5, 12.0],
            "Volume": [1000,  2000,  1500,  3000,  2500],
        },
        index=idx,
    )


@patch("data.ingestion.b3_fetcher.yf.download")
def test_fetch_returns_required_columns(mock_dl):
    mock_dl.return_value = _make_raw_df()
    df = fetch_prices("PETR4.SA", start="2024-01-01", end="2024-01-31")
    assert list(df.columns) == REQUIRED_COLUMNS


@patch("data.ingestion.b3_fetcher.yf.download")
def test_fetch_returns_dataframe_on_error(mock_dl):
    mock_dl.side_effect = Exception("network error")
    df = fetch_prices("PETR4.SA", start="2024-01-01", end="2024-01-31")
    assert isinstance(df, pd.DataFrame)
    assert list(df.columns) == REQUIRED_COLUMNS
    assert df.empty


@patch("data.ingestion.b3_fetcher.yf.download")
def test_fetch_adds_sa_suffix(mock_dl):
    mock_dl.return_value = _make_raw_df()
    df = fetch_prices("PETR4", start="2024-01-01", end="2024-01-31")
    assert (df["ticker"] == "PETR4.SA").all()


@patch("data.ingestion.b3_fetcher.yf.download")
def test_fetch_date_column_is_date_type(mock_dl):
    mock_dl.return_value = _make_raw_df()
    df = fetch_prices("VALE3.SA", start="2024-01-01", end="2024-01-31")
    assert df["date"].dtype == object  # date objects stored as object dtype
    assert isinstance(df["date"].iloc[0], date)


@patch("data.ingestion.b3_fetcher.yf.download")
def test_fetch_all_tickers_concatenates(mock_dl):
    mock_dl.return_value = _make_raw_df()
    df = fetch_all_tickers(start="2024-01-01", end="2024-01-31")
    assert list(df.columns) == REQUIRED_COLUMNS
    # 10 tickers × 5 linhas cada
    assert len(df) == 50


@patch("data.ingestion.b3_fetcher.yf.download")
def test_fetch_all_tickers_skips_empty(mock_dl):
    mock_dl.side_effect = [_make_raw_df()] + [pd.DataFrame()] * 9
    df = fetch_all_tickers(start="2024-01-01", end="2024-01-31")
    assert len(df) == 5
