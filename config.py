import os
import logging
from dotenv import load_dotenv

load_dotenv()

# --- Supabase ---
# O .env usa PUBLIC_SUBASE_URL (com /rest/v1/) — normaliza para o host base
_raw_url = os.getenv("PUBLIC_SUBASE_URL", "")
SUPABASE_URL = _raw_url.replace("/rest/v1/", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# --- OpenAI ---
# O .env usa API_OPENAI_KEY; LangChain espera OPENAI_API_KEY
OPENAI_API_KEY = os.getenv("API_OPENAI_KEY", os.getenv("OPENAI_API_KEY", ""))
os.environ.setdefault("OPENAI_API_KEY", OPENAI_API_KEY)

# --- Qdrant ---
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "oraculo_financeiro")

# --- MLflow ---
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "./mlruns")

# --- App ---
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
ENV = os.getenv("ENV", "development")

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)

# --- Tickers MVP (B3 blue chips) ---
TICKERS_MVP = [
    "PETR4.SA",
    "VALE3.SA",
    "ITUB4.SA",
    "BBDC4.SA",
    "ABEV3.SA",
    "WEGE3.SA",
    "MGLU3.SA",
    "BBAS3.SA",
    "RENT3.SA",
    "SUZB3.SA",
]

# Contrato de colunas obrigatórias para qualquer fetcher
REQUIRED_COLUMNS = ["ticker", "date", "open", "high", "low", "close", "volume"]
