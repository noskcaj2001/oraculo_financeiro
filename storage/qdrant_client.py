import logging
import os
from typing import Optional
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

from config import QDRANT_HOST, QDRANT_PORT, QDRANT_COLLECTION

logger = logging.getLogger(__name__)

VECTOR_SIZE = 1536  # text-embedding-3-small

# Caminho para armazenamento local persistente (usado quando Docker não está disponível)
QDRANT_LOCAL_PATH = os.getenv("QDRANT_LOCAL_PATH", "./qdrant_data")

_client: Optional[QdrantClient] = None


def get_client() -> QdrantClient:
    global _client
    if _client is not None:
        return _client

    # Tenta conectar ao Docker; se falhar, usa armazenamento local em disco
    try:
        c = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT, timeout=2)
        c.get_collections()  # verifica conectividade
        _client = c
        logger.info(f"Qdrant conectado via Docker ({QDRANT_HOST}:{QDRANT_PORT}).")
    except Exception:
        logger.warning(
            "Qdrant Docker indisponível — usando armazenamento local em disco: "
            f"'{QDRANT_LOCAL_PATH}'"
        )
        _client = QdrantClient(path=QDRANT_LOCAL_PATH)

    return _client


def ensure_collection() -> None:
    client = get_client()
    existing = [c.name for c in client.get_collections().collections]
    if QDRANT_COLLECTION in existing:
        logger.info(f"Coleção '{QDRANT_COLLECTION}' já existe.")
        return
    client.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
    )
    logger.info(f"Coleção '{QDRANT_COLLECTION}' criada (dim={VECTOR_SIZE}, cosine).")


def upsert_points(points: list[PointStruct]) -> None:
    client = get_client()
    client.upsert(collection_name=QDRANT_COLLECTION, points=points)
    logger.info(f"Upsert de {len(points)} vetores em '{QDRANT_COLLECTION}'.")


def search(
    query_vector: list[float],
    top_k: int = 5,
    ticker_filter: Optional[str] = None,
    doc_type_filter: Optional[str] = None,
    min_week_start: Optional[str] = None,
) -> list[dict]:
    """
    min_week_start: string ISO "YYYY-MM-DD" — filtra price_summary por data (pós-processamento,
    pois Qdrant Range só aceita numéricos).
    """
    from qdrant_client.models import Filter, FieldCondition, MatchValue

    client = get_client()
    conditions = []

    if ticker_filter:
        conditions.append(FieldCondition(key="ticker", match=MatchValue(value=ticker_filter)))
    if doc_type_filter:
        conditions.append(FieldCondition(key="doc_type", match=MatchValue(value=doc_type_filter)))

    query_filter = Filter(must=conditions) if conditions else None

    # Busca mais resultados quando há filtro de data para compensar os excluídos
    fetch_limit = top_k * 4 if min_week_start else top_k

    results = client.query_points(
        collection_name=QDRANT_COLLECTION,
        query=query_vector,
        query_filter=query_filter,
        limit=fetch_limit,
    ).points

    docs = [{"id": str(r.id), "score": r.score, **r.payload} for r in results]

    if min_week_start:
        docs = [
            d for d in docs
            if (d.get("week_start") or "") >= min_week_start
        ]

    return docs[:top_k]


def collection_count() -> int:
    return get_client().count(QDRANT_COLLECTION).count
