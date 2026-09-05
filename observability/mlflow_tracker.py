import time
import logging
import mlflow

from config import MLFLOW_TRACKING_URI

logger = logging.getLogger(__name__)

mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)


def log_ml_training(
    model_name: str,
    ticker: str,
    version: str,
    params: dict,
    metrics: dict,
) -> None:
    with mlflow.start_run(run_name=f"{model_name}_{ticker}_{version}"):
        mlflow.log_params(params)
        mlflow.log_metrics(metrics)
        mlflow.set_tag("ticker", ticker)
        mlflow.set_tag("phase", "training")


class RagTimer:
    """Context manager para medir latência de chamadas RAG."""

    def __init__(
        self,
        prompt_version: str,
        llm_model: str,
        ticker_filter: str | None = None,
    ):
        self.prompt_version = prompt_version
        self.llm_model = llm_model
        self.ticker_filter = ticker_filter
        self._start: float = 0.0
        self.latency_ms: float = 0.0

    def __enter__(self):
        self._start = time.perf_counter()
        return self

    def __exit__(self, *_):
        self.latency_ms = (time.perf_counter() - self._start) * 1000
