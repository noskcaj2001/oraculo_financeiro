"""
Inferência: gera sinais para o dia mais recente de cada ticker
e persiste na tabela `signals` do Supabase.
"""
import logging
import pickle
from datetime import date
from pathlib import Path

import pandas as pd

from ml.features import load_features, FEATURE_COLS
from storage import supabase_client as supa

logger = logging.getLogger(__name__)

MODEL_DIR = Path("ml/models")


def _load_bundle(version: str = "v1") -> dict:
    path = MODEL_DIR / f"xgboost_{version}.pkl"
    if not path.exists():
        raise FileNotFoundError(f"Modelo não encontrado: {path}. Execute ml/train.py primeiro.")
    with open(path, "rb") as f:
        return pickle.load(f)


def generate_signals(version: str = "v1") -> pd.DataFrame:
    """
    Gera um sinal para o pregão mais recente de cada ticker.
    Retorna DataFrame com colunas: ticker, date, signal, confidence, model_version.
    """
    bundle = _load_bundle(version)
    model  = bundle["model"]
    le     = bundle["label_encoder"]

    df = load_features()
    if df.empty:
        raise RuntimeError("Sem dados para gerar sinais.")

    # Pegar apenas o último dia disponível por ticker
    latest = (
        df.sort_values("date")
        .groupby("ticker")
        .last()
        .reset_index()
    )

    X = latest[FEATURE_COLS].values
    y_pred       = model.predict(X)
    y_proba      = model.predict_proba(X)
    confidence   = y_proba.max(axis=1)
    signal_labels = le.inverse_transform(y_pred)

    signals = pd.DataFrame({
        "ticker":        latest["ticker"].values,
        "date":          latest["date"].dt.date,
        "signal":        signal_labels,
        "confidence":    confidence.round(4),
        "model_version": version,
    })

    logger.info(f"Sinais gerados para {len(signals)} tickers (modelo {version})")
    return signals


def run_inference(version: str = "v1") -> pd.DataFrame:
    """
    Gera sinais e persiste no Supabase. Retorna o DataFrame de sinais.
    """
    signals = generate_signals(version=version)
    supa.upsert_signals(signals)
    logger.info(f"Sinais persistidos no Supabase: {len(signals)} registros")
    return signals


if __name__ == "__main__":
    signals = run_inference(version="v1")
    print(signals[["ticker", "date", "signal", "confidence"]].to_string(index=False))
