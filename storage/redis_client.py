"""
Wrapper Redis com fallback gracioso.
Se Redis estiver indisponível, get_quote() retorna None e set_quote() é no-op.
O caller decide o fallback — nenhum erro propagado para o usuário.
"""
import json
import logging
import os

import redis as redis_lib

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

_client: redis_lib.Redis | None = None
_unavailable: bool = False


def get_client() -> redis_lib.Redis | None:
    global _client, _unavailable
    if _unavailable:
        return None
    if _client is not None:
        return _client
    try:
        c = redis_lib.from_url(REDIS_URL, socket_connect_timeout=1, decode_responses=True)
        c.ping()
        _client = c
        logger.info(f"Redis conectado em {REDIS_URL}")
    except Exception as exc:
        _unavailable = True
        logger.warning(f"Redis indisponível ({exc}) — cache desativado, usando yfinance direto.")
    return _client


def get_quote(ticker: str) -> dict | None:
    client = get_client()
    if client is None:
        return None
    try:
        raw = client.get(f"quote:{ticker}")
        return json.loads(raw) if raw else None
    except Exception:
        return None


def set_quote(ticker: str, data: dict, ttl: int = 60) -> None:
    client = get_client()
    if client is None:
        return
    try:
        client.set(f"quote:{ticker}", json.dumps(data), ex=ttl)
    except Exception:
        pass
