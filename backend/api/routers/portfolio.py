from __future__ import annotations

import asyncio
import hashlib
import uuid

import structlog
from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from pydantic import BaseModel

from backend.config import settings
from backend.modules.personal_finance.pdf_parser import extract_text
from backend.modules.personal_finance.portfolio_extractor import extract_portfolio, is_b3_report
from storage.supabase_client import get_client

logger = structlog.get_logger()

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

_MAX_BYTES = settings.max_pdf_size_mb * 1024 * 1024


# ── Schemas ────────────────────────────────────────────────────────────────

class PortfolioPosition(BaseModel):
    id: str
    snapshot_id: str
    tipo_ativo: str
    ticker: str
    nome: str
    tipo_papel: str
    quantidade: float | None
    preco_fechamento: float | None
    valor_aplicado: float | None
    valor_atualizado: float | None
    vencimento: str | None


class PortfolioDividend(BaseModel):
    id: str
    snapshot_id: str
    ticker: str
    pagamento: str | None
    tipo_evento: str
    quantidade: float | None
    preco_unit: float | None
    valor_liquido: float | None


class PortfolioSnapshot(BaseModel):
    id: str
    mes: str
    filename: str | None
    total_acoes: float
    total_etf: float
    total_fii: float
    total_tesouro: float
    total_portfolio: float
    total_proventos: float
    uploaded_at: str


class PortfolioSummary(BaseModel):
    mes: str
    filename: str | None
    total_acoes: float
    total_etf: float
    total_fii: float
    total_tesouro: float
    total_portfolio: float
    total_proventos: float
    uploaded_at: str | None
    posicoes: list[PortfolioPosition]
    proventos: list[PortfolioDividend]


class PortfolioUploadResponse(BaseModel):
    snapshot_id: str
    mes: str
    total_portfolio: float
    total_acoes: float
    total_etf: float
    total_fii: float
    total_tesouro: float
    total_proventos: float
    total_posicoes: int
    total_dividends: int


# ── Helpers ────────────────────────────────────────────────────────────────

def _persist(snapshot_id: str, filename: str, extracted: dict) -> None:
    client = get_client()
    totais = extracted["totais"]
    mes = extracted["mes"]

    # Limpa dados anteriores do mesmo mês (posições e dividendos primeiro, depois snapshot)
    existing = (
        client.table("portfolio_snapshots")
        .select("id")
        .eq("mes", mes)
        .execute()
    )
    if existing.data:
        old_id = existing.data[0]["id"]
        client.table("portfolio_positions").delete().eq("snapshot_id", old_id).execute()
        client.table("portfolio_dividends").delete().eq("snapshot_id", old_id).execute()
        client.table("portfolio_snapshots").delete().eq("id", old_id).execute()

    # Garante que não existam posições órfãs do mesmo snapshot_id
    client.table("portfolio_positions").delete().eq("snapshot_id", snapshot_id).execute()
    client.table("portfolio_dividends").delete().eq("snapshot_id", snapshot_id).execute()

    client.table("portfolio_snapshots").insert({
        "id":              snapshot_id,
        "mes":             mes,
        "filename":        filename,
        "total_acoes":     totais.get("acoes", 0),
        "total_etf":       totais.get("etf", 0),
        "total_fii":       totais.get("fii", 0),
        "total_tesouro":   totais.get("tesouro", 0),
        "total_portfolio": totais.get("portfolio", 0),
        "total_proventos": totais.get("proventos", 0),
    }).execute()

    # Posições
    logger.info("persist_posicoes_inicio", count=len(extracted["posicoes"]))
    if extracted["posicoes"]:
        pos_rows = [
            {
                "id":               str(uuid.uuid5(uuid.NAMESPACE_OID, f"{snapshot_id}:{p['ticker']}:{p['tipo_ativo']}")),
                "snapshot_id":      snapshot_id,
                "tipo_ativo":       p["tipo_ativo"],
                "ticker":           p["ticker"],
                "nome":             p["nome"],
                "tipo_papel":       p["tipo_papel"],
                "quantidade":       p["quantidade"],
                "preco_fechamento": p["preco_fechamento"],
                "valor_aplicado":   p["valor_aplicado"],
                "valor_atualizado": p["valor_atualizado"],
                "vencimento":       p["vencimento"],
            }
            for p in extracted["posicoes"]
        ]
        # Deduplica por id (AI pode extrair o mesmo ticker duas vezes)
        pos_by_id = {r["id"]: r for r in pos_rows}
        logger.info("persist_posicoes_dedup", original=len(pos_rows), dedup=len(pos_by_id))
        result = client.table("portfolio_positions").upsert(list(pos_by_id.values()), on_conflict="id").execute()
        logger.info("persist_posicoes_ok", stored=len(result.data or []))

    # Proventos
    logger.info("persist_proventos_inicio", count=len(extracted["proventos"]))
    if extracted["proventos"]:
        div_rows = [
            {
                "id":            str(uuid.uuid5(uuid.NAMESPACE_OID, f"{snapshot_id}:{d['ticker']}:{d['pagamento']}:{d['valor_liquido']}")),
                "snapshot_id":   snapshot_id,
                "ticker":        d["ticker"],
                "pagamento":     d["pagamento"],
                "tipo_evento":   d["tipo_evento"],
                "quantidade":    d["quantidade"],
                "preco_unit":    d["preco_unit"],
                "valor_liquido": d["valor_liquido"],
            }
            for d in extracted["proventos"]
        ]
        div_by_id = {r["id"]: r for r in div_rows}
        result = client.table("portfolio_dividends").upsert(list(div_by_id.values()), on_conflict="id").execute()
        logger.info("persist_proventos_ok", stored=len(result.data or []))


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.post("/upload", response_model=PortfolioUploadResponse)
async def upload_portfolio(file: UploadFile = File(...)) -> PortfolioUploadResponse:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Apenas arquivos PDF são aceitos")

    pdf_bytes = await file.read()
    if len(pdf_bytes) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"PDF excede {settings.max_pdf_size_mb} MB")

    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
    snapshot_id = str(uuid.uuid5(uuid.NAMESPACE_OID, pdf_hash))

    logger.info("portfolio_upload_iniciado", filename=file.filename, size_kb=len(pdf_bytes) // 1024)

    loop = asyncio.get_event_loop()
    text = await asyncio.wait_for(
        loop.run_in_executor(None, extract_text, pdf_bytes),
        timeout=settings.pdf_parse_timeout_s,
    )

    if not text.strip():
        raise HTTPException(status_code=422, detail="Não foi possível extrair texto do PDF")

    if not is_b3_report(text):
        raise HTTPException(
            status_code=422,
            detail="PDF não reconhecido como Relatório mensal consolidado da B3. "
                   "Baixe o relatório em investidor.b3.com.br → Extratos e Informativos.",
        )

    extracted = await asyncio.wait_for(
        loop.run_in_executor(None, extract_portfolio, text),
        timeout=settings.ai_extraction_timeout_s,
    )

    if not extracted:
        raise HTTPException(status_code=422, detail="Não foi possível extrair os dados do relatório B3")

    try:
        await loop.run_in_executor(None, _persist, snapshot_id, file.filename or "", extracted)
    except Exception as exc:
        logger.warning("portfolio_persist_falhou", error=str(exc))

    totais = extracted["totais"]
    logger.info(
        "portfolio_processado",
        mes=extracted["mes"],
        total_portfolio=totais.get("portfolio"),
        posicoes=len(extracted["posicoes"]),
    )

    return PortfolioUploadResponse(
        snapshot_id=snapshot_id,
        mes=extracted["mes"],
        total_portfolio=totais.get("portfolio", 0),
        total_acoes=totais.get("acoes", 0),
        total_etf=totais.get("etf", 0),
        total_fii=totais.get("fii", 0),
        total_tesouro=totais.get("tesouro", 0),
        total_proventos=totais.get("proventos", 0),
        total_posicoes=len(extracted["posicoes"]),
        total_dividends=len(extracted["proventos"]),
    )


@router.get("/snapshots", response_model=list[PortfolioSnapshot])
async def list_snapshots() -> list[PortfolioSnapshot]:
    try:
        client = get_client()
        resp = (
            client.table("portfolio_snapshots")
            .select("id, mes, filename, total_acoes, total_etf, total_fii, total_tesouro, total_portfolio, total_proventos, uploaded_at")
            .order("mes", desc=True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return [PortfolioSnapshot(**r) for r in (resp.data or [])]


@router.get("/summary", response_model=PortfolioSummary | None)
async def get_summary(
    mes: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
) -> PortfolioSummary | None:
    client = get_client()
    try:
        if mes:
            snap_resp = (
                client.table("portfolio_snapshots")
                .select("id, mes, filename, total_acoes, total_etf, total_fii, total_tesouro, total_portfolio, total_proventos, uploaded_at")
                .eq("mes", mes)
                .limit(1)
                .execute()
            )
        else:
            snap_resp = (
                client.table("portfolio_snapshots")
                .select("id, mes, filename, total_acoes, total_etf, total_fii, total_tesouro, total_portfolio, total_proventos, uploaded_at")
                .order("mes", desc=True)
                .limit(1)
                .execute()
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if not snap_resp.data:
        return None

    snap = snap_resp.data[0]
    sid = snap["id"]

    try:
        pos_resp = (
            client.table("portfolio_positions")
            .select("id, snapshot_id, tipo_ativo, ticker, nome, tipo_papel, quantidade, preco_fechamento, valor_aplicado, valor_atualizado, vencimento")
            .eq("snapshot_id", sid)
            .order("tipo_ativo")
            .execute()
        )
        div_resp = (
            client.table("portfolio_dividends")
            .select("id, snapshot_id, ticker, pagamento, tipo_evento, quantidade, preco_unit, valor_liquido")
            .eq("snapshot_id", sid)
            .order("pagamento", desc=True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return PortfolioSummary(
        mes=snap["mes"],
        filename=snap.get("filename"),
        total_acoes=snap["total_acoes"],
        total_etf=snap["total_etf"],
        total_fii=snap["total_fii"],
        total_tesouro=snap["total_tesouro"],
        total_portfolio=snap["total_portfolio"],
        total_proventos=snap["total_proventos"],
        uploaded_at=snap.get("uploaded_at"),
        posicoes=[PortfolioPosition(**p) for p in (pos_resp.data or [])],
        proventos=[PortfolioDividend(**d) for d in (div_resp.data or [])],
    )


@router.delete("/{snapshot_id}")
async def delete_snapshot(snapshot_id: str) -> dict:
    try:
        client = get_client()
        client.table("portfolio_snapshots").delete().eq("id", snapshot_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    logger.info("portfolio_snapshot_deletado", id=snapshot_id)
    return {"ok": True}
