from __future__ import annotations

from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from storage.supabase_client import get_client
from backend.modules.personal_finance.categories import (
    CATEGORIES,
    CATEGORY_SLUGS,
    normalize_merchant,
)

logger = structlog.get_logger()

router = APIRouter(prefix="/api", tags=["transactions"])


# ── Schemas ────────────────────────────────────────────────────────────────

class CategoriaItem(BaseModel):
    slug: str
    label: str


class CategoriaPatch(BaseModel):
    categoria: str


class TransactionRow(BaseModel):
    id: str
    invoice_id: str
    data: str
    descricao: str
    estabelecimento: str
    categoria: str
    valor: float
    parcela_atual: int
    total_parcelas: int
    estorno: bool


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/categorias", response_model=list[CategoriaItem])
async def list_categorias() -> list[CategoriaItem]:
    return [CategoriaItem(slug=s, label=l) for s, l in CATEGORIES.items()]


@router.patch("/transactions/{transaction_id}", response_model=TransactionRow)
async def patch_transaction_categoria(transaction_id: str, body: CategoriaPatch) -> TransactionRow:
    """Corrige a categoria de uma transação e fixa a regra para o estabelecimento.

    A correção vira um verbete `origem='manual'` em `merchant_categories`, que
    tem precedência sobre IA/histórico nas próximas faturas.
    """
    if body.categoria not in CATEGORY_SLUGS:
        raise HTTPException(status_code=422, detail=f"categoria inválida: {body.categoria}")

    client = get_client()

    try:
        upd = (
            client.table("transactions")
            .update({"categoria": body.categoria})
            .eq("id", transaction_id)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("patch_transaction_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    if not upd.data:
        raise HTTPException(status_code=404, detail="transação não encontrada")

    row = upd.data[0]

    # memória: fixa a categoria para o comerciante
    key = normalize_merchant(row.get("estabelecimento") or row.get("descricao") or "")
    if key:
        try:
            client.table("merchant_categories").upsert(
                {
                    "merchant_key": key,
                    "categoria": body.categoria,
                    "origem": "manual",
                    "confianca": 1.0,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                on_conflict="merchant_key",
            ).execute()
        except Exception as exc:  # noqa: BLE001
            logger.warning("merchant_categories upsert (manual) falhou", error=str(exc))

    logger.info(
        "transaction_recategorizada",
        id=transaction_id,
        categoria=body.categoria,
        merchant_key=key,
    )
    return TransactionRow(**row)
