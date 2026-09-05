"""
Análise Integrada — agrega dados de todas as tabelas existentes em Python.
Não depende de RPCs como fonte primária de dados: cada tabela é consultada
diretamente, exatamente como fazem renda.py e dashboard.py.
A RPC refresh_monthly_profile é chamada ao final apenas para atualizar o
cache histórico (monthly_profile) — falha silenciosa se não disponível.
"""
from __future__ import annotations

import json
import os
import time
from datetime import date

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.modules.insights_engine import Alerta, Metricas, gerar_alertas
from storage.supabase_client import get_client

logger = structlog.get_logger()

router = APIRouter(prefix="/api/analise-integrada", tags=["analise-integrada"])


# ── Schemas ────────────────────────────────────────────────────────────────

class FluxoCaixa(BaseModel):
    renda_total: float
    gastos_fixos_total: float
    fatura_cartao: float
    gastos_pontuais_total: float
    saldo_disponivel: float
    taxa_comprometimento: float
    taxa_poupanca: float


class PatrimonioLiquido(BaseModel):
    portfolio_b3: float
    ativos_fisicos: float
    total_ativos: float
    total_financiamentos: float
    patrimonio_liquido: float


class Projecao(BaseModel):
    anos: int
    patrimonio_projetado: float
    aporte_mensal: float
    taxa_retorno_anual: float


class AIInsight(BaseModel):
    categoria: str
    titulo: str
    texto: str
    prioridade: int


class AlertaSchema(BaseModel):
    tipo: str
    severidade: str
    titulo: str
    descricao: str
    acao_sugerida: str


class SinalRelevante(BaseModel):
    ticker: str
    date: str
    signal: str
    confidence: float
    model_version: str
    valor_posicao: float | None = None


class MesHistorico(BaseModel):
    mes: str
    total_renda: float
    total_cartao: float
    total_fixos: float
    total_pontuais: float
    saldo: float
    taxa_poupanca: float
    taxa_comprometimento: float
    portfolio_b3: float
    ativos_fisicos: float
    total_financiamentos: float
    patrimonio_liquido: float


class AnaliseIntegradaResponse(BaseModel):
    mes: str
    fluxo_caixa: FluxoCaixa
    patrimonio: PatrimonioLiquido
    projecoes: list[Projecao]
    sinais_relevantes: list[SinalRelevante]
    alertas: list[AlertaSchema]
    insights_ai: list[AIInsight]
    gerado_em: str
    latency_ms: float


# ── Helpers ────────────────────────────────────────────────────────────────

def _current_mes() -> str:
    today = date.today()
    return f"{today.year}-{today.month:02d}"


def _mes_boundaries(mes: str) -> tuple[str, str]:
    year, month = mes.split("-")
    first_day = f"{year}-{month}-01"
    next_month = int(month) % 12 + 1
    next_year = int(year) + (1 if next_month == 1 else 0)
    return first_day, f"{next_year}-{next_month:02d}-01"


def _projetar(capital: float, aporte: float, taxa_anual: float, anos: int) -> float:
    taxa_mensal = (1 + taxa_anual) ** (1 / 12) - 1
    meses = anos * 12
    if taxa_mensal == 0:
        return capital + aporte * meses
    return round(
        capital * (1 + taxa_mensal) ** meses
        + aporte * (((1 + taxa_mensal) ** meses - 1) / taxa_mensal),
        2,
    )


def _fmt_brl(v: float) -> str:
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _alerta_to_schema(a: Alerta) -> AlertaSchema:
    return AlertaSchema(
        tipo=a.tipo,
        severidade=a.severidade,
        titulo=a.titulo,
        descricao=a.descricao,
        acao_sugerida=a.acao_sugerida,
    )


def _get_llm_safe():
    """Retorna instância do LLM — tenta rag.chain, cai para langchain direto."""
    try:
        from rag.chain import _get_llm
        return _get_llm()
    except Exception:
        pass
    try:
        from langchain_openai import ChatOpenAI
        api_key = os.getenv("OPENAI_API_KEY")
        if api_key:
            return ChatOpenAI(model="gpt-4o-mini", api_key=api_key, temperature=0.3)
    except Exception:
        pass
    return None


def _persistir_alertas_sync(client, mes: str, alertas: list[Alerta]) -> None:
    try:
        client.table("alerts").delete().eq("mes", mes).execute()
        if alertas:
            client.table("alerts").insert([
                {
                    "mes": mes,
                    "tipo": a.tipo,
                    "severidade": a.severidade,
                    "titulo": a.titulo,
                    "descricao": a.descricao,
                    "acao_sugerida": a.acao_sugerida,
                }
                for a in alertas
            ]).execute()
    except Exception as exc:
        logger.warning("alertas_persist_falhou", error=str(exc))


def _atualizar_cache_mensal(client, mes: str) -> None:
    """Atualiza monthly_profile como cache histórico após calcular."""
    try:
        client.rpc("refresh_monthly_profile", {"p_mes": mes}).execute()
    except Exception as exc:
        logger.warning("cache_mensal_falhou", error=str(exc))


async def _gerar_insights_llm(m: Metricas, alertas: list[Alerta]) -> list[AIInsight]:
    alertas_txt = "\n".join(
        f"  [{a.severidade.upper()}] {a.titulo}: {a.descricao}" for a in alertas
    ) or "  Nenhum alerta crítico."

    posicoes_txt = "\n".join(
        f"  - {p.get('ticker','')}: {_fmt_brl(float(p.get('valor_atualizado') or p.get('valor_aplicado') or 0))}"
        for p in m.posicoes[:8]
    ) or "  Sem posições."

    sinais_txt = "\n".join(
        f"  - {s['ticker']}: {s['signal'].upper()} ({float(s['confidence'])*100:.0f}%)"
        for s in m.sinais
    ) or "  Sem sinais."

    system_prompt = (
        "Você é o Oráculo Financeiro, planejador financeiro pessoal especializado no Brasil. "
        "Com base nos dados e alertas já identificados, gere de 3 a 5 insights acionáveis. "
        "Responda APENAS com JSON válido — lista de objetos:\n"
        '[{"categoria":"fluxo_caixa|investimentos|patrimonio|acao","titulo":"...","texto":"...","prioridade":1}]\n'
        "Prioridade: 1=urgente, 2=importante, 3=informativo. Valores em R$. "
        "NÃO repita os alertas — adicione análise de CONTEXTO e CONEXÃO entre os dados."
    )

    user_msg = (
        f"Mês: {m.mes}\n"
        f"FLUXO: Renda {_fmt_brl(m.total_renda)} | Cartão {_fmt_brl(m.total_cartao)} | "
        f"Fixos {_fmt_brl(m.total_fixos)} | Pontuais {_fmt_brl(m.total_pontuais)}\n"
        f"Saldo: {_fmt_brl(m.saldo)} ({m.taxa_poupanca:.1f}% poupança, {m.taxa_comprometimento:.1f}% comprometido)\n"
        f"PATRIMÔNIO LÍQUIDO: {_fmt_brl(m.patrimonio_liquido)} "
        f"(B3: {_fmt_brl(m.portfolio_b3)} | Físicos: {_fmt_brl(m.ativos_fisicos)} | Dívidas: {_fmt_brl(m.total_financiamentos)})\n"
        f"ALERTAS IDENTIFICADOS:\n{alertas_txt}\n"
        f"CARTEIRA B3:\n{posicoes_txt}\n"
        f"SINAIS ML:\n{sinais_txt}"
    )

    try:
        llm = _get_llm_safe()
        if llm is None:
            return []
        from langchain_core.messages import HumanMessage, SystemMessage
        response = llm.invoke([SystemMessage(content=system_prompt), HumanMessage(content=user_msg)])
        content = response.content.strip()
        start, end = content.find("["), content.rfind("]") + 1
        if start >= 0 and end > start:
            content = content[start:end]
        raw = json.loads(content)
        return sorted(
            [
                AIInsight(
                    categoria=item.get("categoria", "outros"),
                    titulo=item.get("titulo", ""),
                    texto=item.get("texto", ""),
                    prioridade=int(item.get("prioridade", 3)),
                )
                for item in raw
                if item.get("titulo") and item.get("texto")
            ],
            key=lambda x: x.prioridade,
        )
    except Exception as exc:
        logger.warning("insights_llm_falhou", error=str(exc))
        return []


# ── Endpoint principal ──────────────────────────────────────────────────────

@router.get("/resumo", response_model=AnaliseIntegradaResponse)
async def get_resumo(
    mes: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
) -> AnaliseIntegradaResponse:
    if mes is None:
        mes = _current_mes()

    t0 = time.perf_counter()
    first_day, last_day = _mes_boundaries(mes)
    client = get_client()

    try:
        # 1. Renda do mês — income_entries (mesmo padrão de renda.py)
        renda_resp = (
            client.table("income_entries")
            .select("valor")
            .eq("mes", mes)
            .execute()
        )
        renda_total = sum(float(r["valor"]) for r in (renda_resp.data or []))

        # 2. Fatura do cartão — total líquido (compras - estornos/créditos), igual ao dashboard.py
        tx_resp = (
            client.table("transactions")
            .select("valor")
            .gte("data", first_day)
            .lt("data", last_day)
            .execute()
        )
        fatura_cartao = max(0.0, sum(float(r["valor"]) for r in (tx_resp.data or [])))

        # 3. Gastos recorrentes — fixed_expenses tipo=recorrente ativo=true
        fixos_resp = (
            client.table("fixed_expenses")
            .select("valor")
            .eq("tipo", "recorrente")
            .eq("ativo", True)
            .execute()
        )
        gastos_fixos_total = sum(float(r["valor"]) for r in (fixos_resp.data or []))

        # 4. Gastos pontuais do mês — fixed_expenses tipo=pontual mes_referencia
        pontuais_resp = (
            client.table("fixed_expenses")
            .select("valor")
            .eq("tipo", "pontual")
            .eq("mes_referencia", mes)
            .execute()
        )
        gastos_pontuais_total = sum(float(r["valor"]) for r in (pontuais_resp.data or []))

        # 5. Portfolio B3 — snapshot mais recente (portfolio.py)
        snap_resp = (
            client.table("portfolio_snapshots")
            .select("id, total_portfolio, mes")
            .order("mes", desc=True)
            .limit(1)
            .execute()
        )
        portfolio_b3 = float(snap_resp.data[0]["total_portfolio"]) if snap_resp.data else 0.0

        # 6. Posições do portfólio (para análise de concentração ML)
        posicoes: list[dict] = []
        if snap_resp.data:
            pos_resp = (
                client.table("portfolio_positions")
                .select("ticker, tipo_ativo, valor_atualizado, valor_aplicado")
                .eq("snapshot_id", snap_resp.data[0]["id"])
                .execute()
            )
            posicoes = pos_resp.data or []

        # 7. Ativos físicos — COALESCE(valor_manual, valor_fipe, 0)
        fisicos_resp = (
            client.table("patrimonios_fisicos")
            .select("valor_manual, valor_fipe")
            .execute()
        )
        ativos_fisicos = sum(
            float(r.get("valor_manual") or r.get("valor_fipe") or 0)
            for r in (fisicos_resp.data or [])
        )

        # 8. Financiamentos — saldo devedor total (financiamentos.py)
        fin_resp = (
            client.table("financiamentos")
            .select("saldo_devedor")
            .eq("ativo", True)
            .execute()
        )
        total_financiamentos = sum(float(r["saldo_devedor"]) for r in (fin_resp.data or []))

        # 9. Sinais ML dos tickers da carteira (b3.py)
        tickers = list({p["ticker"].replace(".SA", "") for p in posicoes if p.get("ticker")})
        sinais: list[dict] = []
        if tickers:
            sig_resp = (
                client.table("signals")
                .select("ticker, date, signal, confidence, model_version")
                .in_("ticker", tickers)
                .order("date", desc=True)
                .execute()
            )
            seen: set[str] = set()
            for s in (sig_resp.data or []):
                if s["ticker"] not in seen:
                    seen.add(s["ticker"])
                    sinais.append(s)

    except Exception as exc:
        logger.error("analise_integrada_queries_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    # ── Calcular métricas ─────────────────────────────────────────────────
    total_saidas = gastos_fixos_total + fatura_cartao + gastos_pontuais_total
    saldo_disponivel = round(renda_total - total_saidas, 2)
    taxa_comprometimento = round((total_saidas / renda_total * 100) if renda_total > 0 else 0.0, 1)
    taxa_poupanca = round((max(0, saldo_disponivel) / renda_total * 100) if renda_total > 0 else 0.0, 1)
    total_ativos = round(portfolio_b3 + ativos_fisicos, 2)
    patrimonio_liquido = round(total_ativos - total_financiamentos, 2)

    # ── Motor de regras ───────────────────────────────────────────────────
    metricas = Metricas(
        mes=mes,
        total_renda=renda_total,
        total_cartao=fatura_cartao,
        total_fixos=gastos_fixos_total,
        total_pontuais=gastos_pontuais_total,
        portfolio_b3=portfolio_b3,
        ativos_fisicos=ativos_fisicos,
        total_financiamentos=total_financiamentos,
        posicoes=posicoes,
        sinais=sinais,
    )
    alertas = gerar_alertas(metricas)

    # ── Persistência (falha silenciosa) ───────────────────────────────────
    _persistir_alertas_sync(client, mes, alertas)
    _atualizar_cache_mensal(client, mes)

    # ── Insights LLM ──────────────────────────────────────────────────────
    insights_ai = await _gerar_insights_llm(metricas, alertas)

    # ── Montar resposta ───────────────────────────────────────────────────
    aporte = max(saldo_disponivel, 0)
    ticker_valores = {
        p["ticker"].replace(".SA", ""): float(p.get("valor_atualizado") or p.get("valor_aplicado") or 0)
        for p in posicoes
    }

    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    logger.info(
        "analise_integrada_ok",
        mes=mes,
        renda=renda_total,
        cartao=fatura_cartao,
        b3=portfolio_b3,
        alertas=len(alertas),
        insights=len(insights_ai),
        latency_ms=latency_ms,
    )

    return AnaliseIntegradaResponse(
        mes=mes,
        fluxo_caixa=FluxoCaixa(
            renda_total=renda_total,
            gastos_fixos_total=gastos_fixos_total,
            fatura_cartao=fatura_cartao,
            gastos_pontuais_total=gastos_pontuais_total,
            saldo_disponivel=saldo_disponivel,
            taxa_comprometimento=taxa_comprometimento,
            taxa_poupanca=taxa_poupanca,
        ),
        patrimonio=PatrimonioLiquido(
            portfolio_b3=portfolio_b3,
            ativos_fisicos=ativos_fisicos,
            total_ativos=total_ativos,
            total_financiamentos=total_financiamentos,
            patrimonio_liquido=patrimonio_liquido,
        ),
        projecoes=[
            Projecao(
                anos=n,
                patrimonio_projetado=_projetar(portfolio_b3, aporte, 0.10, n),
                aporte_mensal=aporte,
                taxa_retorno_anual=0.10,
            )
            for n in [1, 2, 5]
        ],
        sinais_relevantes=[
            SinalRelevante(
                ticker=s["ticker"],
                date=s["date"],
                signal=s["signal"],
                confidence=float(s["confidence"]),
                model_version=s["model_version"],
                valor_posicao=ticker_valores.get(s["ticker"]),
            )
            for s in sinais
        ],
        alertas=[_alerta_to_schema(a) for a in alertas],
        insights_ai=insights_ai,
        gerado_em=date.today().isoformat(),
        latency_ms=latency_ms,
    )


# ── Histórico ──────────────────────────────────────────────────────────────

@router.get("/historico", response_model=list[MesHistorico])
async def get_historico(
    meses: int = Query(default=12, ge=1, le=36),
) -> list[MesHistorico]:
    """Retorna os últimos N meses do cache monthly_profile."""
    client = get_client()
    try:
        resp = (
            client.table("monthly_profile")
            .select("*")
            .order("mes", desc=True)
            .limit(meses)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    result = []
    for r in reversed(resp.data or []):
        renda = float(r.get("total_renda") or 0)
        cartao = float(r.get("total_cartao") or 0)
        fixos = float(r.get("total_fixos") or 0)
        pontuais = float(r.get("total_pontuais") or 0)
        saidas = cartao + fixos + pontuais
        saldo = renda - saidas
        b3 = float(r.get("portfolio_b3") or 0)
        fisicos = float(r.get("ativos_fisicos") or 0)
        dividas = float(r.get("total_financiamentos") or 0)
        result.append(MesHistorico(
            mes=r["mes"],
            total_renda=renda,
            total_cartao=cartao,
            total_fixos=fixos,
            total_pontuais=pontuais,
            saldo=saldo,
            taxa_poupanca=round(max(0, saldo) / renda * 100, 1) if renda > 0 else 0.0,
            taxa_comprometimento=round(saidas / renda * 100, 1) if renda > 0 else 0.0,
            portfolio_b3=b3,
            ativos_fisicos=fisicos,
            total_financiamentos=dividas,
            patrimonio_liquido=b3 + fisicos - dividas,
        ))
    return result


# ── Alertas ────────────────────────────────────────────────────────────────

@router.get("/alertas", response_model=list[AlertaSchema])
async def get_alertas(
    mes: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
) -> list[AlertaSchema]:
    if mes is None:
        mes = _current_mes()
    client = get_client()
    try:
        resp = (
            client.table("alerts")
            .select("tipo, severidade, titulo, descricao, acao_sugerida")
            .eq("mes", mes)
            .order("created_at")
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return [AlertaSchema(**r) for r in (resp.data or [])]


# ── Relatório mensal ────────────────────────────────────────────────────────

class RelatorioResponse(BaseModel):
    mes: str
    relatorio: str
    gerado_em: str
    latency_ms: float


@router.get("/relatorio", response_model=RelatorioResponse)
async def get_relatorio(
    mes: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
) -> RelatorioResponse:
    """Gera um relatório mensal em prosa usando os dados financeiros consolidados."""
    if mes is None:
        mes = _current_mes()

    t0 = time.perf_counter()
    first_day, last_day = _mes_boundaries(mes)
    client = get_client()

    try:
        renda_resp = client.table("income_entries").select("valor").eq("mes", mes).execute()
        renda = sum(float(r["valor"]) for r in (renda_resp.data or []))

        tx_resp = (
            client.table("transactions")
            .select("valor")
            .gte("data", first_day)
            .lt("data", last_day)
            .execute()
        )
        fatura = max(0.0, sum(float(r["valor"]) for r in (tx_resp.data or [])))

        fixos_resp = client.table("fixed_expenses").select("valor").eq("tipo", "recorrente").eq("ativo", True).execute()
        fixos = sum(float(r["valor"]) for r in (fixos_resp.data or []))

        pontuais_resp = client.table("fixed_expenses").select("valor").eq("tipo", "pontual").eq("mes_referencia", mes).execute()
        pontuais = sum(float(r["valor"]) for r in (pontuais_resp.data or []))

        snap_resp = client.table("portfolio_snapshots").select("total_portfolio").order("mes", desc=True).limit(1).execute()
        b3 = float(snap_resp.data[0]["total_portfolio"]) if snap_resp.data else 0.0

        fisicos_resp = client.table("patrimonios_fisicos").select("valor_manual, valor_fipe").execute()
        fisicos = sum(float(r.get("valor_manual") or r.get("valor_fipe") or 0) for r in (fisicos_resp.data or []))

        fin_resp = client.table("financiamentos").select("saldo_devedor, parcela_mensal").eq("ativo", True).execute()
        dividas = sum(float(r["saldo_devedor"]) for r in (fin_resp.data or []))
        parcelas = sum(float(r["parcela_mensal"]) for r in (fin_resp.data or []))

        alerts_resp = client.table("alerts").select("severidade, titulo, acao_sugerida").eq("mes", mes).execute()
        alertas_db = alerts_resp.data or []

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    total_saidas = fixos + fatura + pontuais
    saldo = renda - total_saidas
    poupanca = round(max(0, saldo) / renda * 100, 1) if renda > 0 else 0.0
    comprometimento = round(total_saidas / renda * 100, 1) if renda > 0 else 0.0
    pl = b3 + fisicos - dividas

    alertas_txt = "\n".join(
        f"- [{a['severidade'].upper()}] {a['titulo']}: {a['acao_sugerida']}"
        for a in alertas_db
    ) or "Nenhum alerta crítico."

    system_prompt = (
        "Você é o Oráculo Financeiro. Escreva um relatório mensal claro, direto e acionável "
        "em português do Brasil. Use seções com títulos markdown (##). "
        "Seja específico com os valores — use R$ e porcentagens. "
        "Termine com 3 ações concretas para o próximo mês. "
        "Tom: conselheiro financeiro pessoal, não genérico."
    )
    user_msg = (
        f"Relatório de {mes}:\n"
        f"- Renda: {_fmt_brl(renda)} | Gastos fixos: {_fmt_brl(fixos)} | Fatura: {_fmt_brl(fatura)} | "
        f"Pontuais: {_fmt_brl(pontuais)} | Parcelas: {_fmt_brl(parcelas)}\n"
        f"- Saldo: {_fmt_brl(saldo)} ({poupanca:.1f}% poupança, {comprometimento:.1f}% comprometido)\n"
        f"- Carteira B3: {_fmt_brl(b3)} | Ativos físicos: {_fmt_brl(fisicos)} | Dívidas: {_fmt_brl(dividas)}\n"
        f"- Patrimônio líquido: {_fmt_brl(pl)}\n"
        f"Alertas identificados:\n{alertas_txt}\n"
        "Escreva o relatório completo:"
    )

    relatorio = ""
    llm = _get_llm_safe()
    if llm:
        try:
            from langchain_core.messages import HumanMessage, SystemMessage
            resp = llm.invoke([SystemMessage(content=system_prompt), HumanMessage(content=user_msg)])
            relatorio = resp.content.strip()
        except Exception as exc:
            logger.warning("relatorio_llm_falhou", error=str(exc))

    if not relatorio:
        relatorio = (
            f"## Resumo de {mes}\n\n"
            f"**Renda:** {_fmt_brl(renda)} · **Saídas:** {_fmt_brl(total_saidas)} · "
            f"**Saldo:** {_fmt_brl(saldo)} ({poupanca:.1f}% poupança)\n\n"
            f"**Patrimônio líquido:** {_fmt_brl(pl)} (B3: {_fmt_brl(b3)} + Físicos: {_fmt_brl(fisicos)} − Dívidas: {_fmt_brl(dividas)})\n\n"
            f"## Alertas\n\n{alertas_txt}\n\n"
            "*(Relatório completo indisponível — configure OPENAI_API_KEY para ativar a IA.)*"
        )

    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    return RelatorioResponse(mes=mes, relatorio=relatorio, gerado_em=date.today().isoformat(), latency_ms=latency_ms)
