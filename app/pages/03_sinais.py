import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import streamlit as st
import pandas as pd
from storage.supabase_client import get_client

st.set_page_config(page_title="Oráculo — Sinais", page_icon="📊", layout="wide")
st.title("📊 Sinais de Mercado — B3")
st.caption("Ranking de ações com sinais de compra/venda gerados pelo modelo XGBoost")

_SIGNAL_COLOR = {"compra": "🟢", "neutro": "🟡", "venda": "🔴"}
_SIGNAL_BG    = {"compra": "#d4edda", "neutro": "#fff3cd", "venda": "#f8d7da"}


@st.cache_data(ttl=300)
def _load_signals() -> pd.DataFrame:
    client = get_client()
    resp = (
        client.table("signals")
        .select("ticker, date, signal, confidence, model_version")
        .order("date", desc=True)
        .limit(200)
        .execute()
    )
    if not resp.data:
        return pd.DataFrame()
    df = pd.DataFrame(resp.data)
    # Manter apenas o sinal mais recente por ticker
    return (
        df.sort_values("date", ascending=False)
        .groupby("ticker")
        .first()
        .reset_index()
        .sort_values("confidence", ascending=False)
    )


df = _load_signals()

if df.empty:
    st.warning("Nenhum sinal encontrado. Execute `python -m ml.predict` para gerar sinais.")
    st.stop()

# --- Métricas de resumo ---
col1, col2, col3, col4 = st.columns(4)
col1.metric("Total de tickers",  len(df))
col2.metric("Compra 🟢",  int((df["signal"] == "compra").sum()))
col3.metric("Neutro 🟡",  int((df["signal"] == "neutro").sum()))
col4.metric("Venda 🔴",   int((df["signal"] == "venda").sum()))

st.divider()

# --- Ranking por confiança ---
st.subheader("Ranking por confiança")

for _, row in df.iterrows():
    icon  = _SIGNAL_COLOR.get(row["signal"], "⚪")
    bg    = _SIGNAL_BG.get(row["signal"], "#ffffff")
    conf_pct = f"{row['confidence'] * 100:.1f}%"

    with st.container():
        c1, c2, c3, c4, c5 = st.columns([2, 2, 2, 2, 3])
        c1.markdown(f"**{row['ticker']}**")
        c2.markdown(f"{icon} **{row['signal'].upper()}**")
        c3.markdown(f"Confiança: **{conf_pct}**")
        c4.markdown(f"Data: `{row['date']}`")
        c5.progress(float(row["confidence"]))

st.divider()

# --- Tabela completa ---
with st.expander("Ver tabela completa"):
    display = df.copy()
    display["signal"] = display["signal"].map(
        lambda s: f"{_SIGNAL_COLOR.get(s,'')} {s}"
    )
    display["confidence"] = (display["confidence"] * 100).round(1).astype(str) + "%"
    st.dataframe(display, use_container_width=True, hide_index=True)

st.caption(f"Modelo: `{df['model_version'].iloc[0]}` | Cache: 5 min")
