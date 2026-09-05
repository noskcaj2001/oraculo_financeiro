from __future__ import annotations

import re
from datetime import date

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from storage.supabase_client import get_client

logger = structlog.get_logger()

_MES_RE = re.compile(r"^\d{4}-\d{2}$")

_CATEGORIAS = {
    "moradia", "condominio", "iptu", "saude", "academia",
    "streaming", "transporte", "educacao", "seguro",
    "alimentacao", "lazer", "compras", "servicos", "viagem", "outros",
}


def _current_mes() -> str:
    today = date.today()
    return f"{today.year}-{today.month:02d}"


# ── Schemas ────────────────────────────────────────────────────────────────

class GastoFixoCreate(BaseModel):
    descricao: str
    categoria: str = "outros"
    valor: float
    ativo: bool = True


class GastoFixoUpdate(BaseModel):
    descricao: str | None = None
    categoria: str | None = None
    valor: float | None = None
    ativo: bool | None = None


class GastoFixoItem(BaseModel):
    id: str
    descricao: str
    categoria: str
    valor: float
    ativo: bool
    created_at: str


class GastoPontualCreate(BaseModel):
    mes: str
    descricao: str
    categoria: str = "outros"
    valor: float


class GastoPontualItem(BaseModel):
    id: str
    mes: str
    descricao: str
    categoria: str
    valor: float
    created_at: str


# ── Routers ────────────────────────────────────────────────────────────────

router_fixos = APIRouter(prefix="/api/gastos-fixos", tags=["gastos"])
router_pontuais = APIRouter(prefix="/api/gastos-pontuais", tags=["gastos"])


# ── Gastos Fixos (tipo='recorrente' em fixed_expenses) ─────────────────────

@router_fixos.get("", response_model=list[GastoFixoItem])
async def list_gastos_fixos(
    ativo: bool | None = Query(default=None),
) -> list[GastoFixoItem]:
    try:
        client = get_client()
        q = (
            client.table("fixed_expenses")
            .select("id, descricao, categoria, valor, ativo, created_at")
            .eq("tipo", "recorrente")
            .order("categoria")
            .order("descricao")
        )
        if ativo is not None:
            q = q.eq("ativo", ativo)
        resp = q.execute()
    except Exception as exc:
        logger.error("gastos_fixos_list_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
    return [GastoFixoItem(**r) for r in (resp.data or [])]


@router_fixos.post("", response_model=GastoFixoItem, status_code=201)
async def create_gasto_fixo(body: GastoFixoCreate) -> GastoFixoItem:
    if body.valor <= 0:
        raise HTTPException(status_code=422, detail="valor deve ser positivo")

    try:
        client = get_client()
        resp = (
            client.table("fixed_expenses")
            .insert({
                "descricao": body.descricao,
                "categoria": body.categoria,
                "valor": body.valor,
                "tipo": "recorrente",
                "ativo": body.ativo,
            })
            .execute()
        )
    except Exception as exc:
        logger.error("gastos_fixos_create_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    row = resp.data[0]
    logger.info("gasto_fixo_criado", id=row["id"], descricao=body.descricao, valor=body.valor)
    return GastoFixoItem(**row)


@router_fixos.put("/{item_id}", response_model=GastoFixoItem)
async def update_gasto_fixo(item_id: str, body: GastoFixoUpdate) -> GastoFixoItem:
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=422, detail="nenhum campo para atualizar")
    if "valor" in updates and updates["valor"] <= 0:
        raise HTTPException(status_code=422, detail="valor deve ser positivo")

    try:
        client = get_client()
        resp = (
            client.table("fixed_expenses")
            .update(updates)
            .eq("id", item_id)
            .eq("tipo", "recorrente")
            .execute()
        )
    except Exception as exc:
        logger.error("gastos_fixos_update_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    if not resp.data:
        raise HTTPException(status_code=404, detail="gasto fixo não encontrado")
    return GastoFixoItem(**resp.data[0])


@router_fixos.delete("/{item_id}")
async def delete_gasto_fixo(item_id: str) -> dict:
    try:
        client = get_client()
        client.table("fixed_expenses").delete().eq("id", item_id).execute()
    except Exception as exc:
        logger.error("gastos_fixos_delete_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
    logger.info("gasto_fixo_deletado", id=item_id)
    return {"ok": True}


# ── Gastos Pontuais (tipo='pontual' em fixed_expenses) ─────────────────────

@router_pontuais.get("", response_model=list[GastoPontualItem])
async def list_gastos_pontuais(
    mes: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
) -> list[GastoPontualItem]:
    if mes is None:
        mes = _current_mes()
    try:
        client = get_client()
        resp = (
            client.table("fixed_expenses")
            .select("id, mes_referencia, descricao, categoria, valor, created_at")
            .eq("tipo", "pontual")
            .eq("mes_referencia", mes)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        logger.error("gastos_pontuais_list_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    return [
        GastoPontualItem(
            id=r["id"],
            mes=r["mes_referencia"],
            descricao=r["descricao"],
            categoria=r["categoria"],
            valor=r["valor"],
            created_at=r["created_at"],
        )
        for r in (resp.data or [])
    ]


@router_pontuais.post("", response_model=GastoPontualItem, status_code=201)
async def create_gasto_pontual(body: GastoPontualCreate) -> GastoPontualItem:
    if not _MES_RE.match(body.mes):
        raise HTTPException(status_code=422, detail="mes deve ser YYYY-MM")
    if body.valor <= 0:
        raise HTTPException(status_code=422, detail="valor deve ser positivo")

    try:
        client = get_client()
        resp = (
            client.table("fixed_expenses")
            .insert({
                "descricao": body.descricao,
                "categoria": body.categoria,
                "valor": body.valor,
                "tipo": "pontual",
                "mes_referencia": body.mes,
                "ativo": True,
            })
            .execute()
        )
    except Exception as exc:
        logger.error("gastos_pontuais_create_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    row = resp.data[0]
    logger.info("gasto_pontual_criado", id=row["id"], mes=body.mes, valor=body.valor)
    return GastoPontualItem(
        id=row["id"],
        mes=row["mes_referencia"],
        descricao=row["descricao"],
        categoria=row["categoria"],
        valor=row["valor"],
        created_at=row["created_at"],
    )


@router_pontuais.delete("/{item_id}")
async def delete_gasto_pontual(item_id: str) -> dict:
    try:
        client = get_client()
        client.table("fixed_expenses").delete().eq("id", item_id).execute()
    except Exception as exc:
        logger.error("gastos_pontuais_delete_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
    logger.info("gasto_pontual_deletado", id=item_id)
    return {"ok": True}
