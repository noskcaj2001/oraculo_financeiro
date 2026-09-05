import logging
import numpy as np
import pandas as pd
import ta

logger = logging.getLogger(__name__)


def add_rsi(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    df = df.copy()
    df["rsi"] = ta.momentum.RSIIndicator(close=df["close"], window=period).rsi()
    return df


def add_macd(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    macd = ta.trend.MACD(close=df["close"])
    df["macd"] = macd.macd()
    df["macd_signal"] = macd.macd_signal()
    df["macd_diff"] = macd.macd_diff()
    return df


def add_bollinger(df: pd.DataFrame, period: int = 20) -> pd.DataFrame:
    df = df.copy()
    bb = ta.volatility.BollingerBands(close=df["close"], window=period)
    df["bb_upper"] = bb.bollinger_hband()
    df["bb_middle"] = bb.bollinger_mavg()
    df["bb_lower"] = bb.bollinger_lband()
    return df


def add_volatility(df: pd.DataFrame, period: int = 20) -> pd.DataFrame:
    df = df.copy()
    log_returns = np.log(df["close"] / df["close"].shift(1))
    df["volatility_20d"] = log_returns.rolling(window=period).std()
    return df


def _apply_features(group: pd.DataFrame) -> pd.DataFrame:
    group = group.sort_values("date").reset_index(drop=True)
    group = add_rsi(group)
    group = add_macd(group)
    group = add_bollinger(group)
    group = add_volatility(group)
    return group


def compute_all_features(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    # Garantir tipos corretos antes de calcular indicadores
    df = df.copy()
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    df["open"]  = pd.to_numeric(df["open"],  errors="coerce")
    df["high"]  = pd.to_numeric(df["high"],  errors="coerce")
    df["low"]   = pd.to_numeric(df["low"],   errors="coerce")

    frames = [_apply_features(group) for _, group in df.groupby("ticker")]
    result = pd.concat(frames, ignore_index=True)

    # Remover linhas com NaN produzidos pelo período de aquecimento
    feature_cols = ["rsi", "macd", "macd_signal", "macd_diff",
                    "bb_upper", "bb_middle", "bb_lower", "volatility_20d"]
    before = len(result)
    result = result.dropna(subset=feature_cols).reset_index(drop=True)
    dropped = before - len(result)
    if dropped:
        logger.info(f"Removidas {dropped} linhas de aquecimento (NaN em features)")

    return result
