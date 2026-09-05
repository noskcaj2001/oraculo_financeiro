import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import streamlit as st
from config import TICKERS_MVP
from rag.chain import ask

st.set_page_config(page_title="Oráculo — Chat", page_icon="🔮", layout="wide")
st.title("🔮 Oráculo Financeiro — Chat")
st.caption("Faça perguntas sobre ações da B3 em linguagem natural")

# --- Sidebar: filtros ---
with st.sidebar:
    st.header("Filtros")
    ticker_options = ["Todos os tickers"] + TICKERS_MVP
    selected = st.selectbox("Focar em ticker", ticker_options)
    ticker_filter = None if selected == "Todos os tickers" else selected

    top_k = st.slider("Documentos recuperados (top-k)", min_value=3, max_value=10, value=5)
    st.divider()
    st.caption("Os dados têm como base os preços históricos da B3 + indicadores técnicos calculados localmente.")

# --- Histórico de mensagens ---
if "messages" not in st.session_state:
    st.session_state.messages = []

for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

# --- Input ---
question = st.chat_input("Ex: Como está o RSI de PETR4 nas últimas semanas?")

if question:
    st.session_state.messages.append({"role": "user", "content": question})
    with st.chat_message("user"):
        st.markdown(question)

    with st.chat_message("assistant"):
        with st.spinner("Consultando o Oráculo..."):
            try:
                result = ask(question, ticker_filter=ticker_filter, top_k=top_k)
                answer = result["answer"]

                st.markdown(answer)

                with st.expander(
                    f"📄 Contexto utilizado ({len(result['context_docs'])} documentos "
                    f"| {result['latency_ms']:.0f}ms | {result['tokens_used']} tokens)"
                ):
                    for i, doc in enumerate(result["context_docs"], start=1):
                        st.markdown(f"**[{i}]** `{doc.get('ticker','?')}` — {doc.get('period','?')} "
                                    f"*(score: {doc.get('score', 0):.3f})*")
                        st.caption(doc.get("text", ""))

            except Exception as e:
                answer = f"Erro ao consultar o Oráculo: {e}"
                st.error(answer)

    st.session_state.messages.append({"role": "assistant", "content": answer})
