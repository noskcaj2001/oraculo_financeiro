"""
Dataset golden fixo para avaliação do pipeline RAG.

Cada entrada tem:
  - question:     pergunta enviada ao Oráculo
  - ground_truth: resposta esperada concisa (gabarito para o Judge)
  - ticker_filter: ticker para filtrar o contexto (None = todos)
  - category:     tipo de pergunta (indicador / tendência / comparação / conceito)

O dataset é imutável — toda vez que trocar prompt ou retrieval,
a avaliação roda contra as mesmas perguntas, tornando os runs comparáveis no MLflow.
"""
import pandas as pd

EVAL_DATASET: list[dict] = [
    # --- Indicadores técnicos ---
    {
        "question":     "Qual o RSI médio de PETR4 nas últimas semanas e o que ele indica?",
        "ground_truth": "O RSI de PETR4 nas últimas semanas se encontra em torno de 40-60, "
                        "indicando zona neutra. RSI abaixo de 30 indica sobrevenda e acima de "
                        "70 indica sobrecompra.",
        "ticker_filter": "PETR4.SA",
        "category":     "indicador",
    },
    {
        "question":     "O MACD de VALE3 está positivo ou negativo recentemente?",
        "ground_truth": "O MACD de VALE3 indica a diferença entre médias móveis de 12 e 26 "
                        "períodos. Quando positivo, sugere tendência de alta; quando negativo, "
                        "sugere tendência de baixa.",
        "ticker_filter": "VALE3.SA",
        "category":     "indicador",
    },
    {
        "question":     "Como está a volatilidade de MGLU3 nos últimos 20 dias?",
        "ground_truth": "A volatilidade de 20 dias de MGLU3 mede o desvio padrão dos retornos "
                        "logarítmicos. Valores acima de 0.03 indicam alta volatilidade para "
                        "ações brasileiras.",
        "ticker_filter": "MGLU3.SA",
        "category":     "indicador",
    },
    {
        "question":     "As Bandas de Bollinger de ITUB4 estão comprimidas ou expandidas?",
        "ground_truth": "Bandas de Bollinger comprimidas (baixo bb_width) indicam consolidação "
                        "e possível movimento forte em breve. Bandas expandidas indicam alta "
                        "volatilidade em curso.",
        "ticker_filter": "ITUB4.SA",
        "category":     "indicador",
    },
    # --- Tendência de preço ---
    {
        "question":     "WEGE3 apresentou tendência de alta ou queda nas últimas semanas?",
        "ground_truth": "A tendência de WEGE3 é determinada pela variação percentual do "
                        "fechamento semanal. Uma variação positiva acumulada indica tendência "
                        "de alta.",
        "ticker_filter": "WEGE3.SA",
        "category":     "tendencia",
    },
    {
        "question":     "Qual foi o maior fechamento semanal de SUZB3 no último trimestre?",
        "ground_truth": "O maior fechamento semanal de SUZB3 no período pode ser identificado "
                        "pelo pico de preço de fechamento nos resumos semanais disponíveis.",
        "ticker_filter": "SUZB3.SA",
        "category":     "tendencia",
    },
    {
        "question":     "BBAS3 está próximo das máximas ou mínimas históricas recentes?",
        "ground_truth": "A posição de BBAS3 em relação às máximas e mínimas recentes pode ser "
                        "avaliada comparando o preço atual com as máximas e mínimas dos últimos "
                        "meses nos resumos semanais.",
        "ticker_filter": "BBAS3.SA",
        "category":     "tendencia",
    },
    # --- Comparação entre ativos ---
    {
        "question":     "Qual ativo teve melhor desempenho recente: PETR4 ou VALE3?",
        "ground_truth": "A comparação de desempenho entre PETR4 e VALE3 é feita pela variação "
                        "percentual acumulada no período. O ativo com maior variação positiva "
                        "teve melhor desempenho.",
        "ticker_filter": None,
        "category":     "comparacao",
    },
    {
        "question":     "Entre ITUB4 e BBDC4, qual apresenta maior volatilidade recente?",
        "ground_truth": "A volatilidade de 20 dias mede o risco do ativo. O ativo com maior "
                        "desvio padrão dos retornos logarítmicos apresenta maior volatilidade.",
        "ticker_filter": None,
        "category":     "comparacao",
    },
    # --- Conceitos e análise geral ---
    {
        "question":     "Quais ações do portfólio mostram sinal de sobrecompra pelo RSI?",
        "ground_truth": "Ações com RSI acima de 70 são consideradas sobrecompradas, indicando "
                        "possível correção. O Oráculo deve identificar quais tickers do "
                        "portfólio estão nessa condição.",
        "ticker_filter": None,
        "category":     "analise",
    },
    {
        "question":     "Qual ação teve maior volume médio nas últimas semanas?",
        "ground_truth": "O volume médio semanal indica a liquidez do ativo. Entre os tickers "
                        "do portfólio, PETR4, VALE3 e ITUB4 tendem a ter os maiores volumes "
                        "por serem blue chips de alta liquidez.",
        "ticker_filter": None,
        "category":     "analise",
    },
    {
        "question":     "RENT3 apresenta algum padrão de reversão de tendência recente?",
        "ground_truth": "Padrões de reversão podem ser identificados pela convergência de "
                        "indicadores: RSI saindo de extremos, cruzamento do MACD e preço "
                        "tocando bandas de Bollinger.",
        "ticker_filter": "RENT3.SA",
        "category":     "analise",
    },
]


def get_eval_dataframe() -> pd.DataFrame:
    """Retorna o dataset como DataFrame pronto para mlflow.evaluate()."""
    return pd.DataFrame(EVAL_DATASET)
