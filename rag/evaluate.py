"""
Entry point de avaliação RAG — delega para observability/rag_evaluator.py.

Uso:
    PYTHONPATH=. python rag/evaluate.py
    PYTHONPATH=. python rag/evaluate.py --prompt-version v1
    PYTHONPATH=. python rag/evaluate.py --compare
"""
from observability.rag_evaluator import evaluate, compare_prompt_versions

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt-version", default="v2")
    parser.add_argument("--compare", action="store_true")
    args = parser.parse_args()

    if args.compare:
        compare_prompt_versions(["v1", "v2"])
    else:
        evaluate(prompt_version=args.prompt_version)
