from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/simulador", tags=["simulador"])


# ── Schemas ────────────────────────────────────────────────────────────────

class SimuladorRequest(BaseModel):
    valor: float = Field(..., gt=0, description="Valor total da dívida em R$")
    taxa_mensal: float = Field(..., gt=0, lt=100, description="Taxa de juros mensal em %")
    parcelas: int = Field(..., ge=1, le=480, description="Número de parcelas")
    sistema: str = Field("price", pattern="^(price|sac)$", description="Sistema Price ou SAC")


class Parcela(BaseModel):
    numero: int
    saldo_devedor: float
    amortizacao: float
    juros: float
    prestacao: float


class SimuladorResponse(BaseModel):
    sistema: str
    valor: float
    taxa_mensal: float
    parcelas_total: int
    prestacao_inicial: float
    prestacao_final: float
    total_pago: float
    total_juros: float
    tabela: list[Parcela]


# ── Endpoint ───────────────────────────────────────────────────────────────

@router.post("/divida", response_model=SimuladorResponse)
async def simular_divida(body: SimuladorRequest) -> SimuladorResponse:
    """
    Gera tabela de amortização pelo sistema Price (parcelas fixas)
    ou SAC (amortização constante).
    """
    taxa = body.taxa_mensal / 100
    n = body.parcelas
    pv = body.valor
    tabela: list[Parcela] = []

    if body.sistema == "price":
        pmt = pv * taxa / (1 - (1 + taxa) ** -n) if taxa > 0 else pv / n

        saldo = pv
        for k in range(1, n + 1):
            juros = round(saldo * taxa, 2)
            amort = round(pmt - juros, 2)
            saldo = round(saldo - amort, 2)
            if k == n:
                amort = round(amort + saldo, 2)
                saldo = 0.0
            tabela.append(Parcela(
                numero=k,
                saldo_devedor=max(saldo, 0),
                amortizacao=amort,
                juros=juros,
                prestacao=round(amort + juros, 2),
            ))

        total_pago = round(sum(p.prestacao for p in tabela), 2)
        return SimuladorResponse(
            sistema="price",
            valor=pv,
            taxa_mensal=body.taxa_mensal,
            parcelas_total=n,
            prestacao_inicial=round(pmt, 2),
            prestacao_final=round(pmt, 2),
            total_pago=total_pago,
            total_juros=round(total_pago - pv, 2),
            tabela=tabela,
        )

    else:  # SAC
        amort_fixo = round(pv / n, 2)
        saldo = pv
        for k in range(1, n + 1):
            juros = round(saldo * taxa, 2)
            amort = saldo if k == n else amort_fixo
            prestacao = round(amort + juros, 2)
            saldo = round(saldo - amort, 2)
            tabela.append(Parcela(
                numero=k,
                saldo_devedor=max(saldo, 0),
                amortizacao=amort,
                juros=juros,
                prestacao=prestacao,
            ))

        total_pago = round(sum(p.prestacao for p in tabela), 2)
        return SimuladorResponse(
            sistema="sac",
            valor=pv,
            taxa_mensal=body.taxa_mensal,
            parcelas_total=n,
            prestacao_inicial=tabela[0].prestacao,
            prestacao_final=tabela[-1].prestacao,
            total_pago=total_pago,
            total_juros=round(total_pago - pv, 2),
            tabela=tabela,
        )
