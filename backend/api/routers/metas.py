from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/metas", tags=["metas"])


# ── Schemas ────────────────────────────────────────────────────────────────

class MetasRequest(BaseModel):
    meta: float = Field(..., gt=0, description="Valor alvo em R$")
    aporte_mensal: float = Field(..., ge=0, description="Aporte mensal em R$")
    taxa_anual: float = Field(..., ge=0, description="Taxa de rentabilidade anual em %")
    capital_inicial: float = Field(0, ge=0, description="Capital inicial já investido em R$")


class PontoProjecao(BaseModel):
    mes: int
    patrimonio: float
    aportado: float
    rendimento: float


class MetasResponse(BaseModel):
    meta: float
    taxa_anual: float
    taxa_mensal: float
    prazo_meses: int | None
    patrimonio_final: float
    total_aportado: float
    total_rendimento: float
    projecao: list[PontoProjecao]


# ── Endpoint ───────────────────────────────────────────────────────────────

@router.post("/calcular", response_model=MetasResponse)
async def calcular_meta(body: MetasRequest) -> MetasResponse:
    """
    Projeta crescimento por juros compostos mês a mês.
    Retorna prazo para atingir a meta + projeção mensal.
    Limita simulação a 600 meses (50 anos).
    """
    taxa_mensal = (1 + body.taxa_anual / 100) ** (1 / 12) - 1
    MAX_MESES = 600

    patrimonio = body.capital_inicial
    total_aportado = body.capital_inicial
    prazo_meses: int | None = None
    projecao: list[PontoProjecao] = []

    # ponto 0
    projecao.append(PontoProjecao(
        mes=0,
        patrimonio=round(patrimonio, 2),
        aportado=round(total_aportado, 2),
        rendimento=0.0,
    ))

    for mes in range(1, MAX_MESES + 1):
        rendimento_mes = patrimonio * taxa_mensal
        patrimonio = patrimonio + rendimento_mes + body.aporte_mensal
        total_aportado += body.aporte_mensal

        # Guarda ponto mensal (para gráfico detalhado até 24 meses, depois anual)
        if mes <= 24 or mes % 12 == 0:
            projecao.append(PontoProjecao(
                mes=mes,
                patrimonio=round(patrimonio, 2),
                aportado=round(total_aportado, 2),
                rendimento=round(patrimonio - total_aportado, 2),
            ))

        if prazo_meses is None and patrimonio >= body.meta:
            prazo_meses = mes

        if prazo_meses is not None and mes >= max(prazo_meses + 24, 60):
            break

    if body.aporte_mensal == 0 and taxa_mensal == 0:
        raise HTTPException(status_code=400, detail="Aporte e taxa não podem ser zero simultaneamente")

    return MetasResponse(
        meta=body.meta,
        taxa_anual=body.taxa_anual,
        taxa_mensal=round(taxa_mensal * 100, 4),
        prazo_meses=prazo_meses,
        patrimonio_final=round(patrimonio, 2),
        total_aportado=round(total_aportado, 2),
        total_rendimento=round(patrimonio - total_aportado, 2),
        projecao=projecao,
    )
