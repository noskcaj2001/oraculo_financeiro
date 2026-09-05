import streamlit as st

from data.ingestion.realtime_fetcher import fetch_all_quotes
from storage.supabase_client import get_client as get_supa

st.set_page_config(
    page_title="Oráculo Financeiro",
    page_icon="🔮",
    layout="wide",
)

st.title("🔮 Oráculo Financeiro")
st.caption("Copiloto de investimentos na B3")

st.divider()


@st.cache_data(ttl=60)
def _load_quotes() -> list[dict]:
    return fetch_all_quotes()


@st.cache_data(ttl=300)
def _load_latest_signals() -> dict[str, str]:
    """Retorna mapa ticker → sinal mais recente."""
    try:
        client = get_supa()
        resp = (
            client.table("signals")
            .select("ticker, signal, confidence")
            .order("date", desc=True)
            .limit(100)
            .execute()
        )
        seen: dict[str, str] = {}
        for row in (resp.data or []):
            if row["ticker"] not in seen:
                seen[row["ticker"]] = row["signal"]
        return seen
    except Exception:
        return {}


_SINAL_ICONE = {"compra": "🟢", "neutro": "🟡", "venda": "🔴"}

col_refresh, col_info = st.columns([1, 5])
with col_refresh:
    if st.button("🔄 Atualizar"):
        st.cache_data.clear()
        st.rerun()
with col_info:
    st.caption("Fonte: yfinance (~15 min delay)  |  Cache Redis: 60s")

st.subheader("Cotações B3 — Tempo Real")

quotes  = _load_quotes()
signals = _load_latest_signals()

cols = st.columns(2)
for i, q in enumerate(quotes):
    pct   = q["pct_change"]
    cor   = "🟢" if pct >= 0 else "🔴"
    sinal = signals.get(q["ticker"], "—")
    icone = _SINAL_ICONE.get(sinal, "⚪")
    sign  = "+" if pct >= 0 else ""

    with cols[i % 2]:
        with st.container(border=True):
            c1, c2, c3 = st.columns([2, 2, 1])
            c1.markdown(f"**{q['ticker']}**")
            c1.markdown(f"R$ **{q['price']:.2f}**")
            c2.markdown(f"{cor} `{sign}{pct:.2f}%`")
            c2.caption(f"Vol {q['volume']:,}")
            c3.markdown(f"{icone}")
            c3.caption(sinal)

st.divider()
st.info(
    "💬 Use a aba **Chat** para perguntas em linguagem natural sobre as ações. "
    "📊 Veja os **Sinais ML** para recomendações do modelo XGBoost."
)
