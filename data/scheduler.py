import argparse
import logging
from datetime import date, timedelta

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from data.ingestion.b3_fetcher import fetch_all_tickers
from data.processing.feature_engineering import compute_all_features
from storage.supabase_client import upsert_prices

logger = logging.getLogger(__name__)


def run_monthly_fipe_refresh() -> None:
    """Atualiza o valor FIPE de todos os veículos cadastrados — roda dia 1 de cada mês."""
    from datetime import datetime, timezone
    from storage.supabase_client import get_client
    import httpx, re

    client = get_client()
    resp = client.table("patrimonios_fisicos").select("id, fipe_params, fipe_updated_at").eq("tipo", "carro").execute()
    assets = [r for r in (resp.data or []) if r.get("fipe_params")]

    if not assets:
        logger.info("Nenhum veículo com fipe_params para atualizar.")
        return

    _BRL_RE = re.compile(r"R\$\s*([\d.,]+)")
    _FIPE_BASE = "https://veiculos.fipe.org.br/api/veiculos"

    atualizados = 0
    for asset in assets:
        try:
            fp = asset["fipe_params"]
            with httpx.Client(timeout=10.0) as http:
                r = http.post(f"{_FIPE_BASE}/ConsultarValorComTodosParametros", json={
                    "codigoTabelaReferencia": fp.get("tabela_ref", 0),
                    "codigoTipoVeiculo": 1,
                    "codigoMarca": fp["marca_id"],
                    "codigoModelo": fp["modelo_id"],
                    "ano": fp["ano_id"],
                    "codigoTipoCombustivel": fp.get("combustivel_id", 1),
                    "anoModelo": fp.get("ano_modelo", 0),
                    "tipoConsulta": "tradicional",
                })
                r.raise_for_status()
                data = r.json()

            m = _BRL_RE.search(data.get("Valor", ""))
            if not m:
                continue
            valor = float(m.group(1).replace(".", "").replace(",", "."))

            now = datetime.now(timezone.utc).isoformat()
            client.table("patrimonios_fisicos").update({
                "valor_fipe": valor,
                "fipe_updated_at": now,
            }).eq("id", asset["id"]).execute()

            client.table("asset_value_history").upsert({
                "asset_id": asset["id"],
                "data_consulta": datetime.now(timezone.utc).date().isoformat(),
                "valor": valor,
                "fonte": "fipe",
            }, on_conflict="asset_id,data_consulta,fonte").execute()

            atualizados += 1
        except Exception as exc:
            logger.warning(f"FIPE refresh falhou para asset {asset['id']}: {exc}")

    logger.info(f"FIPE mensal concluído: {atualizados}/{len(assets)} veículos atualizados.")


def run_daily_update() -> None:
    today = date.today()
    end = str(today)

    # RSI/MACD/Bollinger precisam de ~33 linhas de warmup por ticker.
    # Buscar apenas 1 dia sempre produzia DataFrame vazio após feature engineering.
    lookback_start = str(today - timedelta(days=60))

    logger.info(f"Iniciando atualização diária de preços ({lookback_start} → {end})")

    df = fetch_all_tickers(start=lookback_start, end=end)
    if df.empty:
        logger.warning("Nenhum dado de preços coletado pelo yfinance.")
    else:
        df = compute_all_features(df)
        if df.empty:
            logger.warning("DataFrame vazio após feature engineering.")
        else:
            # Persiste apenas os últimos 5 dias para evitar re-upsert desnecessário
            cutoff = today - timedelta(days=5)
            df_new = df[df["date"] >= cutoff]
            if not df_new.empty:
                upsert_prices(df_new)
                logger.info(f"{len(df_new)} linhas de preços persistidas no Supabase.")
            else:
                logger.warning("Nenhuma linha nova de preços nos últimos 5 dias.")

    # Embeddings de preços — lê do Supabase com janela de 60d para ter warmup suficiente
    # Upsert idempotente no Qdrant: mesmo doc_id (ticker+semana) não gera duplicatas
    from data.processing.embeddings import run_embedding_pipeline
    run_embedding_pipeline(start=lookback_start, end=end)
    logger.info("Pipeline de embeddings de preços concluído.")

    # Notícias e sinais rodam sempre, independente do sucesso dos preços
    from data.processing.embeddings import run_news_pipeline
    run_news_pipeline(max_age_days=2)
    logger.info("Atualização diária de notícias concluída.")

    from ml.predict import run_inference
    run_inference(version="v2")
    logger.info("Sinais de mercado atualizados no Supabase.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Scheduler do pipeline ETL do Oráculo Financeiro")
    parser.add_argument(
        "--run-now",
        action="store_true",
        help="Executa o pipeline imediatamente e encerra (sem agendar)",
    )
    args = parser.parse_args()

    if args.run_now:
        run_daily_update()
        return

    scheduler = BlockingScheduler(timezone="America/Sao_Paulo")
    scheduler.add_job(
        run_daily_update,
        trigger=CronTrigger(hour=19, minute=0),
        id="daily_etl",
        name="Atualização diária de preços B3",
        replace_existing=True,
    )
    scheduler.add_job(
        run_monthly_fipe_refresh,
        trigger=CronTrigger(day=1, hour=6, minute=0),
        id="monthly_fipe",
        name="Atualização mensal FIPE (veículos)",
        replace_existing=True,
    )
    logger.info("Scheduler iniciado — ETL diário 19h + FIPE mensal dia 1 às 6h (horário de Brasília)")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler encerrado.")


if __name__ == "__main__":
    main()
