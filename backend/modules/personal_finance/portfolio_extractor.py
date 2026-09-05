from __future__ import annotations

import json
import logging
import os

from openai import OpenAI

logger = logging.getLogger(__name__)

_B3_MARKERS = ("investidor.B3.com.br", "Relatório mensal consolidado", "Relatorio mensal consolidado")

_SYSTEM_PROMPT = """Você é um extrator de dados de carteira de investimentos do relatório mensal consolidado da B3 (investidor.b3.com.br).

Analise o texto do relatório e extraia todos os dados de posição e proventos.

Retorne SOMENTE um objeto JSON válido com exatamente esta estrutura:

{
  "mes": "YYYY-MM",
  "posicoes": [
    {
      "tipo_ativo": "acoes",
      "ticker": "BBAS3",
      "nome": "BCO BRASIL S.A. ON",
      "tipo_papel": "ON",
      "quantidade": 49,
      "preco_fechamento": 22.21,
      "valor_aplicado": null,
      "valor_atualizado": 1088.29,
      "vencimento": null
    }
  ],
  "proventos": [
    {
      "ticker": "BBDC4",
      "pagamento": "2026-04-30",
      "tipo_evento": "Juros Sobre Capital Próprio",
      "quantidade": 41,
      "preco_unit": 0.30,
      "valor_liquido": 10.36
    }
  ],
  "totais": {
    "acoes": 6781.28,
    "etf": 662.55,
    "fii": 3573.51,
    "tesouro": 35049.37,
    "portfolio": 46066.71,
    "proventos": 46.19
  }
}

Regras obrigatórias:
- tipo_ativo deve ser exatamente: "acoes", "etf", "fii" ou "tesouro"
- Para Ações (Posição - Ações): tipo_ativo="acoes"
- Para ETFs (Posição - ETF): tipo_ativo="etf"
- Para FIIs (Posição - FII): tipo_ativo="fii"
- Para Tesouro Direto (Posição - Tesouro Direto): tipo_ativo="tesouro", preencher valor_aplicado e vencimento (formato YYYY-MM-DD), preco_fechamento=null
- mes deve ser inferido da data do relatório no formato YYYY-MM (ex: "Data: 04/2026" → "2026-04")
- pagamento em proventos: formato YYYY-MM-DD
- Todos os valores monetários como números decimais (ex: 1088.29, não "R$ 1.088,29")
- Nunca invente dados que não estejam no texto
- Se um campo não se aplica, use null"""


def is_b3_report(text: str) -> bool:
    return any(marker in text for marker in _B3_MARKERS)


def extract_portfolio(text: str) -> dict | None:
    """
    Extrai posições e proventos do relatório consolidado B3 usando GPT-4o.

    Retorna dict com estrutura {mes, posicoes, proventos, totais} ou None se
    não for um relatório B3 reconhecido ou se a extração falhar.
    """
    if not text.strip() or not is_b3_report(text):
        return None

    api_key = os.getenv("API_OPENAI_KEY", os.getenv("OPENAI_API_KEY", ""))
    if not api_key:
        logger.error("API_OPENAI_KEY não configurada")
        return None

    client = OpenAI(api_key=api_key, max_retries=0)
    truncated = text[:80000]

    def _call(user_content: str) -> dict | None:
        try:
            response = client.chat.completions.create(
                model="gpt-4o",
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
            logger.warning("portfolio_extractor_api_falhou: %s", exc)
            return None

    result = _call(f"Extraia os dados deste relatório mensal consolidado da B3:\n\n{truncated}")
    validated = _validate(result)
    if validated is not None:
        logger.info("portfolio_extractor_ok: %d posicoes, %d proventos",
                    len(validated["posicoes"]), len(validated["proventos"]))
        return validated

    logger.warning("portfolio_extractor_retry: estrutura inválida na primeira tentativa")
    result2 = _call(
        "O JSON anterior tinha estrutura incorreta. "
        "Retorne APENAS o objeto JSON conforme o schema especificado para este relatório:\n\n"
        + truncated
    )
    validated2 = _validate(result2)
    if validated2 is not None:
        return validated2

    logger.error("portfolio_extractor_falhou após 2 tentativas")
    return None


def _validate(data: dict | None) -> dict | None:
    if not isinstance(data, dict):
        return None
    if "posicoes" not in data or not isinstance(data.get("posicoes"), list):
        return None
    if "mes" not in data:
        return None

    valid_tipos = {"acoes", "etf", "fii", "tesouro"}
    posicoes: list[dict] = []
    for p in data["posicoes"]:
        if not isinstance(p, dict):
            continue
        tipo = p.get("tipo_ativo", "")
        if tipo not in valid_tipos:
            continue
        posicoes.append({
            "tipo_ativo":       tipo,
            "ticker":           str(p.get("ticker") or ""),
            "nome":             str(p.get("nome") or ""),
            "tipo_papel":       str(p.get("tipo_papel") or ""),
            "quantidade":       _f(p.get("quantidade")),
            "preco_fechamento": _f(p.get("preco_fechamento")),
            "valor_aplicado":   _f(p.get("valor_aplicado")),
            "valor_atualizado": _f(p.get("valor_atualizado")),
            "vencimento":       p.get("vencimento") or None,
        })

    proventos: list[dict] = []
    for d in (data.get("proventos") or []):
        if not isinstance(d, dict):
            continue
        proventos.append({
            "ticker":        str(d.get("ticker") or ""),
            "pagamento":     d.get("pagamento") or None,
            "tipo_evento":   str(d.get("tipo_evento") or ""),
            "quantidade":    _f(d.get("quantidade")),
            "preco_unit":    _f(d.get("preco_unit")),
            "valor_liquido": _f(d.get("valor_liquido")),
        })

    totais_raw = data.get("totais") or {}
    totais = {k: _f(totais_raw.get(k)) or 0.0 for k in ("acoes", "etf", "fii", "tesouro", "portfolio", "proventos")}
    if totais["portfolio"] == 0:
        totais["portfolio"] = round(
            totais["acoes"] + totais["etf"] + totais["fii"] + totais["tesouro"], 2
        )

    return {"mes": str(data["mes"]), "posicoes": posicoes, "proventos": proventos, "totais": totais}


def _f(v: object) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
