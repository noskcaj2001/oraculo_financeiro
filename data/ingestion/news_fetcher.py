"""
Fetcher de notícias financeiras via RSS.

Busca artigos de 5 portais brasileiros, filtra por idade e associa cada
notícia ao ticker correspondente por palavras-chave no título/resumo.
"""
import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

import feedparser

logger = logging.getLogger(__name__)

RSS_FEEDS = {
    "infomoney":      "https://www.infomoney.com.br/feed/",
    "g1_economia":    "https://g1.globo.com/rss/g1/economia/",
    "exame":          "https://exame.com/feed/",
    "agencia_brasil": "https://agenciabrasil.ebc.com.br/economia/feed",
    "valor":          "https://valor.globo.com/rss/",
}

TICKER_KEYWORDS: dict[str, list[str]] = {
    "PETR4.SA": ["petrobras", "petr4"],
    "VALE3.SA":  ["vale", "vale3"],
    "ITUB4.SA":  ["itaú", "itau", "itub4", "itaú unibanco"],
    "BBDC4.SA":  ["bradesco", "bbdc4"],
    "ABEV3.SA":  ["ambev", "abev3"],
    "WEGE3.SA":  ["weg", "wege3"],
    "MGLU3.SA":  ["magazine luiza", "magalu", "mglu3"],
    "BBAS3.SA":  ["banco do brasil", "bbas3"],
    "RENT3.SA":  ["localiza", "rent3"],
    "SUZB3.SA":  ["suzano", "suzb3"],
}


def _tag_ticker(text: str) -> str:
    text_lower = text.lower()
    for ticker, keywords in TICKER_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            return ticker
    return "MERCADO"


def _parse_published(entry) -> Optional[datetime]:
    for field in ("published", "updated"):
        raw = getattr(entry, f"{field}_parsed", None)
        if raw:
            try:
                import time
                ts = time.mktime(raw)
                return datetime.fromtimestamp(ts, tz=timezone.utc)
            except Exception:
                pass
        raw_str = getattr(entry, field, None)
        if raw_str:
            try:
                return parsedate_to_datetime(raw_str)
            except Exception:
                pass
    return None


def _doc_id(url: str) -> str:
    return str(uuid.UUID(hashlib.md5(url.encode()).hexdigest()))


def _build_text(ticker: str, source: str, published: str, title: str, summary: str, url: str) -> str:
    source_label = source.replace("_", " ").title()
    return (
        f"{ticker} | Notícia [{source_label}] {published}:\n"
        f"{title}.\n"
        f"{summary}\n"
        f"Fonte: {url}"
    )


def fetch_news(
    max_items_per_feed: int = 30,
    max_age_days: int = 7,
) -> list[dict]:
    """
    Busca notícias de todos os feeds RSS, filtra por idade e associa tickers.

    Retorna lista de dicts com:
      doc_id, ticker, title, summary, source, url, published, text
    """
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=max_age_days)
    results: list[dict] = []
    seen_ids: set[str] = set()

    for source, feed_url in RSS_FEEDS.items():
        try:
            feed = feedparser.parse(feed_url)
            entries = feed.entries[:max_items_per_feed]
            count = 0

            for entry in entries:
                url = getattr(entry, "link", "") or ""
                if not url:
                    continue

                doc_id = _doc_id(url)
                if doc_id in seen_ids:
                    continue

                pub_dt = _parse_published(entry)
                if pub_dt and pub_dt < cutoff:
                    continue

                title   = getattr(entry, "title",   "") or ""
                summary = getattr(entry, "summary", "") or getattr(entry, "description", "") or ""
                # Strip basic HTML tags from summary
                import re
                summary = re.sub(r"<[^>]+>", "", summary).strip()
                summary = summary[:500]  # truncate para embedding razoável

                published = pub_dt.date().isoformat() if pub_dt else "data desconhecida"
                ticker    = _tag_ticker(title + " " + summary)
                text      = _build_text(ticker, source, published, title, summary, url)

                results.append({
                    "doc_id":    doc_id,
                    "ticker":    ticker,
                    "title":     title,
                    "summary":   summary,
                    "source":    source,
                    "url":       url,
                    "published": published,
                    "text":      text,
                })
                seen_ids.add(doc_id)
                count += 1

            logger.info(f"[{source}] {count} notícias coletadas")

        except Exception as exc:
            logger.warning(f"Erro ao buscar feed '{source}': {exc}")

    logger.info(f"Total de notícias coletadas: {len(results)}")
    return results


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    news = fetch_news()
    print(f"\nTotal: {len(news)} notícias\n")
    for n in news[:3]:
        print(f"[{n['ticker']}] {n['title'][:70]}")
        print(f"  Fonte: {n['source']} | {n['published']}")
        print()
