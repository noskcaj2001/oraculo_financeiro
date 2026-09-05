"""
Backtesting simples: avalia o modelo em janelas temporais walk-forward.
"""
import logging
import pickle
from pathlib import Path

import mlflow
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, classification_report

from config import MLFLOW_TRACKING_URI
from ml.features import build_training_set, FEATURE_COLS

logger = logging.getLogger(__name__)

mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)

MODEL_DIR = Path("ml/models")


def run_backtesting(version: str = "v1", n_splits: int = 3) -> dict:
    """
    Walk-forward backtesting com n_splits janelas temporais.
    Cada janela usa os dados anteriores para treino e a janela seguinte para teste.
    Loga resultados no MLflow.
    """
    model_path = MODEL_DIR / f"xgboost_{version}.pkl"
    if not model_path.exists():
        raise FileNotFoundError(f"Modelo não encontrado: {model_path}. Execute train.py primeiro.")

    with open(model_path, "rb") as f:
        bundle = pickle.load(f)

    model = bundle["model"]
    le    = bundle["label_encoder"]

    logger.info("Carregando feature store para backtesting...")
    df = build_training_set()
    if df.empty:
        raise RuntimeError("Feature store vazia.")

    df = df.sort_values("date").reset_index(drop=True)
    X  = df[FEATURE_COLS].values
    y  = le.transform(df["label"].values)

    # Dividir em n_splits+1 janelas temporais iguais
    fold_size = len(df) // (n_splits + 1)
    folds_metrics = []

    mlflow.set_experiment("oraculo_sinais")
    with mlflow.start_run(run_name=f"backtesting_{version}"):
        for i in range(n_splits):
            test_start = (i + 1) * fold_size
            test_end   = test_start + fold_size
            X_test_fold = X[test_start:test_end]
            y_test_fold = y[test_start:test_end]

            if len(X_test_fold) == 0:
                continue

            y_pred = model.predict(X_test_fold)
            acc    = accuracy_score(y_test_fold, y_pred)
            report = classification_report(
                y_test_fold, y_pred,
                target_names=le.classes_,
                output_dict=True,
                zero_division=0,
            )

            fold_m = {
                f"fold{i+1}_accuracy":         round(acc, 4),
                f"fold{i+1}_f1_compra":        round(report["compra"]["f1-score"], 4),
                f"fold{i+1}_f1_venda":         round(report["venda"]["f1-score"],  4),
                f"fold{i+1}_precision_compra": round(report["compra"]["precision"], 4),
                f"fold{i+1}_precision_venda":  round(report["venda"]["precision"],  4),
            }
            folds_metrics.append(fold_m)
            mlflow.log_metrics(fold_m)

            date_range = (
                str(df.iloc[test_start]["date"])[:10],
                str(df.iloc[test_end - 1]["date"])[:10],
            )
            logger.info(f"Fold {i+1} [{date_range[0]} → {date_range[1]}]: acc={acc:.4f}")

        # Média das métricas
        avg_acc = np.mean([m[f"fold{i+1}_accuracy"] for i, m in enumerate(folds_metrics)])
        mlflow.log_metric("avg_accuracy", round(avg_acc, 4))
        mlflow.set_tag("phase", "backtesting")
        mlflow.set_tag("model_version", version)
        run_id = mlflow.active_run().info.run_id

    logger.info(f"Backtesting concluído | acc_média={avg_acc:.4f} | run_id={run_id}")
    return {"folds": folds_metrics, "avg_accuracy": avg_acc, "run_id": run_id}


if __name__ == "__main__":
    result = run_backtesting(version="v1")
    print(f"\nAcurácia média: {result['avg_accuracy']:.4f}")
    for fold in result["folds"]:
        print(fold)
