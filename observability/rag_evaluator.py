"""
Avaliação em batch do pipeline RAG.

Fluxo simplificado:
  1. Carrega o dataset golden (eval_dataset.py)
  2. Executa cada pergunta via ask() — os juízes rodam automaticamente dentro do ask()
     e os assessments ficam gravados no trace do GenAI tab
  3. Lê os resultados de avaliação do retorno do ask() e imprime o resumo

Os assessments (fundamentado, contexto_relevante, classificacao, risco_alucinacao)
são gerados em TODAS as chamadas ao ask() — chat e avaliação recebem o mesmo tratamento.

Uso:
    PYTHONPATH=. python observability/rag_evaluator.py
    PYTHONPATH=. python observability/rag_evaluator.py --prompt-version v1
    PYTHONPATH=. python observability/rag_evaluator.py --compare
"""
import argparse
import logging
import os

import mlflow
import pandas as pd

from config import MLFLOW_TRACKING_URI, OPENAI_API_KEY
from observability.eval_dataset import get_eval_dataframe
from rag.chain import ask

logger = logging.getLogger(__name__)

mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
EXPERIMENT = "oraculo_rag"


def evaluate(prompt_version: str = "v2") -> pd.DataFrame:
    """
    Executa o dataset golden e coleta os resultados de avaliação.
    Os assessments já são gravados nos traces pelo ask() automaticamente.
    """
    os.environ.setdefault("OPENAI_API_KEY", OPENAI_API_KEY)
    mlflow.set_experiment(EXPERIMENT)

    golden_df = get_eval_dataframe()
    print(f"\nDataset golden: {len(golden_df)} perguntas | prompt_version={prompt_version}")
    print("Gerando respostas e avaliando com GenAI Judges...")

    rows = []
    for _, row in golden_df.iterrows():
        question      = row["question"]
        ticker_filter = row.get("ticker_filter")
        print(f"  [{row.get('category', '?')}] {question[:65]}...", flush=True)

        result = ask(question, ticker_filter=ticker_filter, top_k=5,
                     prompt_version=prompt_version)

        rows.append({
            "question":           question,
            "category":           row.get("category"),
            "outputs":            result["answer"],
            "trace_id":           result.get("trace_id"),
            "fundamentado":       result.get("fundamentado"),
            "contexto_relevante": result.get("contexto_relevante"),
            "classificacao":      result.get("classificacao", "DESCONHECIDO"),
            "risco_alucinacao":   result.get("risco_alucinacao", False),
        })

    graded = pd.DataFrame(rows)
    _imprimir_relatorio(graded, prompt_version)
    return graded


def _imprimir_relatorio(graded: pd.DataFrame, prompt_version: str) -> None:
    _ICONE = {"PASS": "✅", "BORDERLINE": "🟡", "FAIL": "❌",
              "HALLUCINATION": "🚨", "DESCONHECIDO": "?"}

    print(f"\n=== Avaliação RAG — prompt {prompt_version} ===")
    for _, row in graded.iterrows():
        icone = _ICONE.get(row["classificacao"], "?")
        flags = (
            f"fund={'sim' if row.get('fundamentado') == 'yes' else 'não'} | "
            f"ctx={'sim' if row.get('contexto_relevante') == 'yes' else 'não'}"
        )
        print(f"  {icone} [{row['classificacao']:<13}] {row['question'][:55]:<55}  {flags}")

    total  = len(graded)
    passed = int((graded["classificacao"] == "PASS").sum())
    halluc = int((graded["classificacao"] == "HALLUCINATION").sum())
    print(f"\n  Resumo: {passed}/{total} PASS "
          f"| {halluc} alucinação(ões) "
          f"| pass_rate={passed/total:.0%}")
    print(f"\nTraces disponíveis em http://localhost:5001 "
          f"→ experimento '{EXPERIMENT}' → aba GenAI/Traces")


def comparar_versoes(versoes: list[str] | None = None) -> None:
    """Avalia múltiplas versões de prompt e exibe comparativo de pass_rate."""
    versoes = versoes or ["v1", "v2"]
    resultados: dict[str, pd.DataFrame] = {}

    for v in versoes:
        print(f"\n{'='*50}\nAvaliando versão: {v}")
        resultados[v] = evaluate(prompt_version=v)

    print("\n=== Comparativo entre versões ===")
    header = f"{'Versão':<6} {'PASS':>6} {'BORDERLINE':>12} {'HALLUC':>8} {'pass_rate':>10}"
    print(header)
    print("-" * len(header))
    for v, df in resultados.items():
        total  = len(df)
        counts = df["classificacao"].value_counts()
        print(
            f"  {v:<4} "
            f"{counts.get('PASS', 0):>6} "
            f"{counts.get('BORDERLINE', 0):>12} "
            f"{counts.get('HALLUCINATION', 0):>8} "
            f"{counts.get('PASS', 0)/total:>9.0%}"
        )


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)

    parser = argparse.ArgumentParser(description="Avaliação RAG em batch")
    parser.add_argument("--prompt-version", default="v2")
    parser.add_argument("--compare", action="store_true",
                        help="Comparar v1 vs v2 em sequência")
    args = parser.parse_args()

    if args.compare:
        comparar_versoes(["v1", "v2"])
    else:
        evaluate(prompt_version=args.prompt_version)
