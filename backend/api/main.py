from __future__ import annotations

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routers import (
    b3, dashboard, faturas, metas, portfolio, renda, simulador,
    patrimonio_fisico, financiamentos, gastos, analise_integrada, patrimonio_total,
    transactions,
)

logger = structlog.get_logger()

app = FastAPI(
    title="Oráculo Financeiro API",
    description="Backend unificado: B3 + Finanças Pessoais",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(b3.router)
app.include_router(faturas.router)
app.include_router(dashboard.router)
app.include_router(simulador.router)
app.include_router(metas.router)
app.include_router(renda.router)
app.include_router(portfolio.router)
app.include_router(patrimonio_fisico.router)
app.include_router(financiamentos.router)
app.include_router(gastos.router_fixos)
app.include_router(gastos.router_pontuais)
app.include_router(analise_integrada.router)
app.include_router(patrimonio_total.router)
app.include_router(transactions.router)


@app.get("/health", tags=["infra"])
async def health_check() -> dict:
    return {"ok": True, "version": app.version}
