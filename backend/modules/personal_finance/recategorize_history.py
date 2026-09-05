"""Recategorização única do histórico de transações + construção do dicionário
de comerciantes (`merchant_categories`).

Uso (sempre dry-run por padrão; `--commit` para gravar):

    PYTHONPATH=. .venv/bin/python -m backend.modules.personal_finance.recategorize_history propose-taxonomy
    PYTHONPATH=. .venv/bin/python -m backend.modules.personal_finance.recategorize_history build-dict --commit
    PYTHONPATH=. .venv/bin/python -m backend.modules.personal_finance.recategorize_history apply --commit
    PYTHONPATH=. .venv/bin/python -m backend.modules.personal_finance.recategorize_history refine --commit
    PYTHONPATH=. .venv/bin/python -m backend.modules.personal_finance.recategorize_history restore data/backups/transactions_categoria_<ts>.json

Fases:
- propose-taxonomy : agrega comerciantes do histórico e pede à IA uma taxonomia.
                     Grava rascunho em data/backups/taxonomia_proposta.json.
                     (Revise e cole o dict final em categories.py.)
- build-dict       : classifica cada comerciante único (lote gpt-4o-mini → busca web
                     na cauda incerta) → upsert merchant_categories (origem='historico').
                     `--no-web` pula a busca web.
- apply            : backup + reescreve transactions.categoria a partir do dicionário
                     (comerciante sem verbete → IA em lote → regex → 'outros').
- refine           : re-classifica via busca web os verbetes origem='ia' com
                     confiança < 0.6 ou 'outros'. Rode `apply --commit` depois.
- restore <file>   : reverte transactions.categoria a partir de um backup.

Correções manuais (PATCH /api/transactions/{id}) viram verbetes origem='manual'
e entram como few-shot em todas as classificações seguintes.
"""

from __future__ import annotations

import argparse
import json
import logging
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from openai import OpenAI

from config import OPENAI_API_KEY
from storage.supabase_client import get_client
from backend.modules.personal_finance.categories import coerce, normalize_merchant
from backend.modules.personal_finance.categorizer import (
    _apply_rules,
    _fetch_manual_examples,
    classify_merchants,
    research_merchants,
)

LOW_CONFIDENCE = 0.6

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)

BACKUP_DIR = Path("data/backups")
MODEL = "gpt-4o-mini"


# ── Coleta do histórico ───────────────────────────────────────────────────

def _load_transactions() -> list[dict]:
    client = get_client()
    rows: list[dict] = []
    page = 0
    while True:
        resp = (
            client.table("transactions")
            .select("id, data, descricao, estabelecimento, valor, categoria")
            .range(page * 1000, page * 1000 + 999)
            .execute()
        )
        rows.extend(resp.data or [])
        if len(resp.data or []) < 1000:
            break
        page += 1
    return rows


def _aggregate_merchants(rows: list[dict]) -> dict[str, dict]:
    """merchant_key -> {ocorrencias, total, exemplos[set], categoria_atual[Counter]}"""
    agg: dict[str, dict] = defaultdict(
        lambda: {"ocorrencias": 0, "total": 0.0, "exemplos": set(), "cat_atual": Counter()}
    )
    for r in rows:
        raw = r.get("estabelecimento") or r.get("descricao") or ""
        key = normalize_merchant(raw)
        if not key:
            continue
        a = agg[key]
        a["ocorrencias"] += 1
        a["total"] += abs(float(r.get("valor") or 0))
        if len(a["exemplos"]) < 4:
            a["exemplos"].add((r.get("descricao") or raw).strip())
        a["cat_atual"][r.get("categoria") or "outros"] += 1
    return agg


# ── Chamadas de IA ────────────────────────────────────────────────────────

def _client() -> OpenAI:
    return OpenAI(api_key=OPENAI_API_KEY, max_retries=1)


def propose_taxonomy(agg: dict[str, dict]) -> dict:
    merchants = sorted(agg.items(), key=lambda kv: kv[1]["total"], reverse=True)
    listing = "\n".join(
        f"- {key} (x{m['ocorrencias']}, R$ {m['total']:.0f}) ex: {' | '.join(sorted(m['exemplos']))[:120]}"
        for key, m in merchants
    )
    system = (
        "Você é um analista de finanças pessoais no Brasil. A partir da lista de "
        "estabelecimentos de faturas de cartão de um usuário, proponha uma taxonomia "
        "de 12 a 18 categorias de gasto — específica o suficiente para gerar insights "
        "(ex.: separar Mercado, Restaurante e Delivery; separar Combustível de outros "
        "transportes), mas sem categorias com pouquíssimo uso. Sempre inclua 'outros'. "
        "Responda SOMENTE JSON: {\"categorias\":[{\"slug\":\"snake_case\",\"label\":\"PT-BR\","
        "\"descricao\":\"...\",\"exemplos\":[\"...\"]}]}"
    )
    resp = _client().chat.completions.create(
        model=MODEL,
        response_format={"type": "json_object"},
        temperature=0,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": f"Estabelecimentos ({len(merchants)}):\n{listing}"},
        ],
    )
    return json.loads(resp.choices[0].message.content)


# (classificação por IA em lote vem de categorizer.classify_merchants)


# ── Persistência ──────────────────────────────────────────────────────────

def _upsert_dict(mapping: dict[str, dict], agg: dict[str, dict], origem: str) -> None:
    client = get_client()
    rows = []
    for key, info in mapping.items():
        ctx = agg.get(key, {})
        rows.append({
            "merchant_key": key,
            "categoria": info["categoria"],
            "origem": origem,
            "confianca": info.get("confianca"),
            "evidencia": info.get("evidencia") or None,
            "exemplos": sorted(ctx.get("exemplos", [])) or None,
            "ocorrencias": ctx.get("ocorrencias", 0),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    for i in range(0, len(rows), 200):
        client.table("merchant_categories").upsert(
            rows[i : i + 200], on_conflict="merchant_key"
        ).execute()
    logger.info("merchant_categories: %d verbetes gravados (origem=%s)", len(rows), origem)


def _write_backup(rows: list[dict]) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = BACKUP_DIR / f"transactions_categoria_{ts}.json"
    path.write_text(json.dumps({r["id"]: r["categoria"] for r in rows}, ensure_ascii=False, indent=1))
    logger.info("backup: %s (%d linhas)", path, len(rows))
    return path


def _apply_updates(rows: list[dict], new_cat: dict[str, str]) -> None:
    client = get_client()
    changed = [(r["id"], new_cat[r["id"]]) for r in rows if new_cat[r["id"]] != r["categoria"]]
    for i, (tid, cat) in enumerate(changed, 1):
        client.table("transactions").update({"categoria": cat}).eq("id", tid).execute()
        if i % 50 == 0:
            logger.info("  atualizadas %d/%d", i, len(changed))
    logger.info("transactions: %d de %d linhas atualizadas", len(changed), len(rows))


def _distribution(cats: list[str]) -> str:
    c = Counter(cats)
    n = len(cats) or 1
    return "\n".join(f"  {k:20} {v:4}  ({100*v/n:4.1f}%)" for k, v in c.most_common())


# ── Fases ─────────────────────────────────────────────────────────────────

def run_propose_taxonomy() -> None:
    rows = _load_transactions()
    agg = _aggregate_merchants(rows)
    logger.info("%d transações, %d comerciantes únicos", len(rows), len(agg))
    result = propose_taxonomy(agg)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    out = BACKUP_DIR / "taxonomia_proposta.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    logger.info("taxonomia proposta -> %s", out)
    for cat in result.get("categorias", []):
        logger.info("  %-20s %s", cat.get("slug"), cat.get("descricao", ""))
    logger.info("\nRevise e cole o dict final em backend/modules/personal_finance/categories.py")


def _needs_research(info: dict) -> bool:
    return info.get("categoria") == "outros" or float(info.get("confianca") or 0) < LOW_CONFIDENCE


def run_build_dict(commit: bool, no_web: bool = False) -> None:
    rows = _load_transactions()
    agg = _aggregate_merchants(rows)
    client = get_client()
    examples = _fetch_manual_examples(client)
    logger.info("%d comerciantes únicos para classificar", len(agg))

    # Passada 1: lote barato
    mapping = classify_merchants([(k, v) for k, v in agg.items()], examples=examples)

    # Passada 2: busca web na cauda incerta
    incertos = [(k, agg[k]) for k, info in mapping.items() if _needs_research(info)]
    incertos += [(k, v) for k, v in agg.items() if k not in mapping]
    if incertos and not no_web:
        logger.info("%d comerciantes incertos — pesquisando na web", len(incertos))
        for k, info in research_merchants(incertos, examples=examples).items():
            mapping[k] = info

    logger.info("\nDistribuição proposta para o dicionário:")
    logger.info(_distribution([m["categoria"] for m in mapping.values()]))
    if not commit:
        logger.info("\n(dry-run — use --commit para gravar em merchant_categories)")
        return
    _upsert_dict(mapping, agg, origem="historico")


def run_refine(commit: bool) -> None:
    """Reprocessa (busca web) verbetes de origem 'ia' com baixa confiança ou 'outros'."""
    client = get_client()
    agg = _aggregate_merchants(_load_transactions())
    try:
        dic = client.table("merchant_categories").select("*").eq("origem", "ia").execute().data or []
    except Exception as exc:  # noqa: BLE001
        logger.error("merchant_categories indisponível: %s — rode o schema SQL", exc)
        return

    alvos = [
        (r["merchant_key"], agg.get(r["merchant_key"], {"exemplos": set(r.get("exemplos") or [])}))
        for r in dic
        if _needs_research({"categoria": r["categoria"], "confianca": r.get("confianca")})
    ]
    if not alvos:
        logger.info("nada a refinar (todos os verbetes 'ia' já têm confiança >= %.1f)", LOW_CONFIDENCE)
        return
    logger.info("%d verbetes para refinar via busca web", len(alvos))

    novos = research_merchants(alvos, examples=_fetch_manual_examples(client))
    for k, info in novos.items():
        logger.info("  %-28s -> %-16s (%.2f) %s", k, info["categoria"], info["confianca"], info.get("evidencia", "")[:80])
    if not commit:
        logger.info("\n(dry-run — use --commit para gravar; depois rode `apply --commit`)")
        return
    _upsert_dict(novos, agg, origem="ia")
    logger.info("\nverbetes atualizados. Rode `apply --commit` para propagar às transações.")


def run_apply(commit: bool) -> None:
    rows = _load_transactions()
    agg = _aggregate_merchants(rows)
    client = get_client()

    # dicionário existente
    try:
        existing = {
            r["merchant_key"]: r
            for r in (client.table("merchant_categories").select("*").execute().data or [])
        }
    except Exception as exc:  # noqa: BLE001 — tabela ainda não criada
        logger.warning(
            "merchant_categories indisponível (%s) — rode o schema SQL primeiro; "
            "seguindo só com IA/regex", exc,
        )
        existing = {}
    logger.info("dicionário: %d verbetes", len(existing))

    # comerciantes sem verbete → classifica agora
    missing = [(k, v) for k, v in agg.items() if k not in existing]
    if missing:
        logger.info("%d comerciantes sem verbete — classificando via IA", len(missing))
        novos = classify_merchants(missing, examples=_fetch_manual_examples(client))
        if commit and novos:
            _upsert_dict(novos, agg, origem="ia")
        for k, info in novos.items():
            existing[k] = {"categoria": info["categoria"], "origem": "ia"}

    # resolve categoria por transação
    new_cat: dict[str, str] = {}
    fonte = Counter()
    for r in rows:
        raw = r.get("estabelecimento") or r.get("descricao") or ""
        key = normalize_merchant(raw)
        verbete = existing.get(key)
        cat = coerce(verbete["categoria"]) if verbete else "outros"
        origem = verbete.get("origem", "dic") if verbete else None

        # dict/IA sem convicção → tenta a regex antes de desistir
        if cat == "outros" and origem != "manual":
            regra = _apply_rules(f"{r.get('descricao','')} {raw}", "outros")
            if regra != "outros":
                cat, origem = regra, "regex"

        new_cat[r["id"]] = cat
        fonte[origem or "outros"] += 1

    logger.info("\nANTES:\n%s", _distribution([r["categoria"] for r in rows]))
    logger.info("\nDEPOIS:\n%s", _distribution(list(new_cat.values())))
    logger.info("\nfonte da categoria: %s", dict(fonte))

    if not commit:
        logger.info("\n(dry-run — use --commit para gravar)")
        return
    _write_backup(rows)
    _apply_updates(rows, new_cat)


def run_restore(path: str) -> None:
    mapping = json.loads(Path(path).read_text())
    client = get_client()
    for i, (tid, cat) in enumerate(mapping.items(), 1):
        client.table("transactions").update({"categoria": cat}).eq("id", tid).execute()
        if i % 50 == 0:
            logger.info("  restauradas %d/%d", i, len(mapping))
    logger.info("restore concluído: %d linhas", len(mapping))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("fase", choices=["propose-taxonomy", "build-dict", "refine", "apply", "restore"])
    p.add_argument("arquivo", nargs="?", help="backup .json (apenas para 'restore')")
    p.add_argument("--commit", action="store_true", help="grava as mudanças (senão dry-run)")
    p.add_argument("--no-web", action="store_true", help="build-dict: pula a busca web (só lote)")
    args = p.parse_args()

    if args.fase == "propose-taxonomy":
        run_propose_taxonomy()
    elif args.fase == "build-dict":
        run_build_dict(args.commit, no_web=args.no_web)
    elif args.fase == "refine":
        run_refine(args.commit)
    elif args.fase == "apply":
        run_apply(args.commit)
    elif args.fase == "restore":
        if not args.arquivo:
            p.error("restore exige o caminho do backup .json")
        run_restore(args.arquivo)


if __name__ == "__main__":
    main()
