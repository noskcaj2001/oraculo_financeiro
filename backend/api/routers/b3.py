from __future__ import annotations

from datetime import date

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from data.ingestion.realtime_fetcher import fetch_all_quotes
from rag.chain import ask
from rag.prompts import CURRENT_VERSION, PERSONAL_CONTEXT_VERSION
from storage.supabase_client import get_client as get_supa

logger = structlog.get_logger()

router = APIRouter(prefix="/api/b3", tags=["b3"])


# ── Schemas ────────────────────────────────────────────────────────────────

class QuoteSchema(BaseModel):
    ticker: str
    price: float
    prev_close: float
    pct_change: float
    volume: int
    day_high: float
    day_low: float
    currency: str
    cached: bool


class ChatRequest(BaseModel):
    question: str
    ticker_filter: str | None = None
    top_k: int = 5
    prompt_version: str = CURRENT_VERSION
    use_financial_context: bool = False


class ContextDoc(BaseModel):
    ticker: str | None = None
    period: str | None = None
    text: str | None = None
    score: float | None = None
    doc_type: str | None = None


class ChatResponse(BaseModel):
    answer: str
    context_docs: list[ContextDoc]
    latency_ms: float
    tokens_used: int
    trace_id: str | None
    classificacao: str | None


class SignalSchema(BaseModel):
    ticker: str
    date: str
    signal: str
    confidence: float
    model_version: str


# ── Helpers ────────────────────────────────────────────────────────────────

def _build_financial_context() -> str:
    """Monta bloco de contexto financeiro pessoal para injetar no prompt v3."""
    try:
        client = get_supa()
        today = date.today()
        mes = f"{today.year}-{today.month:02d}"

        # Renda do mês atual
        renda_resp = client.table("income_entries").select("valor").eq("mes", mes).execute()
        renda = sum(float(r["valor"]) for r in (renda_resp.data or []))

        # Portfolio B3
        snap_resp = (
            client.table("portfolio_snapshots")
            .select("id, total_portfolio")
            .order("mes", desc=True)
            .limit(1)
            .execute()
        )
        portfolio_b3 = float(snap_resp.data[0]["total_portfolio"]) if snap_resp.data else 0.0
        snapshot_id = snap_resp.data[0]["id"] if snap_resp.data else None

        # Posições para concentração
        posicoes_txt = ""
        tickers: list[str] = []
        if snapshot_id and portfolio_b3 > 0:
            pos_resp = (
                client.table("portfolio_positions")
                .select("ticker, valor_atualizado, valor_aplicado")
                .eq("snapshot_id", snapshot_id)
                .execute()
            )
            linhas = []
            for p in (pos_resp.data or []):
                valor = float(p.get("valor_atualizado") or p.get("valor_aplicado") or 0)
                pct = valor / portfolio_b3 * 100
                ticker = p.get("ticker", "")
                tickers.append(ticker.replace(".SA", ""))
                linhas.append(f"    {ticker}: R$ {valor:,.0f} ({pct:.0f}%)")
            posicoes_txt = "\n".join(linhas[:8])

        # Sinais ML dos tickers da carteira
        sinais_txt = ""
        if tickers:
            sig_resp = (
                client.table("signals")
                .select("ticker, signal, confidence")
                .in_("ticker", tickers)
                .order("date", desc=True)
                .execute()
            )
            seen: set[str] = set()
            linhas_sig = []
            for s in (sig_resp.data or []):
                if s["ticker"] not in seen:
                    seen.add(s["ticker"])
                    conf = float(s["confidence"]) * 100
                    linhas_sig.append(f"    {s['ticker']}: {s['signal'].upper()} ({conf:.0f}% confiança)")
            sinais_txt = "\n".join(linhas_sig[:8])

        # Patrimônio líquido
        fisicos_resp = client.table("patrimonios_fisicos").select("valor_manual, valor_fipe").execute()
        ativos_fisicos = sum(
            float(r.get("valor_manual") or r.get("valor_fipe") or 0)
            for r in (fisicos_resp.data or [])
        )
        fin_resp = client.table("financiamentos").select("saldo_devedor").eq("ativo", True).execute()
        dividas = sum(float(r["saldo_devedor"]) for r in (fin_resp.data or []))
        patrimonio_liq = portfolio_b3 + ativos_fisicos - dividas

        linhas_ctx = [
            "SITUAÇÃO FINANCEIRA ATUAL DO USUÁRIO (use para personalizar sua resposta):",
            f"  Patrimônio líquido: R$ {patrimonio_liq:,.0f}",
            f"  Carteira B3: R$ {portfolio_b3:,.0f}",
            f"  Ativos físicos: R$ {ativos_fisicos:,.0f}",
            f"  Dívidas: R$ {dividas:,.0f}",
        ]
        if renda > 0:
            linhas_ctx.append(f"  Renda mensal ({mes}): R$ {renda:,.0f}")
        if posicoes_txt:
            linhas_ctx.append(f"  Posições na carteira:\n{posicoes_txt}")
        if sinais_txt:
            linhas_ctx.append(f"  Sinais ML dos ativos:\n{sinais_txt}")
        linhas_ctx.append("")  # linha em branco antes do contexto de mercado

        return "\n".join(linhas_ctx) + "\n"
    except Exception as exc:
        logger.warning("financial_context_falhou", error=str(exc))
        return ""


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/quotes", response_model=list[QuoteSchema])
async def get_quotes() -> list[QuoteSchema]:
    """Cotações em tempo real de todos os TICKERS_MVP (cache Redis 60s)."""
    try:
        quotes = fetch_all_quotes()
        return [QuoteSchema(**q) for q in quotes]
    except Exception as exc:
        logger.error("erro_quotes", error=str(exc))
        raise HTTPException(status_code=500, detail=f"Erro ao buscar cotações: {exc}")


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest) -> ChatResponse:
    """Responde pergunta via RAG e avalia automaticamente com juízes GenAI."""
    try:
        financial_context = ""
        prompt_version = body.prompt_version
        if body.use_financial_context:
            financial_context = _build_financial_context()
            if financial_context:
                prompt_version = PERSONAL_CONTEXT_VERSION

        result = ask(
            question=body.question,
            ticker_filter=body.ticker_filter,
            top_k=body.top_k,
            prompt_version=prompt_version,
            financial_context=financial_context,
        )
        return ChatResponse(
            answer=result["answer"],
            context_docs=[ContextDoc(**d) for d in result["context_docs"]],
            latency_ms=result["latency_ms"],
            tokens_used=result["tokens_used"],
            trace_id=result.get("trace_id"),
            classificacao=result.get("classificacao"),
        )
    except Exception as exc:
        logger.error("erro_chat", question=body.question, error=str(exc))
        raise HTTPException(status_code=500, detail=f"Erro no RAG: {exc}")


@router.get("/signals", response_model=list[SignalSchema])
async def get_signals(
    ticker: str | None = Query(default=None, description="Filtrar por ticker"),
) -> list[SignalSchema]:
    """Sinal ML mais recente por ticker (compra / neutro / venda)."""
    try:
        client = get_supa()
        query = (
            client.table("signals")
            .select("ticker, date, signal, confidence, model_version")
            .order("date", desc=True)
            .limit(200)
        )
        if ticker:
            query = query.eq("ticker", ticker)

        resp = query.execute()

        seen: set[str] = set()
        signals: list[SignalSchema] = []
        for row in (resp.data or []):
            if row["ticker"] not in seen:
                signals.append(SignalSchema(**row))
                seen.add(row["ticker"])

        return sorted(signals, key=lambda s: s.confidence, reverse=True)
    except Exception as exc:
        logger.error("erro_signals", error=str(exc))
        raise HTTPException(status_code=500, detail=f"Erro ao buscar sinais: {exc}")
