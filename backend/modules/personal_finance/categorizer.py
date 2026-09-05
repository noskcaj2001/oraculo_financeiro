"""Categorização de transações de fatura.

Precedência (ver plano):
  merchant_categories (manual > histórico > ia)  →  IA em lote  →  regex (_RULES)  →  'outros'

`categorize_transactions` é o ponto de entrada usado pelo upload de faturas.
`classify_merchants` (IA em lote) e `research_merchants` (IA + busca web) são
compartilhados com o script de backfill.
"""

from __future__ import annotations

import json
import logging
import re

from openai import OpenAI

from config import OPENAI_API_KEY
from backend.modules.personal_finance.categories import (
    DISAMBIGUATION_RULES,
    categories_prompt_block,
    coerce,
    normalize_merchant,
)

logger = logging.getLogger(__name__)

MODEL = "gpt-4o-mini"
_IA_BATCH = 40
_MANUAL_EXAMPLES_LIMIT = 25


# ── Regex de fallback (última tentativa antes de 'outros') ────────────────
# Ordem = prioridade das regras de desempate de categories.DISAMBIGUATION_RULES.
_RULES: list[tuple[re.Pattern, str]] = [
    # 1. app de entrega vence "restaurante"
    (re.compile(r"ifood|rappi|uber\s*eats|99\s*food|ze\s*delivery|zé\s*delivery|aiqfome|delivery\b", re.I), "delivery"),
    # 7. consumo no local -> restaurante_bar (antes de supermercado)
    (re.compile(r"restaurante|lanchonete|padaria|panific|pizz|hamburgu|sushi|churrasc|mcdonald|bob'?s|burger|subway|outback|coxinha|\bacai\b|sorvete|gelatt|\bcafe\b|cafeteria|coffee|bakery|confeitaria|boteco|\bbar\b|espeto|temaki|donut|starbucks|comida", re.I), "restaurante_bar"),
    (re.compile(r"supermercad|mercado|mercearia|carrefour|\bextra\b|atacad|assai|assaí|\bdia\b|hortifruti|\bfeira\b|acougue|açougue|peixaria|minimercad|hipermerc|pao\s*de\s*acucar|pão\s*de\s*açúcar|sacolao|quitanda|\bpublic\b|\bpublix\b", re.I), "supermercado"),
    (re.compile(r"posto|combustivel|combustível|gasolina|\bshell\b|petrobras|ipiranga|ale\s*combust|br\s*distribu|abastece|\betanol\b", re.I), "combustivel"),
    # 3. deslocamento local -> transporte (inclui apps)
    (re.compile(r"\buber\b|99\s*tax|99\s*pop|99app|\b99\b|cabify|\btaxi\b|indriver|estacion|zona\s*azul|sem\s*parar|veloe|conectcar|\bonibus\b|ônibus|\bmetro\b|metrô|bilhete\s*unico|\btrem\b|pedagio|pedágio|\bcptm\b|passagem\s*rodov", re.I), "transporte"),
    # 6. atividade física/estética -> academia_bemestar (antes de saúde)
    (re.compile(r"academia|smart\s*fit|smartfit|bluefit|bio\s*ritmo|crossfit|totalpass|gympass|wellhub|pilates|\byoga\b|\bspa\b|estetica|estética|studio\s", re.I), "academia_bemestar"),
    (re.compile(r"farmacia|farmácia|drogaria|drogasil|droga\s*raia|drogaraia|ultrafarma|pacheco|nissei|panvel|sao\s*joao|são\s*joão|\bfarma\b|clinica|clínica|medic|médic|hospital|laborator|\bexame\b|consulta|odonto|dentista|\botica\b|ótica|oculista|plano\s*de\s*saude|unimed|\bamil\b|sulamerica|sulamérica|psicolog|fisioterap", re.I), "saude"),
    # 4. recorrente digital -> assinaturas (antes de lazer/compras)
    (re.compile(r"netflix|spotify|amazon\s*prime|prime\s*video|disney|\bhbo\b|\bmax\b|globoplay|crunchyroll|apple\.com/bill|apple\s*tv|youtube\s*premium|deezer|claude\.?ai|anthropic|openai|chatgpt|assinatura|editora\s*o\s*globo|\buol\b|estadao|estadão|\bfolha\b|dropbox|google\s*one|icloud|linkedin|canva", re.I), "assinaturas"),
    (re.compile(r"cinema|\bcine\b|cinemark|kinoplex|ingresso|ticket|eventbrite|sympla|\bshow\b|teatro|\bsteam\b|playstation|\bxbox\b|epicgames|nintendo|\bgame\b|\bjogos\b|twitch|parque|zoologic|aquario|aquário|boliche", re.I), "lazer"),
    # 5. loja de esporte vence vestuário
    (re.compile(r"decathlon|centauro|netshoes|track\s*&?\s*field|track\s*and\s*field|runningland|artigos\s*esportiv|\bbike\b|ciclismo|\bnike\b|adidas|\bpuma\b", re.I), "esporte"),
    (re.compile(r"renner|riachuelo|\bc&a\b|c\s*&\s*a|\bcea\b|\bzara\b|h&m|hering|marisa|shein|\broupa\b|calcado|calçado|\bsapato\b|\btenis\b|\btênis\b|\bmoda\b|vestuario|vestuário|youcom|farm\s*rio|\breserva\b", re.I), "vestuario"),
    (re.compile(r"petz|cobasi|petshop|pet\s*shop|petlove|veterinar|veterinár|\bracao\b|\bração\b", re.I), "pets"),
    (re.compile(r"escola|colegio|colégio|universidade|faculdade|\bead\b|coursera|udemy|alura|rocketseat|descomplica|pluralsight|udacity|\bcurso\b|treinamento|certificac|vestibular|\benem\b|senac|senai", re.I), "educacao"),
    (re.compile(r"aluguel|condominio|condomínio|\biptu\b|\bluz\b|energia|\benel\b|cemig|copel|\bagua\b|\bágua\b|sabesp|comgas|gas\s*canalizad|internet|\bclaro\b|\btim\b|\bvivo\b|oi\s*fibra|imobiliaria|imobiliária|seguro\s*residenc", re.I), "moradia"),
    (re.compile(r"hotel|pousada|hostel|airbnb|booking|trivago|decolar|despegar|\bvoo\b|aereo|aéreo|latam|\bgol\b|\bazul\b|cruzeiro|resort|passagem\s*aerea|passagem\s*aérea|hurb|hotelurbano", re.I), "viagem"),
    (re.compile(r"cartorio|cartório|notarial|contabil|contador|advogad|juridico|jurídico|sindicato|anuidade|associac|\boab\b|\bcrm\b|\bcrea\b|\btaxa\b|tarifa|\bmulta\b|seguros?\b|seguradora|porto\s*seguro|\bbanco\b|\bboleto\b|\bted\b|\bdoc\b|\biof\b|financiament|emprestim|empréstim|consorcio|consórcio|superprotegid", re.I), "servicos"),
    (re.compile(r"amazon|americanas|submarino|shoptime|magazine\s*luiza|magalu|casas\s*bahia|pontofrio|dafiti|aliexpress|mercadolivre|mercado\s*livre|shopee|\bolx\b|enjoei|eletronic|eletrônic|\bcelular\b|notebook|\btv\b|geladeira|\bfogao\b|\bfogão\b|lavadora|microondas|\bmovel\b|\bmoveis\b|\bmóveis\b|decoracao|decoração|leroy|telhanorte|\bobra\b|ferragem|papelaria|livraria|\bshopping\b", re.I), "compras"),
]


def _apply_rules(texto: str, categoria_atual: str) -> str:
    if categoria_atual and categoria_atual != "outros":
        return categoria_atual
    for pattern, categoria in _RULES:
        if pattern.search(texto):
            return categoria
    return categoria_atual


def _normalize_name(name: str) -> str:
    cleaned = re.sub(r"\s{2,}", " ", name).strip()
    cleaned = re.sub(r"\*+", " ", cleaned).strip()
    cleaned = re.sub(r"^\d{2}/\d{2}\s+", "", cleaned)
    return cleaned.title()


def _extract_json(text: str) -> str:
    """Isola o primeiro objeto/array JSON de uma resposta (tolera ```json ... ```)."""
    t = text.strip()
    if "```" in t:
        t = re.sub(r"```(?:json)?", "", t).strip()
    start = min((i for i in (t.find("{"), t.find("[")) if i != -1), default=-1)
    end = max(t.rfind("}"), t.rfind("]"))
    return t[start : end + 1] if start != -1 and end > start else t


# ── Classificação por IA ─────────────────────────────────────────────────

def _client() -> OpenAI:
    return OpenAI(api_key=OPENAI_API_KEY, max_retries=1)


def _examples_block(examples: list[tuple[str, str]] | None) -> str:
    if not examples:
        return ""
    linhas = "\n".join(f'- "{m}" => {c}' for m, c in examples[:_MANUAL_EXAMPLES_LIMIT])
    return (
        "\nO usuário já corrigiu manualmente estes estabelecimentos "
        "(use como referência para casos parecidos):\n" + linhas
    )


def classify_merchants(
    items: list[tuple[str, dict]],
    *,
    model: str = MODEL,
    examples: list[tuple[str, str]] | None = None,
) -> dict[str, dict]:
    """[(merchant_key, {exemplos: set|list, ...})] -> {merchant_key: {categoria, confianca}}.

    Classificação em lote, sem busca web. `examples` são pares
    (merchant_key, categoria) confirmados manualmente, usados como few-shot.
    Devolve {} se não houver chave OpenAI ou se todas as chamadas falharem.
    """
    if not items or not OPENAI_API_KEY:
        return {}

    system = (
        "Classifique cada estabelecimento brasileiro em UMA categoria da lista, "
        "usando conhecimento de marcas/redes do Brasil. Se ambíguo, escolha a mais "
        "provável e reduza a confiança.\n\nCategorias válidas (use o slug):\n"
        + categories_prompt_block()
        + "\n\n" + DISAMBIGUATION_RULES
        + _examples_block(examples)
        + '\n\nResponda SOMENTE JSON: {"itens":[{"merchant":"<exato>","categoria":"<slug>",'
        '"confianca":0.0-1.0}]}'
    )

    client = _client()
    out: dict[str, dict] = {}
    for i in range(0, len(items), _IA_BATCH):
        chunk = items[i : i + _IA_BATCH]
        listing = "\n".join(
            f'- "{k}"  (ex: {" | ".join(sorted(ctx.get("exemplos", [])))[:100]})'
            for k, ctx in chunk
        )
        try:
            resp = client.chat.completions.create(
                model=model,
                response_format={"type": "json_object"},
                temperature=0,
                timeout=60,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": f"Estabelecimentos:\n{listing}"},
                ],
            )
            data = json.loads(resp.choices[0].message.content)
            for item in data.get("itens", []):
                m = str(item.get("merchant", "")).strip()
                if m:
                    out[m] = {
                        "categoria": coerce(item.get("categoria")),
                        "confianca": round(float(item.get("confianca", 0.5)), 2),
                    }
        except Exception as exc:  # noqa: BLE001 — degrada para regex no caller
            logger.warning("classify_merchants: lote %d falhou: %s", i // _IA_BATCH, exc)
    return out


def research_merchants(
    items: list[tuple[str, dict]],
    *,
    model: str = MODEL,
    cap: int | None = None,
    examples: list[tuple[str, str]] | None = None,
) -> dict[str, dict]:
    """Classifica pesquisando o nome do estabelecimento na web (OpenAI web_search).

    Uma chamada por estabelecimento — lento e mais caro; usar só na cauda
    incerta (backfill / comando `refine`), nunca no upload.
    Retorna {merchant_key: {categoria, confianca, evidencia}}.
    """
    if not items or not OPENAI_API_KEY:
        return {}

    chosen = items[:cap] if cap else items
    client = _client()
    regras = (
        "Categorias válidas (use o slug):\n" + categories_prompt_block()
        + "\n\n" + DISAMBIGUATION_RULES + _examples_block(examples)
    )
    out: dict[str, dict] = {}
    for k, ctx in chosen:
        exemplos = " | ".join(sorted(ctx.get("exemplos", [])))[:160]
        prompt = (
            f'Pesquise na internet o estabelecimento brasileiro "{k}" '
            f'(como aparece na fatura de cartão: {exemplos}). '
            f"Descubra o ramo de atividade (site, redes sociais, CNPJ/CNAE, notícias). "
            f"Se a própria descrição contiver um termo do ramo (ESTACIONAMENTO, POSTO, "
            f"FARMACIA, DROGARIA, PADARIA, HOTEL, ACADEMIA...), ele tem prioridade sobre o nome. "
            f"Depois classifique numa única categoria.\n\n{regras}\n\n"
            'Responda SOMENTE JSON: {"categoria":"<slug>","confianca":0.0-1.0,"evidencia":"<o que encontrou>"}'
        )
        try:
            resp = client.responses.create(
                model=model,
                tools=[{"type": "web_search"}],
                temperature=0,
                input=prompt,
            )
            data = json.loads(_extract_json(resp.output_text))
            out[k] = {
                "categoria": coerce(data.get("categoria")),
                "confianca": round(float(data.get("confianca", 0.7)), 2),
                "evidencia": str(data.get("evidencia", ""))[:300],
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning("research_merchants: '%s' falhou: %s", k, exc)
    return out


# ── Ponto de entrada do upload de faturas ────────────────────────────────

def _fetch_manual_examples(client) -> list[tuple[str, str]]:
    try:
        resp = (
            client.table("merchant_categories")
            .select("merchant_key, categoria")
            .eq("origem", "manual")
            .order("updated_at", desc=True)
            .limit(_MANUAL_EXAMPLES_LIMIT)
            .execute()
        )
        return [(r["merchant_key"], r["categoria"]) for r in (resp.data or [])]
    except Exception as exc:  # noqa: BLE001
        logger.warning("merchant_categories (manual) lookup falhou: %s", exc)
        return []


def categorize_transactions(transactions: list[dict], *, client, model: str = MODEL) -> list[dict]:
    """Normaliza o nome do estabelecimento e resolve a categoria de cada transação.

    `client` é o cliente Supabase (usado para ler/gravar merchant_categories).
    A categoria que vier do parser/extração é ignorada — a fonte de verdade é
    o dicionário de comerciantes, com IA (lote) e regex como fallback.
    Correções manuais entram como few-shot na classificação dos desconhecidos.
    """
    if not transactions:
        return []

    enriched: list[dict] = []
    for t in transactions:
        raw = t.get("estabelecimento") or t.get("descricao") or ""
        enriched.append({
            **t,
            "estabelecimento": _normalize_name(raw),
            "_key": normalize_merchant(raw),
            "categoria": None,
        })

    keys = sorted({e["_key"] for e in enriched if e["_key"]})

    # 1. dicionário de comerciantes
    dict_map: dict[str, dict] = {}
    if keys:
        try:
            resp = (
                client.table("merchant_categories")
                .select("merchant_key, categoria")
                .in_("merchant_key", keys)
                .execute()
            )
            dict_map = {r["merchant_key"]: r for r in (resp.data or [])}
        except Exception as exc:  # noqa: BLE001
            logger.warning("merchant_categories lookup falhou: %s", exc)

    # 2. o que sobrou → IA em lote (com few-shot das correções manuais)
    misses: dict[str, dict] = {}
    for e in enriched:
        k = e["_key"]
        if k and k in dict_map:
            e["categoria"] = coerce(dict_map[k]["categoria"])
        elif k:
            misses.setdefault(k, {"exemplos": set()})["exemplos"].add(
                (e.get("descricao") or "").strip()
            )

    ia_map: dict[str, dict] = {}
    if misses:
        ia_map = classify_merchants(
            list(misses.items()),
            model=model,
            examples=_fetch_manual_examples(client),
        )
        if ia_map:
            _upsert_ia_entries(client, ia_map, misses)

    # 3. atribuição final: IA → regex → 'outros'
    for e in enriched:
        if e["categoria"] is None:
            k = e["_key"]
            cat = ia_map.get(k, {}).get("categoria")
            if not cat or cat == "outros":
                cat = _apply_rules(f"{e.get('descricao', '')} {e['estabelecimento']}", "outros")
            e["categoria"] = coerce(cat)
        e.pop("_key", None)

    return enriched


def _upsert_ia_entries(client, ia_map: dict[str, dict], misses: dict[str, dict]) -> None:
    from datetime import datetime, timezone

    rows = [
        {
            "merchant_key": key,
            "categoria": info["categoria"],
            "origem": "ia",
            "confianca": info.get("confianca"),
            "exemplos": sorted(misses.get(key, {}).get("exemplos", [])) or None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        for key, info in ia_map.items()
    ]
    try:
        client.table("merchant_categories").upsert(rows, on_conflict="merchant_key").execute()
    except Exception as exc:  # noqa: BLE001
        logger.warning("merchant_categories upsert (ia) falhou: %s", exc)


# ── Compat: usado por testes / caminhos antigos ──────────────────────────

def normalize_transactions(transactions: list[dict]) -> list[dict]:
    """Versão sem IA nem dicionário: só limpa o nome e aplica regex sobre 'outros'.

    Mantida para retrocompatibilidade; o upload de faturas usa
    `categorize_transactions`.
    """
    result = []
    for t in transactions:
        descricao = t.get("descricao", "")
        estabelecimento = _normalize_name(t.get("estabelecimento", "") or descricao)
        categoria = _apply_rules(f"{descricao} {estabelecimento}", coerce(t.get("categoria", "outros")))
        result.append({**t, "estabelecimento": estabelecimento, "categoria": coerce(categoria)})
    return result
