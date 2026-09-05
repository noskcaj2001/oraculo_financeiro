import logging
from datetime import date, timedelta
from typing import Optional

import mlflow
from openai import OpenAI

from config import OPENAI_API_KEY
from storage import qdrant_client as qdrant

logger = logging.getLogger(__name__)

EMBED_MODEL = "text-embedding-3-small"
# Janela de recência para price_summary: busca apenas últimas N semanas
PRICE_SUMMARY_LOOKBACK_DAYS = 90

_openai: OpenAI | None = None


def _get_openai() -> OpenAI:
    global _openai
    if _openai is None:
        _openai = OpenAI(api_key=OPENAI_API_KEY)
    return _openai


@mlflow.trace(span_type="EMBEDDING", name="embed_query")
def embed_query(text: str) -> list[float]:
    response = _get_openai().embeddings.create(model=EMBED_MODEL, input=[text])
    return response.data[0].embedding


@mlflow.trace(span_type="RETRIEVER", name="vector_search")
def retrieve(
    question: str,
    top_k: int = 5,
    ticker_filter: Optional[str] = None,
) -> list[dict]:
    """
    Busca os documentos mais relevantes no Qdrant para a pergunta dada.

    Price summaries são filtrados por recência (últimos 90 dias) para evitar que
    dados históricos de alta volatilidade superem dados atuais por similaridade semântica.
    News articles são buscados sem filtro de data (pipeline já garante recência).

    Retorna lista de dicts com 'text', 'ticker', 'period', 'score'.
    """
    vector = embed_query(question)

    min_week_start = str(date.today() - timedelta(days=PRICE_SUMMARY_LOOKBACK_DAYS))
    half_k = max(top_k // 2, 2)

    # Busca 1: price_summary recentes
    price_docs = qdrant.search(
        vector,
        top_k=half_k + 1,
        ticker_filter=ticker_filter,
        doc_type_filter="price_summary",
        min_week_start=min_week_start,
    )

    # Busca 2: news_article (recência garantida pelo pipeline de ingestão)
    news_docs = qdrant.search(
        vector,
        top_k=half_k,
        ticker_filter=ticker_filter,
        doc_type_filter="news_article",
    )

    # Combina, remove duplicatas por id e ordena por score
    seen: set[str] = set()
    combined: list[dict] = []
    for doc in price_docs + news_docs:
        if doc["id"] not in seen:
            seen.add(doc["id"])
            combined.append(doc)

    results = sorted(combined, key=lambda d: d["score"], reverse=True)[:top_k]

    logger.info(
        f"Recuperados {len(results)} documentos (price={len(price_docs)}, "
        f"news={len(news_docs)}, ticker_filter={ticker_filter!r}, "
        f"min_week_start={min_week_start})"
    )
    return results


def format_context(docs: list[dict]) -> str:
    parts = []
    for i, doc in enumerate(docs, start=1):
        parts.append(f"[{i}] {doc.get('text', '')}")
    return "\n\n".join(parts)
