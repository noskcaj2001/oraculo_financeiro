"""
Treino do modelo XGBoost baseline para geração de sinais de compra/venda.
Métricas completas: accuracy, precision, recall, F1, ROC-AUC, matriz de confusão.
"""
import logging
import pickle
import tempfile
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import mlflow
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    ConfusionMatrixDisplay,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
    auc,
)
from sklearn.preprocessing import LabelEncoder, label_binarize
from xgboost import XGBClassifier

from config import MLFLOW_TRACKING_URI
from ml.features import build_training_set, FEATURE_COLS

logger = logging.getLogger(__name__)

mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)

MODEL_DIR = Path("ml/models")
MODEL_DIR.mkdir(parents=True, exist_ok=True)

LABEL_ORDER = ["compra", "neutro", "venda"]

XGBOOST_PARAMS = {
    "n_estimators":     200,
    "max_depth":        4,
    "learning_rate":    0.05,
    "subsample":        0.8,
    "colsample_bytree": 0.8,
    "eval_metric":      "mlogloss",
    "random_state":     42,
    "n_jobs":           -1,
}


# ---------------------------------------------------------------------------
# Figuras de avaliação
# ---------------------------------------------------------------------------

def _plot_confusion_matrix(y_true, y_pred, class_names: list[str]) -> plt.Figure:
    cm  = confusion_matrix(y_true, y_pred)
    fig, ax = plt.subplots(figsize=(6, 5))
    disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=class_names)
    disp.plot(ax=ax, colorbar=True, cmap="Blues")
    ax.set_title("Matriz de Confusão — Oráculo Sinais")
    fig.tight_layout()
    return fig


def _plot_roc_curves(y_true_bin, y_proba, class_names: list[str]) -> plt.Figure:
    """ROC One-vs-Rest para problema multi-classe."""
    fig, ax = plt.subplots(figsize=(7, 6))
    colors = ["#2ecc71", "#3498db", "#e74c3c"]

    for i, (cls, color) in enumerate(zip(class_names, colors)):
        fpr, tpr, _ = roc_curve(y_true_bin[:, i], y_proba[:, i])
        roc_auc     = auc(fpr, tpr)
        ax.plot(fpr, tpr, color=color, lw=2, label=f"{cls} (AUC = {roc_auc:.3f})")

    ax.plot([0, 1], [0, 1], "k--", lw=1.2, label="Aleatório (AUC = 0.500)")
    ax.set_xlim([0.0, 1.0])
    ax.set_ylim([0.0, 1.05])
    ax.set_xlabel("Taxa de Falso Positivo")
    ax.set_ylabel("Taxa de Verdadeiro Positivo")
    ax.set_title("Curva ROC — One-vs-Rest por classe de sinal")
    ax.legend(loc="lower right")
    fig.tight_layout()
    return fig


def _plot_feature_importance(model: XGBClassifier, feature_names: list[str]) -> plt.Figure:
    importance = model.feature_importances_
    sorted_idx = np.argsort(importance)
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.barh(
        [feature_names[i] for i in sorted_idx],
        importance[sorted_idx],
        color="#3498db",
    )
    ax.set_xlabel("Importância (ganho)")
    ax.set_title("Importância das Features — XGBoost")
    fig.tight_layout()
    return fig


# ---------------------------------------------------------------------------
# Treino principal
# ---------------------------------------------------------------------------

def train(version: str = "v1") -> dict:
    """
    Treina XGBoost com todos os tickers MVP e loga métricas completas no MLflow.
    Retorna dict com métricas e caminho do modelo salvo.
    """
    logger.info("Carregando feature store...")
    df = build_training_set()
    if df.empty:
        raise RuntimeError("Feature store vazia. Execute o backfill primeiro.")

    le = LabelEncoder()
    le.fit(LABEL_ORDER)

    df_sorted  = df.sort_values("date")
    split_idx  = int(len(df_sorted) * 0.8)

    X      = df_sorted[FEATURE_COLS].values
    y      = le.transform(df_sorted["label"].values)
    X_train, y_train = X[:split_idx], y[:split_idx]
    X_test,  y_test  = X[split_idx:], y[split_idx:]

    model = XGBClassifier(**XGBOOST_PARAMS)

    mlflow.set_experiment("oraculo_sinais")
    with mlflow.start_run(run_name=f"xgboost_{version}"):

        model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

        y_pred  = model.predict(X_test)
        y_proba = model.predict_proba(X_test)

        # --- Binarização para ROC multi-classe (OvR) ---
        y_test_bin = label_binarize(y_test, classes=[0, 1, 2])

        # --- Métricas escalares ---
        acc         = accuracy_score(y_test, y_pred)
        report_dict = classification_report(
            y_test, y_pred, target_names=le.classes_, output_dict=True
        )

        metrics = {
            # Globais
            "accuracy":            round(acc, 4),
            "f1_macro":            round(f1_score(y_test, y_pred, average="macro"),    4),
            "f1_weighted":         round(f1_score(y_test, y_pred, average="weighted"), 4),
            "precision_macro":     round(precision_score(y_test, y_pred, average="macro",    zero_division=0), 4),
            "precision_weighted":  round(precision_score(y_test, y_pred, average="weighted", zero_division=0), 4),
            "recall_macro":        round(recall_score(y_test, y_pred, average="macro",    zero_division=0), 4),
            "recall_weighted":     round(recall_score(y_test, y_pred, average="weighted", zero_division=0), 4),
            "roc_auc_macro_ovr":   round(roc_auc_score(y_test_bin, y_proba, multi_class="ovr", average="macro"), 4),
            # Por classe
            **{f"precision_{cls}":  round(report_dict[cls]["precision"], 4) for cls in LABEL_ORDER},
            **{f"recall_{cls}":     round(report_dict[cls]["recall"],    4) for cls in LABEL_ORDER},
            **{f"f1_{cls}":         round(report_dict[cls]["f1-score"],  4) for cls in LABEL_ORDER},
            **{f"roc_auc_{cls}":    round(auc(*roc_curve(y_test_bin[:, i], y_proba[:, i])[:2]), 4)
               for i, cls in enumerate(LABEL_ORDER)},
            # Tamanhos
            "train_samples": int(len(X_train)),
            "test_samples":  int(len(X_test)),
        }

        params = {**XGBOOST_PARAMS, "version": version, "split_ratio": "80/20"}
        mlflow.log_params(params)
        mlflow.log_metrics(metrics)
        mlflow.set_tag("phase", "training")
        mlflow.set_tag("tickers", "all_mvp")
        mlflow.set_tag("features", str(FEATURE_COLS))

        # --- Artefatos visuais ---
        with tempfile.TemporaryDirectory() as tmp:
            fig_cm = _plot_confusion_matrix(y_test, y_pred, list(le.classes_))
            path_cm = f"{tmp}/confusion_matrix.png"
            fig_cm.savefig(path_cm, dpi=120)
            plt.close(fig_cm)
            mlflow.log_artifact(path_cm, artifact_path="plots")

            fig_roc = _plot_roc_curves(y_test_bin, y_proba, list(le.classes_))
            path_roc = f"{tmp}/roc_curves.png"
            fig_roc.savefig(path_roc, dpi=120)
            plt.close(fig_roc)
            mlflow.log_artifact(path_roc, artifact_path="plots")

            fig_fi = _plot_feature_importance(model, FEATURE_COLS)
            path_fi = f"{tmp}/feature_importance.png"
            fig_fi.savefig(path_fi, dpi=120)
            plt.close(fig_fi)
            mlflow.log_artifact(path_fi, artifact_path="plots")

        # --- Salvar modelo + encoder ---
        model_path = MODEL_DIR / f"xgboost_{version}.pkl"
        with open(model_path, "wb") as f:
            pickle.dump({"model": model, "label_encoder": le, "version": version}, f)
        mlflow.log_artifact(str(model_path), artifact_path="model")

        run_id = mlflow.active_run().info.run_id

    logger.info(f"Treino concluído | acc={acc:.4f} roc_auc={metrics['roc_auc_macro_ovr']} | run_id={run_id}")
    print(classification_report(y_test, y_pred, target_names=le.classes_))
    print(f"ROC-AUC macro OvR: {metrics['roc_auc_macro_ovr']}")
    return {"metrics": metrics, "model_path": str(model_path), "run_id": run_id}


if __name__ == "__main__":
    result = train(version="v2")
    print(f"\nMétricas salvas no MLflow: {result['metrics']}")
