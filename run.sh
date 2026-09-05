#!/bin/bash
# Roda o Oráculo Financeiro com o venv correto
# Uso: ./run.sh
cd "$(dirname "$0")"
PYTHONPATH=. .venv/bin/streamlit run app/main.py "$@"
