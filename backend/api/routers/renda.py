from __future__ import annotations

import re
from datetime import date

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from storage.supabase_client import get_client

logger = structlog.get_logger()

router = APIRouter(prefix="/api/renda", tags=["renda"])

_TIPOS_VALIDOS = {"salario", "plr", "decimo_terceiro", "bonus", "outros"}
_MES_RE = re.compile(r"^\d{4}-\d{2}$")


# ── Schemas ────────────────────────────────────────────────────────────────

class RendaCreate(BaseModel):
    mes: str
    tipo: str
    descricao: str
    valor: float


class RendaItem(BaseModel):
    id: str
    mes: str
    tipo: str
    descricao: str
    valor: float
    created_at: str


class RendaResumo(BaseModel):
    mes: str
    total_renda: float
    total_gastos: float
    saldo: float
    taxa_poupanca: float


# ── Helpers ────────────────────────────────────────────────────────────────

def _mes_boundaries(mes: str) -> tuple[str, str]:
    year, month = mes.split("-")
    first_day = f"{year}-{month}-01"
    next_month = int(month) % 12 + 1
    next_year = int(year) + (1 if next_month == 1 else 0)
    last_day = f"{next_year}-{next_month:02d}-01"
    return first_day, last_day


def _current_mes() -> str:
    today = date.today()
    return f"{today.year}-{today.month:02d}"


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/resumo", response_model=RendaResumo)
async def get_resumo(
    mes: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
) -> RendaResumo:
    if mes is None:
        mes = _current_mes()

    first_day, last_day = _mes_boundaries(mes)
    client = get_client()

    try:
        income_resp = (
            client.table("income_entries")
            .select("valor")
            .eq("mes", mes)
            .execute()
        )
        total_renda = round(sum(float(r["valor"]) for r in (income_resp.data or [])), 2)

        tx_resp = (
            client.table("transactions")
            .select("valor")
            .gte("data", first_day)
            .lt("data", last_day)
            .execute()
        )
        total_fatura = round(
            sum(float(r["valor"]) for r in (tx_resp.data or [])),
            2,
        )

        fixos_resp = (
            client.table("fixed_expenses")
            .select("valor")
            .eq("tipo", "recorrente")
            .eq("ativo", True)
            .execute()
        )
        total_fixos = round(sum(float(r["valor"]) for r in (fixos_resp.data or [])), 2)

        pontuais_resp = (
            client.table("fixed_expenses")
            .select("valor")
            .eq("tipo", "pontual")
            .eq("mes_referencia", mes)
            .execute()
        )
        total_pontuais = round(sum(float(r["valor"]) for r in (pontuais_resp.data or [])), 2)

        total_gastos = round(total_fatura + total_fixos + total_pontuais, 2)
    except Exception as exc:
        logger.error("renda_resumo_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    saldo = round(total_renda - total_gastos, 2)
    taxa_poupanca = round((saldo / total_renda * 100) if total_renda > 0 else 0.0, 1)

    return RendaResumo(
        mes=mes,
        total_renda=total_renda,
        total_gastos=total_gastos,
        saldo=saldo,
        taxa_poupanca=taxa_poupanca,
    )


@router.get("", response_model=list[RendaItem])
async def list_renda(
    mes: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
) -> list[RendaItem]:
    if mes is None:
        mes = _current_mes()

    try:
        client = get_client()
        resp = (
            client.table("income_entries")
            .select("id, mes, tipo, descricao, valor, created_at")
            .eq("mes", mes)
            .order("created_at", desc=False)
            .execute()
        )
    except Exception as exc:
        logger.error("renda_list_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    return [RendaItem(**r) for r in (resp.data or [])]


@router.post("", response_model=RendaItem, status_code=201)
async def create_renda(body: RendaCreate) -> RendaItem:
    if body.tipo not in _TIPOS_VALIDOS:
        raise HTTPException(status_code=422, detail=f"tipo inválido: {body.tipo}")
    if body.valor <= 0:
        raise HTTPException(status_code=422, detail="valor deve ser positivo")
    if not _MES_RE.match(body.mes):
        raise HTTPException(status_code=422, detail="mes deve ser YYYY-MM")

    try:
        client = get_client()
        resp = (
            client.table("income_entries")
            .insert({
                "mes": body.mes,
                "tipo": body.tipo,
                "descricao": body.descricao,
                "valor": body.valor,
            })
            .execute()
        )
    except Exception as exc:
        logger.error("renda_create_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    row = resp.data[0]
    logger.info("renda_criada", id=row["id"], mes=body.mes, tipo=body.tipo, valor=body.valor)
    return RendaItem(**row)


@router.delete("/{entry_id}")
async def delete_renda(entry_id: str) -> dict:
    try:
        client = get_client()
        client.table("income_entries").delete().eq("id", entry_id).execute()
    except Exception as exc:
        logger.error("renda_delete_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    logger.info("renda_deletada", id=entry_id)
    return {"ok": True}
