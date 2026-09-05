"""
Motor de insights financeiros com regras hard-coded baseadas em boas práticas.
Complementa (não substitui) a análise via LLM — gera alertas determinísticos
antes de passar para o GPT, que enriquece com linguagem natural.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


Severidade = Literal["info", "warn", "danger"]


@dataclass
class Alerta:
    tipo: str
    severidade: Severidade
    titulo: str
    descricao: str
    acao_sugerida: str = ""


@dataclass
class Metricas:
    """Métricas derivadas calculadas a partir do monthly_profile."""
    mes: str
    total_renda: float
    total_cartao: float
    total_fixos: float
    total_pontuais: float
    portfolio_b3: float
    ativos_fisicos: float
    total_financiamentos: float

    # Posições da carteira B3 para análise de concentração
    posicoes: list[dict] = field(default_factory=list)
    # Sinais ML para os tickers da carteira
    sinais: list[dict] = field(default_factory=list)
    # Meta de patrimônio do usuário (opcional)
    meta_patrimonio: float = 0.0

    @property
    def total_saidas(self) -> float:
        return self.total_cartao + self.total_fixos + self.total_pontuais

    @property
    def saldo(self) -> float:
        return self.total_renda - self.total_saidas

    @property
    def taxa_comprometimento(self) -> float:
        if self.total_renda <= 0:
            return 0.0
        return self.total_saidas / self.total_renda * 100

    @property
    def taxa_poupanca(self) -> float:
        if self.total_renda <= 0:
            return 0.0
        return max(0.0, self.saldo / self.total_renda * 100)

    @property
    def patrimonio_liquido(self) -> float:
        return self.portfolio_b3 + self.ativos_fisicos - self.total_financiamentos

    @property
    def total_ativos(self) -> float:
        return self.portfolio_b3 + self.ativos_fisicos


# ── Regras financeiras ─────────────────────────────────────────────────────

def regra_comprometimento(m: Metricas) -> Alerta | None:
    """Comprometimento de renda com dívidas (cartão + fixos + pontuais) > 70% = perigo."""
    if m.total_renda <= 0:
        return None

    pct = m.taxa_comprometimento

    if pct > 90:
        return Alerta(
            tipo="comprometimento",
            severidade="danger",
            titulo=f"Comprometimento crítico: {pct:.0f}% da renda",
            descricao=f"Suas saídas ({_brl(m.total_saidas)}) consomem {pct:.0f}% da sua renda de {_brl(m.total_renda)}. Sobram apenas {_brl(m.saldo)}.",
            acao_sugerida="Revise gastos fixos e reduza o limite do cartão. Uma situação acima de 90% é insustentável a médio prazo.",
        )
    if pct > 70:
        return Alerta(
            tipo="comprometimento",
            severidade="warn",
            titulo=f"Comprometimento alto: {pct:.0f}% da renda",
            descricao=f"Suas saídas totalizam {_brl(m.total_saidas)} ({pct:.0f}% da renda). O recomendado é manter abaixo de 70%.",
            acao_sugerida="Identifique os maiores itens de custo e avalie o que pode ser reduzido.",
        )
    return None


def regra_poupanca(m: Metricas) -> Alerta | None:
    """Taxa de poupança abaixo de 10% é sinal de alerta; abaixo de 5% é crítico."""
    if m.total_renda <= 0:
        return None

    pct = m.taxa_poupanca

    if pct < 5:
        return Alerta(
            tipo="poupanca",
            severidade="danger",
            titulo=f"Taxa de poupança muito baixa: {pct:.1f}%",
            descricao=f"Você está poupando apenas {_brl(m.saldo)} ({pct:.1f}%) da sua renda. Isso compromete a construção de patrimônio.",
            acao_sugerida="Meta mínima: poupar 10% da renda. Identifique um gasto para cortar este mês.",
        )
    if pct < 15:
        return Alerta(
            tipo="poupanca",
            severidade="warn",
            titulo=f"Taxa de poupança abaixo da meta: {pct:.1f}%",
            descricao=f"Você está poupando {_brl(m.saldo)} ({pct:.1f}%). A meta recomendada é 20%.",
            acao_sugerida=f"Para atingir 20%, você precisaria poupar {_brl(m.total_renda * 0.20)} por mês.",
        )
    return None


def regra_gasto_pontual(m: Metricas) -> Alerta | None:
    """Gastos pontuais acima de 10% da renda merecem atenção."""
    if m.total_renda <= 0 or m.total_pontuais <= 0:
        return None

    pct = m.total_pontuais / m.total_renda * 100

    if pct > 20:
        return Alerta(
            tipo="gasto_pontual",
            severidade="danger",
            titulo=f"Gastos imprevistos altos: {_brl(m.total_pontuais)} ({pct:.0f}% da renda)",
            descricao=f"Gastos pontuais de {_brl(m.total_pontuais)} representam {pct:.0f}% da sua renda em {m.mes}.",
            acao_sugerida="Considere criar uma reserva de emergência dedicada a gastos imprevistos (meta: 3–6x salário).",
        )
    if pct > 10:
        return Alerta(
            tipo="gasto_pontual",
            severidade="warn",
            titulo=f"Gastos pontuais acima da média: {_brl(m.total_pontuais)}",
            descricao=f"Gastos não recorrentes representaram {pct:.0f}% da sua renda em {m.mes}.",
            acao_sugerida="Avalie se esse valor pode ser diluído nos próximos meses.",
        )
    return None


def regra_concentracao_b3(m: Metricas) -> list[Alerta]:
    """Detecta concentração excessiva por ativo ou setor na carteira B3."""
    alertas: list[Alerta] = []

    if not m.posicoes or m.portfolio_b3 <= 0:
        return alertas

    # Concentração por ativo individual
    for p in m.posicoes:
        valor = float(p.get("valor_atualizado") or p.get("valor_aplicado") or 0)
        if valor <= 0:
            continue
        pct = valor / m.portfolio_b3 * 100
        ticker = p.get("ticker", "")
        if pct > 40:
            alertas.append(Alerta(
                tipo="concentracao_b3",
                severidade="danger",
                titulo=f"Concentração excessiva em {ticker}: {pct:.0f}%",
                descricao=f"{ticker} representa {pct:.0f}% da carteira ({_brl(valor)}). Concentração > 40% aumenta o risco não-diversificado.",
                acao_sugerida=f"Reduza a posição em {ticker} ou aporte em outros ativos para balancear.",
            ))
        elif pct > 25:
            alertas.append(Alerta(
                tipo="concentracao_b3",
                severidade="warn",
                titulo=f"Alta concentração em {ticker}: {pct:.0f}%",
                descricao=f"{ticker} representa {pct:.0f}% da carteira. O recomendado é manter cada ativo abaixo de 25%.",
                acao_sugerida="Considere diversificar aportes futuros em outros ativos.",
            ))

    return alertas


def regra_sinais_ml(m: Metricas) -> list[Alerta]:
    """Alerta quando a carteira tem posições com sinal de VENDA de alta confiança."""
    alertas: list[Alerta] = []

    if not m.sinais or not m.posicoes:
        return alertas

    pos_valores = {
        p.get("ticker", "").replace(".SA", ""): float(p.get("valor_atualizado") or p.get("valor_aplicado") or 0)
        for p in m.posicoes
    }

    for s in m.sinais:
        if s.get("signal") == "venda" and float(s.get("confidence", 0)) >= 0.65:
            ticker = s["ticker"]
            conf = float(s["confidence"]) * 100
            valor = pos_valores.get(ticker, 0)
            if valor > 0:
                alertas.append(Alerta(
                    tipo="sinal_venda",
                    severidade="warn",
                    titulo=f"Sinal de VENDA em {ticker} (confiança {conf:.0f}%)",
                    descricao=f"O modelo ML gerou sinal de venda em {ticker} com {conf:.0f}% de confiança. Você tem {_brl(valor)} nesse ativo.",
                    acao_sugerida=f"Avalie no chat B3: 'Quais os fundamentos por trás do sinal de venda em {ticker}?'",
                ))

    return alertas


def regra_meta_patrimonio(m: Metricas) -> Alerta | None:
    """Se há meta definida, projeta o prazo com o aporte atual."""
    if m.meta_patrimonio <= 0 or m.portfolio_b3 <= 0:
        return None
    if m.patrimonio_liquido >= m.meta_patrimonio:
        return Alerta(
            tipo="meta_patrimonio",
            severidade="info",
            titulo="Meta de patrimônio atingida!",
            descricao=f"Seu patrimônio líquido de {_brl(m.patrimonio_liquido)} já ultrapassou a meta de {_brl(m.meta_patrimonio)}.",
            acao_sugerida="Considere revisar sua meta para um novo patamar.",
        )

    falta = m.meta_patrimonio - m.patrimonio_liquido
    aporte = max(m.saldo, 0)
    if aporte > 0:
        taxa_mensal = 0.10 / 12
        # Meses para atingir a meta com aportes e juros compostos
        import math
        try:
            meses = math.log(1 + (falta * taxa_mensal / aporte)) / math.log(1 + taxa_mensal)
            anos = meses / 12
            return Alerta(
                tipo="meta_patrimonio",
                severidade="info",
                titulo=f"Meta de {_brl(m.meta_patrimonio)} em {anos:.1f} anos",
                descricao=f"Com o aporte atual de {_brl(aporte)}/mês e rentabilidade de 10% a.a., você atingirá sua meta em aproximadamente {anos:.1f} anos ({int(meses)} meses).",
                acao_sugerida=f"Para atingir em {max(1, anos - 1):.0f} anos, precisaria aportar {_brl(falta * taxa_mensal / ((1+taxa_mensal)**int(meses*0.8) - 1))}/mês.",
            )
        except (ValueError, ZeroDivisionError):
            pass
    return None


def regra_renda_zero(m: Metricas) -> Alerta | None:
    if m.total_renda <= 0:
        return Alerta(
            tipo="sem_renda",
            severidade="info",
            titulo="Renda não registrada neste mês",
            descricao=f"Não há lançamentos de renda em {m.mes}. Os indicadores podem estar incompletos.",
            acao_sugerida="Acesse Visão Geral → registre sua renda do mês para análises precisas.",
        )
    return None


# ── Entry point ────────────────────────────────────────────────────────────

def gerar_alertas(m: Metricas) -> list[Alerta]:
    """Executa todas as regras e retorna a lista de alertas ordenada por severidade."""
    alertas: list[Alerta] = []

    for regra_fn in [
        regra_renda_zero,
        regra_comprometimento,
        regra_poupanca,
        regra_gasto_pontual,
        regra_meta_patrimonio,
    ]:
        resultado = regra_fn(m)
        if resultado:
            alertas.append(resultado)

    alertas.extend(regra_concentracao_b3(m))
    alertas.extend(regra_sinais_ml(m))

    # Ordenar: danger → warn → info
    ordem = {"danger": 0, "warn": 1, "info": 2}
    return sorted(alertas, key=lambda a: ordem[a.severidade])


def _brl(v: float) -> str:
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
