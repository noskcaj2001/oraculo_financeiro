from __future__ import annotations

import json
import logging

from openai import OpenAI

from config import OPENAI_API_KEY
from backend.modules.personal_finance.categories import (
    CATEGORY_SLUGS as _VALID_CATEGORIES,
    categories_prompt_block,
)

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = f"""Você é um extrator de transações financeiras de faturas de cartão de crédito brasileiras.

Analise o texto da fatura e extraia TODAS as transações listadas, incluindo estornos e cancelamentos.

Retorne SOMENTE um objeto JSON válido com os seguintes campos de topo:
- "total_fatura": número decimal (valor do campo "Total da fatura" ou equivalente no PDF; null se não encontrado)
- "transactions": lista de objetos de transação

Cada objeto de transação deve ter exatamente estes campos:
- data: string no formato "YYYY-MM-DD"
- descricao: string com o nome do estabelecimento/serviço
- valor: número decimal em reais, sem R$. POSITIVO para compras, NEGATIVO para estornos/cancelamentos/créditos
- categoria: o slug de uma das categorias válidas (veja abaixo)
- estabelecimento: string com o nome limpo do estabelecimento
- parcela_atual: inteiro (1 se não for parcelado)
- total_parcelas: inteiro (1 se não for parcelado)

Categorias válidas (use o slug à esquerda):
{categories_prompt_block()}

Regras:
- Ignore totais, subtotais, pagamentos e encargos financeiros — extraia apenas compras e estornos
- Estornos são indicados por sinal negativo após o valor (ex: "3.772,29-") ou pelos termos ESTORNO, CANCELAMENTO, CRÉDITO — extraia como valor NEGATIVO
- Para parcelas como "2/6" ou "02/06", parcela_atual=2 e total_parcelas=6
- Se o ano não aparecer no texto, use o ano mais provável baseado no período da fatura
- Nunca invente transações que não estão no texto
- O campo total_fatura deve ser o valor líquido final que aparece como "Total da fatura", "Total a pagar" ou equivalente"""


def parse_transactions(text: str) -> tuple[list[dict], float | None]:
    """
    Extrai transações e total da fatura usando GPT-4o-mini.

    Retorna (transactions, total_fatura) onde total_fatura é o valor
    do campo "Total da fatura" no PDF (None se não encontrado).
    """
    if not text.strip():
        logger.warning("Texto de fatura vazio — nenhuma transação extraída")
        return [], None

    # max_retries=0: desativa retry automático do SDK — deixa o código acima decidir
    client = OpenAI(api_key=OPENAI_API_KEY, max_retries=0)
    # Limita texto para não exceder contexto (~8k chars é suficiente para faturas)
    truncated = text[:8000]

    def _call_api(user_content: str) -> dict | None:
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user",   "content": user_content},
                ],
                temperature=0,
                timeout=60,
            )
            return json.loads(response.choices[0].message.content)
        except Exception as exc:
            logger.warning(f"Chamada OpenAI falhou: {exc}")
            return None

    # Primeira tentativa
    result = _call_api(f"Extraia as transações desta fatura:\n\n{truncated}")

    # Valida estrutura
    parsed = _validate_and_clean(result)
    if parsed is not None:
        return parsed

    # Segunda tentativa com prompt de correção
    logger.warning("Estrutura JSON inválida na primeira tentativa — tentando reparse")
    result2 = _call_api(
        f"O JSON anterior tinha estrutura incorreta. "
        f"Retorne APENAS {{\"total_fatura\": <número ou null>, \"transactions\": [...]}} "
        f"com as transações desta fatura:\n\n{truncated}"
    )
    parsed2 = _validate_and_clean(result2)
    if parsed2 is not None:
        return parsed2

    logger.error("Extração falhou após 2 tentativas — retornando lista vazia")
    return [], None


def _validate_and_clean(data: dict | None) -> tuple[list[dict], float | None] | None:
    """
    Valida estrutura e limpa os dados.
    Retorna (transactions, total_fatura) ou None se estrutura inválida.
    """
    if not isinstance(data, dict):
        return None

    raw = data.get("transactions")
    if not isinstance(raw, list):
        return None

    total_fatura: float | None = None
    try:
        raw_total = data.get("total_fatura")
        if raw_total is not None:
            total_fatura = float(raw_total)
    except (TypeError, ValueError):
        pass

    clean: list[dict] = []
    seen: set[tuple] = set()

    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            categoria = item.get("categoria", "outros")
            if categoria not in _VALID_CATEGORIES:
                categoria = "outros"

            valor = float(item.get("valor", 0))
            t = {
                "data":            str(item.get("data", "")),
                "descricao":       str(item.get("descricao", "")).strip(),
                "valor":           valor,
                "categoria":       categoria,
                "estabelecimento": str(item.get("estabelecimento", "")).strip(),
                "parcela_atual":   int(item.get("parcela_atual", 1)),
                "total_parcelas":  int(item.get("total_parcelas", 1)),
                "estorno":         valor < 0,
            }

            # Chave de dedup: mesma data + descrição + valor (com sinal) + parcela
            # Estorno (-3772.29) e compra (+3772.29) têm chaves diferentes — ambos são preservados
            dedup_key = (t["data"], t["descricao"].lower(), valor, t["parcela_atual"])
            if dedup_key in seen:
                logger.warning(f"Transação duplicada ignorada: {t['descricao']} {t['data']} R${t['valor']}")
                continue
            seen.add(dedup_key)
            clean.append(t)

        except (TypeError, ValueError):
            continue

    return (clean, total_fatura) if clean else None
