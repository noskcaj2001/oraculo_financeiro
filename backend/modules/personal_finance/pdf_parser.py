from __future__ import annotations

import calendar
import io
import logging
import re

import pdfplumber

logger = logging.getLogger(__name__)

# ── Regex para parser Bradesco ─────────────────────────────────────────────

# Linha de transação: DD/MM <merchant...> BRL_VALUE[ ][-]
# O lazy (.+?) captura o mínimo antes do primeiro valor BRL na linha.
# Isso isola o valor correto mesmo quando há conteúdo da coluna lateral após ele.
# Nota: pdfplumber pode extrair o sinal negativo com espaço antes: "2.692,48 -"
_TX_LINE = re.compile(
    r"^(\d{2}/\d{2})\s+"           # data DD/MM no início da linha
    r"(.+?)\s+"                     # seção do estabelecimento (lazy)
    r"([\d]+(?:\.\d{3})*,\d{2})"   # valor em BRL (formato 1.234,56 ou 123,45)
    r"[ \t]*(-?)"                   # espaço opcional + sinal negativo (estorno)
)

# Parcela no formato NN/NN (pode estar colada ao nome do estabelecimento)
_PARCELA = re.compile(r"(\d{1,2})/(\d{1,2})")

# Total da fatura na linha "Total da fatura em real NNN,NN"
_TOTAL_FATURA = re.compile(r"Total da fatura em real\s+([\d.]+,\d{2})")

# Vencimento: procura DD/MM/YYYY próximo à palavra "Vencimento"
_VENCIMENTO = re.compile(r"Vencimento\b[\s\S]{0,200}?(\d{2})/(\d{2})/(\d{4})")

# Palavras-chave de linhas de pagamento/crédito a ignorar
_SKIP_KEYWORDS = ("PAGTO", "PAGAMENTO", "POR DEB", "CREDITO", "CRÉDITO")


# ── Extração de texto ──────────────────────────────────────────────────────

def extract_text(pdf_bytes: bytes) -> str:
    """
    Extrai texto de um PDF de fatura página por página.
    Usa tabelas apenas como fallback quando a extração de texto falha na página.
    Nunca levanta exceção — retorna string vazia em caso de erro.
    """
    try:
        pages: list[str] = []
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for i, page in enumerate(pdf.pages):
                text = page.extract_text(x_tolerance=2, y_tolerance=2) or ""
                if not text.strip():
                    # Fallback: tabela como texto só quando texto normal está vazio
                    for table in page.extract_tables():
                        for row in table:
                            cells = [str(c).strip() for c in row if c]
                            text += "  |  ".join(cells) + "\n"
                pages.append(f"--- Página {i + 1} ---\n{text}")

        full_text = "\n".join(pages).strip()
        logger.info(f"PDF extraído: {len(pages)} página(s), {len(full_text)} caracteres")
        return full_text

    except Exception as exc:
        logger.warning(f"Falha ao extrair texto do PDF: {exc}")
        return ""


# ── Parser determinístico Bradesco ─────────────────────────────────────────

def parse_bradesco_statement(text: str) -> tuple[list[dict], float | None]:
    """
    Parser determinístico para faturas Bradesco Cartões.

    Detecta o formato Bradesco pela presença de 'Total da fatura em real'.
    Retorna ([], None) se o formato não for reconhecido — o caller usa a IA como fallback.

    Algoritmo:
    - Cada linha válida começa com DD/MM seguido de estabelecimento e valor BRL.
    - Parcelas no formato NN/NN aparecem após o nome do estabelecimento (às vezes coladas).
    - Linhas de pagamento (PAGTO. POR DEB EM C/C) são ignoradas.
    - Todas as transações recebem data dentro do mês de referência do extrato
      para garantir que apareçam corretamente no dashboard mensal.
    """
    if "Total da fatura em real" not in text:
        return [], None

    # Total da fatura (Compras/Débitos)
    total_fatura: float | None = None
    m_total = _TOTAL_FATURA.search(text)
    if m_total:
        total_fatura = _parse_brl(m_total.group(1))

    # Mês/ano de referência do extrato a partir do vencimento
    stmt_year, stmt_month = _infer_stmt_period(text)

    transactions: list[dict] = []
    for line in text.splitlines():
        tx = _parse_line(line.strip(), stmt_year, stmt_month)
        if tx is not None:
            transactions.append(tx)

    logger.info(
        "bradesco_parser_concluido: %d transacoes, total=%.2f, periodo=%s-%02d",
        len(transactions), total_fatura or 0, stmt_year, stmt_month,
    )
    return transactions, total_fatura


def _infer_stmt_period(text: str) -> tuple[int, int]:
    """Infere o mês/ano do extrato a partir da data de vencimento."""
    from datetime import date as _date
    m = _VENCIMENTO.search(text)
    if m:
        venc_month, venc_year = int(m.group(2)), int(m.group(3))
        stmt_month = venc_month - 1 or 12
        stmt_year = venc_year if venc_month > 1 else venc_year - 1
        return stmt_year, stmt_month
    today = _date.today()
    return today.year, today.month


def _parse_line(line: str, stmt_year: int, stmt_month: int) -> dict | None:
    """
    Tenta parsear uma linha de transação Bradesco.

    Formato esperado:
        DD/MM ESTABELECIMENTO [NN/NN parcela] [CIDADE] VALOR[-] [conteúdo lateral...]

    Retorna None se a linha não for uma transação válida.
    """
    m = _TX_LINE.match(line)
    if not m:
        return None

    date_str, middle, value_str, minus = m.groups()

    # Ignorar linhas de pagamento automático (não são compras)
    middle_upper = middle.upper()
    if any(kw in middle_upper for kw in _SKIP_KEYWORDS):
        return None

    # Extrair e remover indicador de parcela (NN/NN) do meio da linha
    parcela_atual, total_parcelas = 1, 1
    m_parc = _PARCELA.search(middle)
    if m_parc:
        p, t = int(m_parc.group(1)), int(m_parc.group(2))
        if 1 <= p <= t <= 48:  # sanidade: parcela válida
            parcela_atual, total_parcelas = p, t
            start, end = m_parc.span()
            middle = re.sub(r"\s{2,}", " ", middle[:start] + middle[end:]).strip()

    estabelecimento = middle.strip()

    # Valor (minus pode ser "-" ou " -" dependendo do extrator pdfplumber)
    valor = _parse_brl(value_str)
    if "-" in minus:
        valor = -valor

    # Data: usa sempre o mês do extrato para garantir que parcelados de meses
    # anteriores apareçam no dashboard do mês correto (mês de cobrança).
    tx_day = int(date_str[:2])
    max_day = calendar.monthrange(stmt_year, stmt_month)[1]
    tx_day = min(tx_day, max_day)
    data = f"{stmt_year}-{stmt_month:02d}-{tx_day:02d}"

    return {
        "data": data,
        "descricao": estabelecimento,
        "valor": valor,
        "categoria": "outros",
        "estabelecimento": estabelecimento,
        "parcela_atual": parcela_atual,
        "total_parcelas": total_parcelas,
        "estorno": valor < 0,
    }


def _parse_brl(value_str: str) -> float:
    """Converte '3.566,37' → 3566.37"""
    return float(value_str.replace(".", "").replace(",", "."))
