from __future__ import annotations

from collections import defaultdict
from datetime import date

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from storage.supabase_client import get_client

logger = structlog.get_logger()

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# ── Schemas ────────────────────────────────────────────────────────────────

class CategoryTotal(BaseModel):
    categoria: str
    total: float
    quantidade: int


class TransactionItem(BaseModel):
    id: str
    data: str
    descricao: str
    estabelecimento: str
    categoria: str
    valor: float
    parcela_atual: int
    total_parcelas: int
    estorno: bool
    invoice_id: str


class DashboardSummary(BaseModel):
    mes: str
    total_gasto: float
    total_estornos: float
    total_liquido: float       # só cartão (bruto + estornos)
    total_fixos: float         # gastos_fixos ativos
    total_pontuais: float      # gastos_pontuais do mês
    total_saidas: float        # cartão + fixos + pontuais
    total_transacoes: int
    por_categoria: list[CategoryTotal]
    transacoes: list[TransactionItem]


# ── Endpoint ───────────────────────────────────────────────────────────────

@router.get("/summary", response_model=DashboardSummary)
async def get_summary(
    mes: str | None = Query(
        default=None,
        description="Mês no formato YYYY-MM. Padrão: mês corrente.",
        pattern=r"^\d{4}-\d{2}$",
    ),
) -> DashboardSummary:
    """
    Retorna gastos do mês agrupados por categoria + lista de transações.
    Aceita ?mes=YYYY-MM para navegar entre meses.
    """
    if mes is None:
        today = date.today()
        mes = f"{today.year}-{today.month:02d}"

    year, month = mes.split("-")
    first_day = f"{year}-{month}-01"
    # último dia: mês seguinte dia 1 − 1 dia
    next_month = int(month) % 12 + 1
    next_year = int(year) + (1 if next_month == 1 else 0)
    last_day = f"{next_year}-{next_month:02d}-01"

    try:
        client = get_client()
        resp = (
            client.table("transactions")
            .select("id, data, descricao, estabelecimento, categoria, valor, parcela_atual, total_parcelas, estorno, invoice_id")
            .gte("data", first_day)
            .lt("data", last_day)
            .order("data", desc=True)
            .limit(500)
            .execute()
        )
    except Exception as exc:
        logger.error("dashboard_query_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=f"Erro ao consultar transações: {exc}")

    rows = resp.data or []

    # Agrega apenas compras (valor > 0) por categoria
    agg: dict[str, dict] = defaultdict(lambda: {"total": 0.0, "quantidade": 0})
    total_estornos = 0.0
    for row in rows:
        v = float(row["valor"])
        if v < 0:
            total_estornos += v
        else:
            cat = row["categoria"]
            agg[cat]["total"] += v
            agg[cat]["quantidade"] += 1

    por_categoria = sorted(
        [CategoryTotal(categoria=k, total=round(v["total"], 2), quantidade=v["quantidade"]) for k, v in agg.items()],
        key=lambda x: x.total,
        reverse=True,
    )

    total_gasto = round(sum(c.total for c in por_categoria), 2)
    total_estornos = round(total_estornos, 2)
    total_liquido = round(total_gasto + total_estornos, 2)

    # Gastos fixos ativos (tabela fixed_expenses, tipo='recorrente')
    try:
        fixos_resp = (
            client.table("fixed_expenses")
            .select("valor")
            .eq("tipo", "recorrente")
            .eq("ativo", True)
            .execute()
        )
        total_fixos = round(sum(float(r["valor"]) for r in (fixos_resp.data or [])), 2)
    except Exception:
        total_fixos = 0.0

    # Gastos pontuais do mês (tabela fixed_expenses, tipo='pontual', mes_referencia=mes)
    try:
        pontuais_resp = (
            client.table("fixed_expenses")
            .select("valor")
            .eq("tipo", "pontual")
            .eq("mes_referencia", mes)
            .execute()
        )
        total_pontuais = round(sum(float(r["valor"]) for r in (pontuais_resp.data or [])), 2)
    except Exception:
        total_pontuais = 0.0

    return DashboardSummary(
        mes=mes,
        total_gasto=total_gasto,
        total_estornos=total_estornos,
        total_liquido=total_liquido,
        total_fixos=total_fixos,
        total_pontuais=total_pontuais,
        total_saidas=round(total_liquido + total_fixos + total_pontuais, 2),
        total_transacoes=len(rows),
        por_categoria=por_categoria,
        transacoes=[TransactionItem(**r) for r in rows],
    )
