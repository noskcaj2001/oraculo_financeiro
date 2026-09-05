# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Oráculo Financeiro is a RAG-based investment copilot for Brazilian B3 stocks. It combines:
- A Streamlit chat interface backed by a LangChain + OpenAI RAG pipeline
- Weekly price/indicator summaries and RSS news articles as vector context (Qdrant)
- An XGBoost model that generates buy/sell/neutral signals stored in Supabase
- MLflow for tracing every RAG call and logging ML training runs

## Running the app

Always run from the project root using the venv — **never** the system or Anaconda Python:

```bash
./run.sh                          # Streamlit app (recommended)
PYTHONPATH=. .venv/bin/streamlit run app/main.py   # equivalent
```

## Common commands

```bash
# Tests
PYTHONPATH=. .venv/bin/pytest tests/ -v

# RAG evaluation (golden dataset, 2 prompt versions)
PYTHONPATH=. .venv/bin/python observability/rag_evaluator.py
PYTHONPATH=. .venv/bin/python observability/rag_evaluator.py --compare   # v1 vs v2

# Data pipeline (full backfill)
PYTHONPATH=. .venv/bin/python -c "
from data.ingestion.b3_fetcher import fetch_all_tickers
from data.processing.feature_engineering import compute_all_features
from storage.supabase_client import upsert_prices
df = fetch_all_tickers(start='2024-01-01', end='2026-05-05')
upsert_prices(compute_all_features(df))
"

# Daily update (prices + news + signals)
PYTHONPATH=. .venv/bin/python data/scheduler.py --run-now

# Embeddings
PYTHONPATH=. .venv/bin/python data/processing/embeddings.py          # price summaries
PYTHONPATH=. .venv/bin/python -c "from data.processing.embeddings import run_news_pipeline; run_news_pipeline()"

# ML
PYTHONPATH=. .venv/bin/python ml/train.py          # trains and saves ml/models/xgboost_v2.pkl
PYTHONPATH=. .venv/bin/python ml/predict.py        # generates signals → Supabase

# MLflow UI
PYTHONPATH=. .venv/bin/mlflow ui --port 5001
```

## Architecture

### Data flow

```
yfinance → b3_fetcher → feature_engineering → upsert_prices (Supabase: prices)
                                           → run_embedding_pipeline → Qdrant (price_summary)
RSS feeds → news_fetcher → run_news_pipeline → Qdrant (news_article)
Supabase prices → ml/features → ml/train → ml/models/xgboost_v2.pkl → ml/predict → Supabase (signals)
```

The scheduler (`data/scheduler.py`) runs all four steps daily at 19h BRT.

### RAG pipeline — every `ask()` call

`chain.ask()` is the single entry point for all LLM interactions (chat UI and batch evaluation):
1. `retriever.retrieve()` — embeds the question, searches Qdrant (both `price_summary` and `news_article` docs)
2. `get_prompt(version)` + `ChatOpenAI(gpt-4o-mini)` — generates the answer
3. `_avaliar_resposta()` — runs two MLflow GenAI judges (`is_grounded`, `is_context_relevant`) and logs four assessments on the trace: `fundamentado`, `contexto_relevante`, `classificacao` (PASS/BORDERLINE/HALLUCINATION), `risco_alucinacao`

All calls are traced automatically via `@mlflow.trace` and `mlflow.langchain.autolog`.

### MLflow experiments

| Experiment | What goes there |
|---|---|
| `oraculo_rag` | GenAI/Traces tab — every `ask()` call with spans and assessments |
| `oraculo_sinais` | Model Training tab — XGBoost training runs and backtesting folds |

### Storage

- **Supabase** (PostgreSQL): `prices` (OHLCV + indicators), `signals` (ML output), `embeddings_meta` (doc metadata)
- **Qdrant** (Docker `:6333`): single collection `oraculo_financeiro`, `doc_type` field distinguishes `price_summary` vs `news_article`. Falls back to local disk (`./qdrant_data`) if Docker is unavailable.

### Prompt versioning

Prompts live in `rag/prompts.py`. `CURRENT_VERSION = "v2"` controls which prompt `ask()` uses by default. Adding a new version requires a new `_SYSTEM_Vn` string, an entry in `_PROMPTS`, and updating `CURRENT_VERSION`.

### ML labels

Labels are derived from 5-day forward return per ticker: `≥ +2%` → compra, `≤ −2%` → venda, else → neutro (`ml/features.py:BUY_THRESHOLD / SELL_THRESHOLD / FORWARD_DAYS`).

## Key constraints

- `PYTHONPATH=.` is required for all scripts — the project root must be on the import path.
- The venv is at `.venv/` — use `.venv/bin/python` / `.venv/bin/pip` explicitly; the system Python lacks all dependencies.
- Supabase free tier pauses after ~1 week of inactivity; the first request after a pause may raise a transient connection error.
- Feature engineering removes a ~33-row warmup window per ticker (NaN from RSI/MACD/Bollinger); the daily scheduler only fetches 1 day and will always produce an empty DataFrame — use explicit date ranges for backfills.
- `config.py` reads `PUBLIC_SUBASE_URL` (note: "SUBASE", not "SUPABASE") from `.env`.
