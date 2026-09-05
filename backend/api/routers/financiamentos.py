from __future__ import annotations

from datetime import date

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from storage.supabase_client import get_client

logger = structlog.get_logger()

router = APIRouter(prefix="/api/financiamentos", tags=["financiamentos"])

_TIPOS_VALIDOS = {"imovel", "veiculo", "outro"}


# ── Schemas ────────────────────────────────────────────────────────────────

class FinanciamentoCreate(BaseModel):
    descricao: str
    tipo: str
    banco: str | None = None
    valor_total: float
    saldo_devedor: float
    taxa_mensal: float
    parcela_mensal: float
    data_inicio: str | None = None
    vencimento_estimado: str | None = None
    ativo: bool = True


class FinanciamentoUpdate(BaseModel):
    descricao: str | None = None
    banco: str | None = None
    saldo_devedor: float | None = None
    parcela_mensal: float | None = None
    vencimento_estimado: str | None = None
    ativo: bool | None = None


class FinanciamentoItem(BaseModel):
    id: str
    descricao: str
    tipo: str
    banco: str | None
    valor_total: float
    saldo_devedor: float
    taxa_mensal: float
    parcela_mensal: float
    data_inicio: str | None
    vencimento_estimado: str | None
    ativo: bool
    meses_restantes: int | None
    created_at: str


# ── Helpers ────────────────────────────────────────────────────────────────

def _calc_meses_restantes(vencimento_estimado: str | None) -> int | None:
    if not vencimento_estimado:
        return None
    try:
        venc = date.fromisoformat(vencimento_estimado)
        hoje = date.today()
        if venc <= hoje:
            return 0
        delta_meses = (venc.year - hoje.year) * 12 + (venc.month - hoje.month)
        return max(0, delta_meses)
    except ValueError:
        return None


def _to_item(row: dict) -> FinanciamentoItem:
    return FinanciamentoItem(
        **{k: row.get(k) for k in FinanciamentoItem.model_fields if k != "meses_restantes"},
        meses_restantes=_calc_meses_restantes(row.get("vencimento_estimado")),
    )


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("", response_model=list[FinanciamentoItem])
async def list_financiamentos(
    ativo: bool | None = Query(default=None),
) -> list[FinanciamentoItem]:
    try:
        client = get_client()
        q = client.table("financiamentos").select("*").order("created_at", desc=False)
        if ativo is not None:
            q = q.eq("ativo", ativo)
        resp = q.execute()
    except Exception as exc:
        logger.error("financiamentos_list_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
    return [_to_item(r) for r in (resp.data or [])]


@router.post("", response_model=FinanciamentoItem, status_code=201)
async def create_financiamento(body: FinanciamentoCreate) -> FinanciamentoItem:
    if body.tipo not in _TIPOS_VALIDOS:
        raise HTTPException(status_code=422, detail=f"tipo inválido: {body.tipo}")
    if body.valor_total <= 0 or body.saldo_devedor < 0 or body.taxa_mensal <= 0 or body.parcela_mensal <= 0:
        raise HTTPException(status_code=422, detail="valores financeiros devem ser positivos")

    try:
        client = get_client()
        resp = (
            client.table("financiamentos")
            .insert(body.model_dump(exclude_none=False))
            .execute()
        )
    except Exception as exc:
        logger.error("financiamentos_create_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    row = resp.data[0]
    logger.info("financiamento_criado", id=row["id"], descricao=body.descricao, saldo=body.saldo_devedor)
    return _to_item(row)


@router.put("/{item_id}", response_model=FinanciamentoItem)
async def update_financiamento(item_id: str, body: FinanciamentoUpdate) -> FinanciamentoItem:
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=422, detail="nenhum campo para atualizar")

    try:
        client = get_client()
        resp = (
            client.table("financiamentos")
            .update(updates)
            .eq("id", item_id)
            .execute()
        )
    except Exception as exc:
        logger.error("financiamentos_update_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    if not resp.data:
        raise HTTPException(status_code=404, detail="financiamento não encontrado")
    return _to_item(resp.data[0])


@router.delete("/{item_id}")
async def delete_financiamento(item_id: str) -> dict:
    try:
        client = get_client()
        client.table("financiamentos").delete().eq("id", item_id).execute()
    except Exception as exc:
        logger.error("financiamentos_delete_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
    logger.info("financiamento_deletado", id=item_id)
    return {"ok": True}
