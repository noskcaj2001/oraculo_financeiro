"""Fonte única de verdade das categorias de gastos + normalização de comerciantes.

`CATEGORIES` é consumido por:
- backend/modules/personal_finance/ai_extractor.py  (extração IA de faturas)
- backend/modules/personal_finance/categorizer.py   (pipeline de categorização)
- backend/modules/personal_finance/recategorize_history.py (backfill do histórico)
- backend/api/routers/transactions.py               (GET /api/categorias, PATCH)
- backend/api/routers/gastos.py                     (validação de gastos fixos/pontuais)

O frontend espelha os slugs em frontend/src/lib/categories.ts (labels + cores).
"""

from __future__ import annotations

import re

# ── Taxonomia ─────────────────────────────────────────────────────────────
# slug (persistido em transactions.categoria) -> label PT-BR (exibição)
# Gerada a partir do histórico via `recategorize_history.py --propose-taxonomy`
# e revisada manualmente.
CATEGORIES: dict[str, str] = {
    "supermercado":       "Supermercado",     # comida p/ casa: mercado, hortifruti, açougue
    "restaurante_bar":    "Restaurante e bar",  # consumo no local/balcão (inclui padaria/cafeteria)
    "delivery":           "Delivery",          # SÓ pedido via app de entrega
    "transporte":         "Transporte",        # Uber/99/táxi + ônibus/metrô/pedágio/estacionamento
    "combustivel":        "Combustível",
    "saude":              "Saúde",
    "academia_bemestar":  "Academia e bem-estar",
    "assinaturas":        "Assinaturas e streaming",
    "lazer":              "Lazer",
    "vestuario":          "Vestuário",
    "esporte":            "Esporte",
    "compras":            "Compras",
    "educacao":           "Educação",
    "moradia":            "Moradia",
    "viagem":             "Viagem",
    "servicos":           "Serviços",
    "pets":               "Pets",
    "outros":             "Outros",
}

CATEGORY_SLUGS: frozenset[str] = frozenset(CATEGORIES)

DEFAULT_CATEGORY = "outros"

# Regras de desempate — injetadas nos prompts de IA e refletidas na ordem de _RULES.
DISAMBIGUATION_RULES = """Regras de desempate (aplique nesta ordem):
1. Pedido feito por app de entrega (iFood, 99Food, Rappi, Aiqfome) => delivery, mesmo que a origem seja um restaurante.
2. "Amazon Prime" / "Prime Video" / mensalidade => assinaturas; "Amazon", "Amazon Marketplace", "Amazon BR" (compra avulsa) => compras.
3. Passagem aérea/rodoviária e hospedagem (hotel, pousada, Airbnb) => viagem. Uber/99/táxi/ônibus/metrô/pedágio/estacionamento => transporte.
4. Cobrança recorrente mensal de serviço digital (streaming, SaaS, jornal, nuvem, telefonia) => assinaturas; compra avulsa de jogo/ingresso/mídia => lazer.
5. Loja de artigos esportivos (Decathlon, Centauro, Netshoes, Track&Field) => esporte, mesmo que o item seja roupa ou tênis. Loja de moda (Renner, C&A, Zara, Hering, Riachuelo) => vestuario.
6. Atividade física ou estética (academia, personal, pilates, spa, TotalPass, Gympass) => academia_bemestar; atendimento clínico, remédio, exame, plano de saúde => saude.
7. Padaria / cafeteria / lanchonete com consumo no local ou balcão => restaurante_bar; mercado / mercearia / hortifruti / açougue (comida para casa) => supermercado.
8. Serviço profissional ou financeiro identificável (cartório, contador, advogado, seguro, tarifa bancária, IOF) => servicos; só use "outros" quando realmente não der para identificar o ramo."""


def is_valid(slug: str) -> bool:
    return slug in CATEGORY_SLUGS


def coerce(slug: str | None) -> str:
    """Devolve o slug se válido, senão 'outros'."""
    return slug if slug in CATEGORY_SLUGS else DEFAULT_CATEGORY


def categories_prompt_block() -> str:
    """Bloco 'slug: Label' para injetar em prompts de IA."""
    return "\n".join(f"- {slug}: {label}" for slug, label in CATEGORIES.items())


# ── Normalização de comerciantes ──────────────────────────────────────────
# Objetivo: colapsar variações do mesmo estabelecimento num "merchant_key"
# estável, usado como PK de merchant_categories.

# Cidades/UF que aparecem como sufixo na descrição do cartão (Bradesco põe a
# praça da transação ao final da linha).
_CITY_SUFFIXES = [
    "SAO PAULO", "S PAULO", "SAO BERNARDO DO CAMPO", "SAO BERNARDO", "SANTO ANDRE",
    "SAO CAETANO DO SUL", "SAO CAETANO", "OSASCO", "BARUERI", "GUARULHOS", "DIADEMA",
    "MAUA", "TABOAO DA SERRA", "CARAPICUIBA", "COTIA", "EMBU DAS ARTES", "EMBU",
    "RIO DE JANEIRO", "RIO DE JANEIR", "BELO HORIZONTE", "CURITIBA", "PORTO ALEGRE",
    "CAMPINAS", "BRASILIA", "SALVADOR", "RECIFE", "FORTALEZA", "GOIANIA",
    "INTERNET", "SAOPAULO",
]
_UF_SUFFIXES = [
    "SP", "RJ", "MG", "RS", "PR", "SC", "BA", "PE", "CE", "DF", "GO", "ES", "PB",
]

# Prefixos de gateway/adquirente: "MP*", "EC *", "EBN *", "PP*", "IFD*",
# "PAG*", "DL *", "MERCPAGO*", "99FOOD *", "IFOOD *".
# Limitado a 2-3 letras para não comer marcas de 4+ ("UBER *TRIP").
_GATEWAY_PREFIX = re.compile(
    r"^(?:"
    r"[A-Z]{2,3}\s*\*+\s*"          # MP*  EC *  EBN *  PP*  IFD*  DL *
    r"|99\s*FOOD\s*\*?\s*"
    r"|IFOOD\s*\*?\s*"
    r"|MERCADO\s*PAGO\s*\*?\s*"
    r"|MERCPAGO\s*\*?\s*"
    r")",
)

_CORP_SUFFIX = re.compile(
    r"\s+(?:LTDA|EIRELI|EPP|ME|S\s*/?\s*A|SA|COMERCIO|COML|E\s+SERV(?:ICOS)?)\b\.?\s*$",
    re.I,
)

_LEADING_DATE = re.compile(r"^\d{2}/\d{2}\s+")
_TRAILING_CODE = re.compile(r"\s+(?:[A-Z]{1,4}\d{1,4}|\d{2,6})$")  # CE44, SPM155, 102
_MULTISPACE = re.compile(r"\s{2,}")
_NON_ALNUM_EDGES = re.compile(r"^[^A-Z0-9]+|[^A-Z0-9]+$")


def normalize_merchant(raw: str) -> str:
    """Reduz a descrição/estabelecimento a uma chave estável em CAIXA ALTA.

    Ex.: "MP*EBAZARCOMBRLTDA OSASCO"           -> "EBAZARCOMBRLTDA"
         "99Food *Marmitex Everyday Sao Paulo" -> "MARMITEX EVERYDAY"
         "AUTO POSTO PROFESSOR C SAO PAULO"    -> "AUTO POSTO PROFESSOR C"
    """
    if not raw:
        return ""

    s = raw.upper().replace(" ", " ")
    s = s.replace("*", " * ")               # isola asteriscos p/ o regex de gateway
    s = _MULTISPACE.sub(" ", s).strip()
    s = _LEADING_DATE.sub("", s)
    s = _GATEWAY_PREFIX.sub("", s).strip()
    s = s.replace(" * ", " ").replace("*", " ")   # asteriscos internos remanescentes
    s = _MULTISPACE.sub(" ", s).strip()

    # remove sufixo de cidade (uma vez) e, na sequência, UF isolada
    for city in sorted(_CITY_SUFFIXES, key=len, reverse=True):
        if s.endswith(" " + city) or s == city:
            s = s[: -len(city)].strip()
            break
    parts = s.rsplit(" ", 1)
    if len(parts) == 2 and parts[1] in _UF_SUFFIXES:
        s = parts[0].strip()

    s = _CORP_SUFFIX.sub("", s).strip()
    s = _TRAILING_CODE.sub("", s).strip()
    s = _MULTISPACE.sub(" ", s)
    s = _NON_ALNUM_EDGES.sub("", s)
    return s.strip()
