from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Supabase
    public_subase_url: str = ""
    supabase_service_role_key: str = ""

    # OpenAI (embeddings + RAG + extração PDF)
    api_openai_key: str = ""

    # Qdrant
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_collection: str = "oraculo_financeiro"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # MLflow
    mlflow_tracking_uri: str = "./mlruns"

    # Upload de faturas
    max_pdf_size_mb: int = 10
    pdf_parse_timeout_s: int = 10    # pdfplumber (local, rápido)
    ai_extraction_timeout_s: int = 90  # OpenAI pode demorar em faturas longas

    # App
    log_level: str = "INFO"
    env: str = "development"

    @property
    def supabase_url(self) -> str:
        return self.public_subase_url.replace("/rest/v1/", "").rstrip("/")

    @property
    def openai_api_key(self) -> str:
        return self.api_openai_key


settings = Settings()
