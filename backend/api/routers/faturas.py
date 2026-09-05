from __future__ import annotations

import asyncio
import hashlib
import uuid
from collections import defaultdict

import structlog
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from backend.config import settings
from backend.modules.personal_finance.pdf_parser import extract_text, parse_bradesco_statement
from backend.modules.personal_finance.ai_extractor import parse_transactions
from backend.modules.personal_finance.categorizer import categorize_transactions
from storage.supabase_client import get_client

logger = structlog.get_logger()

router = APIRouter(prefix="/api/faturas", tags=["faturas"])

_MAX_BYTES = settings.max_pdf_size_mb * 1024 * 1024


# ── Schemas ────────────────────────────────────────────────────────────────

class TransactionOut(BaseModel):
    data: str
    descricao: str
    valor: float
    categoria: str
    estabelecimento: str
    parcela_atual: int
    total_parcelas: int
    estorno: bool = False


class CategorySummary(BaseModel):
    categoria: str
    total: float
    quantidade: int


class UploadResponse(BaseModel):
    invoice_id: str
    filename: str
    total_transactions: int
    transactions: list[TransactionOut]
    resumo_por_categoria: list[CategorySummary]
    total_fatura: float | None = None
    total_extraido: float | None = None
    validacao_total: bool | None = None


# ── Helpers ────────────────────────────────────────────────────────────────

def _build_resumo(transactions: list[dict]) -> list[CategorySummary]:
    agg: dict[str, dict] = defaultdict(lambda: {"total": 0.0, "quantidade": 0})
    for t in transactions:
        cat = t["categoria"]
        agg[cat]["total"] += t["valor"]
        agg[cat]["quantidade"] += 1
    return sorted(
        [CategorySummary(categoria=k, total=round(v["total"], 2), quantidade=v["quantidade"]) for k, v in agg.items()],
        key=lambda x: x.total,
        reverse=True,
    )


def _upsert_invoice_and_transactions(
    invoice_id: str,
    filename: str,
    transactions: list[dict],
) -> None:
    client = get_client()
    total = round(sum(t["valor"] for t in transactions), 2)

    client.table("invoices").upsert(
        {"id": invoice_id, "filename": filename, "total": total},
        on_conflict="id",
    ).execute()

    if not transactions:
        return

    # Apaga transações anteriores do mesmo invoice antes de reinserir
    # garante que re-uploads não deixem linhas órfãs de extrações anteriores
    client.table("transactions").delete().eq("invoice_id", invoice_id).execute()

    rows = [
        {
            # ID determinístico: mesmo invoice + mesma transação → mesmo UUID
            "id": str(uuid.uuid5(
                uuid.NAMESPACE_OID,
                f"{invoice_id}:{t['data']}:{t['descricao']}:{t['valor']}:{i}",
            )),
            "invoice_id": invoice_id,
            "data": t["data"],
            "descricao": t["descricao"],
            "valor": t["valor"],
            "categoria": t["categoria"],
            "estabelecimento": t["estabelecimento"],
            "parcela_atual": t["parcela_atual"],
            "total_parcelas": t["total_parcelas"],
            "estorno": t.get("estorno", False),
        }
        for i, t in enumerate(transactions)
    ]
    client.table("transactions").upsert(rows, on_conflict="id").execute()


# ── Endpoint ───────────────────────────────────────────────────────────────

@router.post("/upload", response_model=UploadResponse)
async def upload_fatura(file: UploadFile = File(...)) -> UploadResponse:
    """
    Recebe PDF de fatura, extrai transações via GPT-4o-mini e persiste no Supabase.
    PDF processado em memória — nunca salvo em disco.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Apenas arquivos PDF são aceitos")

    pdf_bytes = await file.read()
    if len(pdf_bytes) > _MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"PDF excede {settings.max_pdf_size_mb} MB",
        )

    # invoice_id determinístico: mesmo PDF → mesmo UUID → upsert idempotente
    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
    invoice_id = str(uuid.uuid5(uuid.NAMESPACE_OID, pdf_hash))

    logger.info("fatura_upload_iniciado", filename=file.filename, size_kb=len(pdf_bytes) // 1024, invoice_id=invoice_id)

    # Extração e parsing rodam em thread para não bloquear o event loop
    loop = asyncio.get_event_loop()
    text = await asyncio.wait_for(
        loop.run_in_executor(None, extract_text, pdf_bytes),
        timeout=settings.pdf_parse_timeout_s,
    )

    if not text.strip():
        raise HTTPException(status_code=422, detail="Não foi possível extrair texto do PDF")

    # Tenta o parser determinístico Bradesco primeiro (sem custo de IA).
    # Fallback para GPT-4o-mini se não reconhecer o formato.
    raw_transactions, total_fatura = parse_bradesco_statement(text)
    if raw_transactions:
        logger.info("bradesco_parser_usado", total=len(raw_transactions))
    else:
        raw_transactions, total_fatura = await loop.run_in_executor(None, parse_transactions, text)

    # Categoriza: dicionário de comerciantes → IA (lote) → regex → 'outros'.
    # Roda em thread — faz I/O no Supabase e pode chamar a OpenAI.
    transactions = await loop.run_in_executor(
        None,
        lambda: categorize_transactions(raw_transactions, client=get_client()),
    )

    # Validação: soma só das compras (positivas) vs "Total da fatura" = Compras/Débitos
    total_extraido: float | None = None
    validacao_total: bool | None = None
    if transactions:
        total_extraido = round(sum(t["valor"] for t in transactions if t["valor"] > 0), 2)
    if total_fatura is not None and total_extraido is not None:
        validacao_total = abs(total_extraido - total_fatura) <= 1.0
        if not validacao_total:
            logger.warning(
                "validacao_total_divergencia",
                total_fatura=total_fatura,
                total_extraido=total_extraido,
                diferenca=round(total_extraido - total_fatura, 2),
            )

    try:
        await loop.run_in_executor(
            None,
            _upsert_invoice_and_transactions,
            invoice_id,
            file.filename,
            transactions,
        )
    except Exception as exc:
        logger.warning("fatura_supabase_falhou", error=str(exc))
        # Retorna resultado mesmo se persistência falhar

    resumo = _build_resumo(transactions)
    logger.info(
        "fatura_processada",
        invoice_id=invoice_id,
        filename=file.filename,
        total_transactions=len(transactions),
        total_fatura=total_fatura,
        validacao_total=validacao_total,
    )

    return UploadResponse(
        invoice_id=invoice_id,
        filename=file.filename,
        total_transactions=len(transactions),
        transactions=[TransactionOut(**t) for t in transactions],
        resumo_por_categoria=resumo,
        total_fatura=total_fatura,
        total_extraido=total_extraido,
        validacao_total=validacao_total,
    )
