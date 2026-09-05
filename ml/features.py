"""
Feature store: carrega preços do Supabase, recomputa indicadores técnicos
e devolve um DataFrame pronto para treino/inferência.
"""
import logging
from datetime import date, timedelta

import numpy as np
import pandas as pd

from config import TICKERS_MVP
from storage import supabase_client as supa
from data.processing.feature_engineering import compute_all_features

logger = logging.getLogger(__name__)

# Threshold de retorno para rotular compra/venda (retorno forward 5 pregões)
BUY_THRESHOLD  =  0.02   # +2%
SELL_THRESHOLD = -0.02   # -2%
FORWARD_DAYS   = 5

FEATURE_COLS = [
    "rsi",
    "macd",
    "macd_signal",
    "macd_diff",
    "bb_width",        # (upper - lower) / middle
    "bb_pct",          # (close - lower) / (upper - lower)
    "volatility_20d",
    "return_1d",
    "return_5d",
    "volume_change",
]


def load_features(
    tickers: list[str] | None = None,
    start: str | None = None,
    end: str | None = None,
) -> pd.DataFrame:
    """
    Carrega preços do Supabase, calcula indicadores e retorna feature DataFrame.
    Não inclui label — use build_training_set() para treino.
    """
    tickers = tickers or TICKERS_MVP
    end_date   = date.fromisoformat(end)   if end   else date.today()
    # Carrega janela extra para aquecer os indicadores (mínimo 40 dias antes)
    start_date = date.fromisoformat(start) if start else end_date - timedelta(days=365)
    warmup_start = start_date - timedelta(days=60)

    frames = []
    for ticker in tickers:
        df = supa.fetch_prices(ticker, str(warmup_start), str(end_date))
        if not df.empty:
            frames.append(df)

    if not frames:
        return pd.DataFrame()

    raw = pd.concat(frames, ignore_index=True)
    df  = compute_all_features(raw)

    # Normalizar Bollinger em features relativas
    df["bb_width"]  = (df["bb_upper"] - df["bb_lower"]) / df["bb_middle"]
    df["bb_pct"]    = (df["close"]    - df["bb_lower"]) / (df["bb_upper"] - df["bb_lower"] + 1e-9)

    # Retornos
    df = df.sort_values(["ticker", "date"]).reset_index(drop=True)
    df["return_1d"] = df.groupby("ticker")["close"].pct_change(1)
    df["return_5d"] = df.groupby("ticker")["close"].pct_change(5)
    df["volume_change"] = df.groupby("ticker")["volume"].pct_change(1)

    # Remover período de aquecimento extra
    df["date"] = pd.to_datetime(df["date"])
    df = df[df["date"] >= pd.Timestamp(start_date)].reset_index(drop=True)

    return df.dropna(subset=FEATURE_COLS).reset_index(drop=True)


def build_training_set(
    tickers: list[str] | None = None,
    start: str | None = None,
    end: str | None = None,
) -> pd.DataFrame:
    """
    Retorna feature DataFrame com coluna 'label' (compra / neutro / venda).
    Label baseada no retorno forward de FORWARD_DAYS pregões por ticker.
    Remove as últimas FORWARD_DAYS linhas de cada ticker (sem label futura).
    """
    df = load_features(tickers=tickers, start=start, end=end)
    if df.empty:
        return df

    def _add_label(group: pd.DataFrame) -> pd.DataFrame:
        group = group.sort_values("date").reset_index(drop=True)
        forward_return = group["close"].shift(-FORWARD_DAYS) / group["close"] - 1
        group["forward_return"] = forward_return
        group["label"] = "neutro"
        group.loc[forward_return >= BUY_THRESHOLD,  "label"] = "compra"
        group.loc[forward_return <= SELL_THRESHOLD, "label"] = "venda"
        # Remover linhas sem retorno futuro conhecido
        return group.dropna(subset=["forward_return"])

    result = pd.concat(
        [_add_label(g) for _, g in df.groupby("ticker")],
        ignore_index=True,
    )
    logger.info(
        f"Training set: {len(result)} amostras | "
        f"compra={( result['label']=='compra').sum()} "
        f"neutro={( result['label']=='neutro').sum()} "
        f"venda={( result['label']=='venda').sum()}"
    )
    return result
