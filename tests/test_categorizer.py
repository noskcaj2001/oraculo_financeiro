"""Testes de categorização de transações de fatura."""

from __future__ import annotations

import pytest

from backend.modules.personal_finance import categorizer
from backend.modules.personal_finance.categories import CATEGORY_SLUGS, normalize_merchant


# ── normalize_merchant ───────────────────────────────────────────────────

@pytest.mark.parametrize(
    "raw, expected",
    [
        ("MP*EBAZARCOMBRLTDA OSASCO", "EBAZARCOMBRLTDA"),
        ("MP*E BAZAR COM BR LTDA OSASCO", "E BAZAR COM BR"),
        ("99Food *Marmitex Everyday Sao Paulo", "MARMITEX EVERYDAY"),
        ("EC *RUNNINGLAND OSASCO", "RUNNINGLAND"),
        ("CENTAURO CE44 SAO PAULO", "CENTAURO"),
        ("PUBLIC ALVARENGA SAO PAULO", "PUBLIC ALVARENGA"),
        ("28/07 UBER *TRIP SAO PAULO", "UBER TRIP"),
        ("  Posto  Titanium   SP ", "POSTO TITANIUM"),
        ("", ""),
    ],
)
def test_normalize_merchant(raw, expected):
    assert normalize_merchant(raw) == expected


def test_normalize_merchant_is_stable():
    a = normalize_merchant("IFD*Restaurante do Ze Sao Paulo")
    b = normalize_merchant("IFD* Restaurante do Ze  SAO PAULO")
    assert a == b == "RESTAURANTE DO ZE"


# ── _apply_rules (fallback regex) ────────────────────────────────────────

@pytest.mark.parametrize(
    "texto, expected",
    [
        ("PUBLIC ALVARENGA mercearia", "supermercado"),
        ("AUTO POSTO BOLZANO", "combustivel"),
        ("UBER TRIP", "transporte"),
        ("IFOOD *ALGO", "delivery"),
        ("PADARIA DOCE PAO", "restaurante_bar"),
        ("DROGASIL 1270", "saude"),
        ("TOTALPASS SAO PAULO", "academia_bemestar"),
        ("NETFLIX.COM", "assinaturas"),
        ("DECATHLON", "esporte"),
        ("RENNER 537 SHOPPING", "vestuario"),
        ("AIRBNB HMXYZ", "viagem"),
        ("SEGURO SUPERPROTEGIDO", "servicos"),
        ("estabelecimento aleatorio xyz", "outros"),
    ],
)
def test_apply_rules(texto, expected):
    assert categorizer._apply_rules(texto, "outros") == expected
    assert expected in CATEGORY_SLUGS


def test_apply_rules_respeita_categoria_existente():
    # já classificada → não sobrescreve
    assert categorizer._apply_rules("NETFLIX", "supermercado") == "supermercado"


# ── categorize_transactions ──────────────────────────────────────────────

class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, table: "_FakeClient", name: str):
        self._t = table
        self._name = name

    def select(self, *_a, **_k):
        return self

    def in_(self, _col, _values):
        return self

    def eq(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return _Resp(self._t.rows.get(self._name, []))

    def upsert(self, rows, **_k):
        self._t.upserts.setdefault(self._name, []).extend(
            rows if isinstance(rows, list) else [rows]
        )
        return self


class _FakeClient:
    def __init__(self, rows: dict | None = None):
        self.rows = rows or {}
        self.upserts: dict = {}

    def table(self, name: str):
        return _Query(self, name)


def _tx(descricao, estabelecimento=None, categoria="outros"):
    return {
        "data": "2026-08-01",
        "descricao": descricao,
        "estabelecimento": estabelecimento or descricao,
        "valor": 50.0,
        "categoria": categoria,
        "parcela_atual": 1,
        "total_parcelas": 1,
        "estorno": False,
    }


def test_dict_hit_tem_precedencia(monkeypatch):
    monkeypatch.setattr(categorizer, "classify_merchants", lambda *a, **k: {})
    client = _FakeClient({
        "merchant_categories": [{"merchant_key": "PUBLIC ALVARENGA", "categoria": "supermercado"}],
    })
    out = categorizer.categorize_transactions(
        [_tx("PUBLIC ALVARENGA SAO PAULO")], client=client
    )
    assert out[0]["categoria"] == "supermercado"
    assert "_key" not in out[0]


def test_miss_vai_para_ia_e_grava_verbete(monkeypatch):
    called = {}

    def fake_classify(items, **_k):
        called["keys"] = [k for k, _ in items]
        return {"LOJA XYZ": {"categoria": "compras", "confianca": 0.8}}

    monkeypatch.setattr(categorizer, "classify_merchants", fake_classify)
    client = _FakeClient({"merchant_categories": []})
    out = categorizer.categorize_transactions([_tx("LOJA XYZ SAO PAULO")], client=client)

    assert called["keys"] == ["LOJA XYZ"]
    assert out[0]["categoria"] == "compras"
    assert client.upserts["merchant_categories"][0]["origem"] == "ia"


def test_correcoes_manuais_viram_few_shot(monkeypatch):
    recebido = {}

    def fake_classify(items, **kw):
        recebido["examples"] = kw.get("examples")
        return {"LOJA NOVA": {"categoria": "compras", "confianca": 0.9}}

    monkeypatch.setattr(categorizer, "classify_merchants", fake_classify)
    client = _FakeClient({
        "merchant_categories": [{"merchant_key": "BAR DO ZE", "categoria": "restaurante_bar"}],
    })
    categorizer.categorize_transactions([_tx("LOJA NOVA SAO PAULO")], client=client)
    assert ("BAR DO ZE", "restaurante_bar") in recebido["examples"]


def test_fallback_regex_quando_ia_devolve_outros(monkeypatch):
    monkeypatch.setattr(
        categorizer, "classify_merchants",
        lambda *a, **k: {"AUTO POSTO BOLZANO": {"categoria": "outros", "confianca": 0.2}},
    )
    client = _FakeClient({"merchant_categories": []})
    out = categorizer.categorize_transactions(
        [_tx("AUTO POSTO BOLZANO SAO PAULO")], client=client
    )
    assert out[0]["categoria"] == "combustivel"


def test_fallback_outros_quando_nada_reconhece(monkeypatch):
    monkeypatch.setattr(categorizer, "classify_merchants", lambda *a, **k: {})
    client = _FakeClient({"merchant_categories": []})
    out = categorizer.categorize_transactions(
        [_tx("XPTO ESTABELECIMENTO DESCONHECIDO")], client=client
    )
    assert out[0]["categoria"] == "outros"


def test_lista_vazia():
    assert categorizer.categorize_transactions([], client=_FakeClient()) == []
