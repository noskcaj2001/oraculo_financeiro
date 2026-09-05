"""
Patrimônio Total — visão 360° de ativos vs passivos.
Agrega: carteira B3 + ativos físicos (com FIPE) + financiamentos.
Sem dependência de RPCs ou views materializadas.
"""
from __future__ import annotations

from datetime import date

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from storage.supabase_client import get_client

logger = structlog.get_logger()

router = APIRouter(prefix="/api/patrimonio-total", tags=["patrimonio-total"])


# ── Schemas ────────────────────────────────────────────────────────────────

class AtivoFisicoResumo(BaseModel):
    id: str
    tipo: str
    descricao: str
    valor_efetivo: float
    valor_aquisicao: float | None
    depreciacao_pct: float | None
    fipe_updated_at: str | None


class FinanciamentoResumo(BaseModel):
    id: str
    descricao: str
    tipo: str
    banco: str | None
    valor_total: float
    saldo_devedor: float
    parcela_mensal: float
    taxa_mensal: float
    meses_restantes: int | None
    equity_pct: float
    parcela_sobre_renda_pct: float | None


class PatrimonioTotalResponse(BaseModel):
    gerado_em: str
    portfolio_b3: float
    total_ativos_fisicos: float
    total_ativos: float
    total_passivos: float
    patrimonio_liquido: float
    comprometimento_financiamento_pct: float | None
    ativos_fisicos: list[AtivoFisicoResumo]
    financiamentos: list[FinanciamentoResumo]
    renda_media_3m: float


# ── Endpoint ───────────────────────────────────────────────────────────────

@router.get("/resumo", response_model=PatrimonioTotalResponse)
async def get_resumo() -> PatrimonioTotalResponse:
    client = get_client()

    try:
        # 1. Carteira B3 — snapshot mais recente
        snap_resp = (
            client.table("portfolio_snapshots")
            .select("total_portfolio")
            .order("mes", desc=True)
            .limit(1)
            .execute()
        )
        portfolio_b3 = float(snap_resp.data[0]["total_portfolio"]) if snap_resp.data else 0.0

        # 2. Ativos físicos
        fisicos_resp = (
            client.table("patrimonios_fisicos")
            .select("id, tipo, descricao, valor_manual, valor_fipe, valor_aquisicao, data_aquisicao, fipe_updated_at")
            .execute()
        )
        ativos_rows = fisicos_resp.data or []

        ativos_fisicos_list: list[AtivoFisicoResumo] = []
        total_ativos_fisicos = 0.0
        for r in ativos_rows:
            efetivo = float(r.get("valor_manual") or r.get("valor_fipe") or 0)
            total_ativos_fisicos += efetivo
            aquisicao = float(r["valor_aquisicao"]) if r.get("valor_aquisicao") else None
            depreciacao = None
            if aquisicao and aquisicao > 0 and efetivo > 0:
                depreciacao = round((aquisicao - efetivo) / aquisicao * 100, 1)
            ativos_fisicos_list.append(AtivoFisicoResumo(
                id=r["id"],
                tipo=r["tipo"],
                descricao=r["descricao"],
                valor_efetivo=efetivo,
                valor_aquisicao=aquisicao,
                depreciacao_pct=depreciacao,
                fipe_updated_at=r.get("fipe_updated_at"),
            ))

        # 3. Financiamentos ativos
        fin_resp = (
            client.table("financiamentos")
            .select("*")
            .eq("ativo", True)
            .execute()
        )
        fin_rows = fin_resp.data or []

        # 4. Renda média dos últimos 3 meses
        hoje = date.today()
        meses_3m = []
        for i in range(3):
            m = (hoje.month - i - 1) % 12 + 1
            y = hoje.year - ((hoje.month - i - 1) // 12)
            meses_3m.append(f"{y}-{m:02d}")

        renda_resp = (
            client.table("income_entries")
            .select("valor")
            .in_("mes", meses_3m)
            .execute()
        )
        total_renda_3m = sum(float(r["valor"]) for r in (renda_resp.data or []))
        renda_media_3m = round(total_renda_3m / 3, 2) if total_renda_3m > 0 else 0.0

    except Exception as exc:
        logger.error("patrimonio_total_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    # Montar financiamentos com cálculos
    total_passivos = 0.0
    total_parcelas = 0.0
    financiamentos_list: list[FinanciamentoResumo] = []

    for f in fin_rows:
        saldo = float(f.get("saldo_devedor") or 0)
        valor_total = float(f.get("valor_total") or 0)
        parcela = float(f.get("parcela_mensal") or 0)
        total_passivos += saldo
        total_parcelas += parcela

        equity_pct = round((valor_total - saldo) / valor_total * 100, 1) if valor_total > 0 else 0.0

        meses_restantes: int | None = None
        if f.get("vencimento_estimado"):
            try:
                venc = date.fromisoformat(f["vencimento_estimado"])
                diff = (venc.year - hoje.year) * 12 + (venc.month - hoje.month)
                meses_restantes = max(0, diff)
            except Exception:
                pass

        parcela_sobre_renda = round(parcela / renda_media_3m * 100, 1) if renda_media_3m > 0 else None

        financiamentos_list.append(FinanciamentoResumo(
            id=f["id"],
            descricao=f["descricao"],
            tipo=f["tipo"],
            banco=f.get("banco"),
            valor_total=valor_total,
            saldo_devedor=saldo,
            parcela_mensal=parcela,
            taxa_mensal=float(f.get("taxa_mensal") or 0),
            meses_restantes=meses_restantes,
            equity_pct=equity_pct,
            parcela_sobre_renda_pct=parcela_sobre_renda,
        ))

    total_ativos = round(portfolio_b3 + total_ativos_fisicos, 2)
    patrimonio_liquido = round(total_ativos - total_passivos, 2)
    comprometimento = round(total_parcelas / renda_media_3m * 100, 1) if renda_media_3m > 0 else None

    logger.info(
        "patrimonio_total_ok",
        b3=portfolio_b3,
        fisicos=total_ativos_fisicos,
        passivos=total_passivos,
        liquido=patrimonio_liquido,
    )

    return PatrimonioTotalResponse(
        gerado_em=hoje.isoformat(),
        portfolio_b3=portfolio_b3,
        total_ativos_fisicos=total_ativos_fisicos,
        total_ativos=total_ativos,
        total_passivos=total_passivos,
        patrimonio_liquido=patrimonio_liquido,
        comprometimento_financiamento_pct=comprometimento,
        ativos_fisicos=ativos_fisicos_list,
        financiamentos=financiamentos_list,
        renda_media_3m=renda_media_3m,
    )
