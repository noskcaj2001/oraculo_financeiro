"""
Chain RAG principal. Toda chamada ao LLM do projeto passa por aqui.
Para migrar para Claude: trocar as 2 linhas marcadas abaixo.
"""
import logging
from typing import Optional

import mlflow
import mlflow.langchain
from langchain_openai import ChatOpenAI
from mlflow.genai.judges import is_context_relevant, is_grounded
# Para migrar para Claude:
# from langchain_anthropic import ChatAnthropic

from config import OPENAI_API_KEY, MLFLOW_TRACKING_URI
from rag.prompts import get_prompt, CURRENT_VERSION
from rag.retriever import retrieve, format_context
from observability.mlflow_tracker import RagTimer

logger = logging.getLogger(__name__)

LLM_MODEL   = "gpt-4o-mini"
JUDGE_MODEL = "openai:/gpt-4o-mini"

mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
mlflow.set_experiment("oraculo_rag")
mlflow.langchain.autolog(log_traces=True, silent=True)


def _get_llm() -> ChatOpenAI:
    return ChatOpenAI(model=LLM_MODEL, api_key=OPENAI_API_KEY, temperature=0.2)
    # Para migrar: return ChatAnthropic(model="claude-sonnet-4-6", api_key=ANTHROPIC_API_KEY)


def _avaliar_resposta(trace_id: str, question: str, answer: str, context: str) -> dict:
    """
    Roda 2 juízes do MLflow GenAI e loga os assessments no trace.
    Executado em toda chamada ao ask() — chat e avaliação recebem as mesmas métricas.

    Assessments gerados (visíveis na aba GenAI/Traces):
      - fundamentado:       a resposta está baseada nos documentos recuperados?
      - contexto_relevante: os documentos recuperados são relevantes para a pergunta?
      - classificacao:      PASS | BORDERLINE | HALLUCINATION
      - risco_alucinacao:   True se fundamentado == "no"
    """
    resultado = {
        "fundamentado":       None,
        "contexto_relevante": None,
        "classificacao":      "DESCONHECIDO",
        "risco_alucinacao":   False,
    }
    try:
        fund = is_grounded(
            request=question, response=answer, context=context, model=JUDGE_MODEL
        ).value
        ctx = is_context_relevant(
            request=question, context=context, model=JUDGE_MODEL
        ).value

        classificacao = (
            "HALLUCINATION" if fund == "no"
            else "PASS" if ctx == "yes"
            else "BORDERLINE"
        )

        resultado = {
            "fundamentado":       fund,
            "contexto_relevante": ctx,
            "classificacao":      classificacao,
            "risco_alucinacao":   fund == "no",
        }

        for nome, valor in resultado.items():
            mlflow.log_feedback(trace_id=trace_id, name=nome, value=valor)

    except Exception as exc:
        logger.warning("Avaliação automática falhou: %s", exc)

    return resultado


@mlflow.trace(span_type="CHAIN", name="rag_ask")
def ask(
    question: str,
    ticker_filter: Optional[str] = None,
    top_k: int = 5,
    prompt_version: str = CURRENT_VERSION,
    financial_context: str = "",
) -> dict:
    """
    Responde uma pergunta usando RAG e avalia automaticamente com 2 juízes GenAI.
    Cada chamada gera um trace completo no MLflow (aba GenAI/Traces) com:
      - spans:       rag_ask → vector_search → embed_query → LLM
      - assessments: fundamentado, contexto_relevante, classificacao, risco_alucinacao
    """
    mlflow.update_current_trace(
        tags={"ticker_filter": ticker_filter or "all", "llm_model": LLM_MODEL},
        metadata={"prompt_version": prompt_version, "top_k": str(top_k)},
    )

    docs     = retrieve(question, top_k=top_k, ticker_filter=ticker_filter)
    context  = format_context(docs)

    prompt = get_prompt(prompt_version)
    llm    = _get_llm()
    chain  = prompt | llm

    invoke_vars: dict = {"context": context, "question": question}
    if financial_context:
        invoke_vars["financial_context"] = financial_context

    tokens_used = 0
    with RagTimer(prompt_version, LLM_MODEL, ticker_filter) as timer:
        response    = chain.invoke(invoke_vars)
        answer      = response.content
        if hasattr(response, "response_metadata"):
            usage       = response.response_metadata.get("token_usage", {})
            tokens_used = usage.get("total_tokens", 0)

    mlflow.update_current_trace(
        tags={"latency_ms": str(round(timer.latency_ms)), "tokens_used": str(tokens_used)},
    )

    span     = mlflow.get_current_active_span()
    trace_id = span.trace_id if span else None

    avaliacao = {}
    if trace_id:
        avaliacao = _avaliar_resposta(trace_id, question, answer, context)

    logger.info(
        "RAG concluído | latência=%.0fms tokens=%d docs=%d | %s",
        timer.latency_ms, tokens_used, len(docs),
        avaliacao.get("classificacao", "sem avaliação"),
    )

    return {
        "answer":             answer,
        "context_docs":       docs,
        "latency_ms":         timer.latency_ms,
        "tokens_used":        tokens_used,
        "trace_id":           trace_id,
        **avaliacao,
    }
