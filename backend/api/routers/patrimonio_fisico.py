from __future__ import annotations

import re
from datetime import datetime, timezone

import httpx
import structlog
from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel

from storage.supabase_client import get_client

logger = structlog.get_logger()

router = APIRouter(prefix="/api/patrimonio-fisico", tags=["patrimonio-fisico"])

_TIPOS_VALIDOS = {"carro", "imovel", "outro"}
_FIPE_BASE = "https://veiculos.fipe.org.br/api/veiculos"
_FIPE_TIMEOUT = 8.0

_BRL_RE = re.compile(r"R\$\s*([\d.,]+)")


# ── Schemas ────────────────────────────────────────────────────────────────

class PatrimonioFisicoCreate(BaseModel):
    tipo: str
    descricao: str
    marca: str | None = None
    modelo: str | None = None
    ano_modelo: int | None = None
    ano_fabricacao: int | None = None
    placa: str | None = None
    fipe_codigo: str | None = None
    fipe_params: dict | None = None
    valor_manual: float | None = None
    valor_aquisicao: float | None = None
    data_aquisicao: str | None = None


class PatrimonioFisicoUpdate(BaseModel):
    descricao: str | None = None
    marca: str | None = None
    modelo: str | None = None
    ano_modelo: int | None = None
    placa: str | None = None
    valor_manual: float | None = None
    valor_aquisicao: float | None = None
    data_aquisicao: str | None = None


class PatrimonioFisicoItem(BaseModel):
    id: str
    tipo: str
    descricao: str
    marca: str | None
    modelo: str | None
    ano_modelo: int | None
    ano_fabricacao: int | None
    placa: str | None
    fipe_codigo: str | None
    fipe_params: dict | None
    valor_fipe: float | None
    valor_manual: float | None
    valor_aquisicao: float | None
    data_aquisicao: str | None
    fipe_updated_at: str | None
    valor_efetivo: float
    depreciacao_pct: float | None
    created_at: str


# ── FIPE helpers ───────────────────────────────────────────────────────────

def _parse_brl(valor_str: str) -> float | None:
    m = _BRL_RE.search(valor_str)
    if not m:
        return None
    try:
        return float(m.group(1).replace(".", "").replace(",", "."))
    except ValueError:
        return None


async def _fipe_get(path: str) -> list | dict:
    async with httpx.AsyncClient(timeout=_FIPE_TIMEOUT) as client:
        resp = await client.post(f"{_FIPE_BASE}/{path}", headers={"Content-Type": "application/json"})
        resp.raise_for_status()
        return resp.json()


async def _buscar_valor_fipe(fipe_params: dict) -> tuple[float | None, str | None]:
    """Retorna (valor_float, fipe_codigo) ou (None, None) em caso de falha."""
    try:
        marca_id = fipe_params.get("marca_id")
        modelo_id = fipe_params.get("modelo_id")
        ano_id = fipe_params.get("ano_id")

        if not all([marca_id, modelo_id, ano_id]):
            return None, None

        async with httpx.AsyncClient(timeout=_FIPE_TIMEOUT) as client:
            resp = await client.post(
                f"{_FIPE_BASE}/ConsultarValorComTodosParametros",
                json={
                    "codigoTabelaReferencia": fipe_params.get("tabela_ref", 0),
                    "codigoTipoVeiculo": 1,
                    "codigoMarca": marca_id,
                    "codigoModelo": modelo_id,
                    "ano": ano_id,
                    "codigoTipoCombustivel": fipe_params.get("combustivel_id", 1),
                    "anoModelo": fipe_params.get("ano_modelo", 0),
                    "tipoConsulta": "tradicional",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        valor = _parse_brl(data.get("Valor", ""))
        codigo = data.get("CodigoFipe")
        return valor, codigo
    except Exception as exc:
        logger.warning("fipe_busca_falhou", error=str(exc))
        return None, None


def _to_item(row: dict) -> PatrimonioFisicoItem:
    valor_efetivo = float(row.get("valor_manual") or row.get("valor_fipe") or 0)
    valor_aquisicao = row.get("valor_aquisicao")
    depreciacao_pct: float | None = None
    if valor_aquisicao and float(valor_aquisicao) > 0 and valor_efetivo > 0:
        depreciacao_pct = round((float(valor_aquisicao) - valor_efetivo) / float(valor_aquisicao) * 100, 1)
    return PatrimonioFisicoItem(
        id=row["id"],
        tipo=row["tipo"],
        descricao=row["descricao"],
        marca=row.get("marca"),
        modelo=row.get("modelo"),
        ano_modelo=row.get("ano_modelo"),
        ano_fabricacao=row.get("ano_fabricacao"),
        placa=row.get("placa"),
        fipe_codigo=row.get("fipe_codigo"),
        fipe_params=row.get("fipe_params"),
        valor_fipe=row.get("valor_fipe"),
        valor_manual=row.get("valor_manual"),
        valor_aquisicao=float(valor_aquisicao) if valor_aquisicao else None,
        data_aquisicao=row.get("data_aquisicao"),
        fipe_updated_at=row.get("fipe_updated_at"),
        valor_efetivo=valor_efetivo,
        depreciacao_pct=depreciacao_pct,
        created_at=row["created_at"],
    )


def _registrar_historico(client, asset_id: str, valor: float) -> None:
    """Salva valor FIPE no histórico de depreciação (upsert por dia)."""
    try:
        client.table("asset_value_history").upsert({
            "asset_id": asset_id,
            "data_consulta": datetime.now(timezone.utc).date().isoformat(),
            "valor": valor,
            "fonte": "fipe",
        }, on_conflict="asset_id,data_consulta,fonte").execute()
    except Exception as exc:
        logger.warning("historico_asset_falhou", error=str(exc))


def _fipe_precisa_refresh(fipe_updated_at: str | None, dias: int = 30) -> bool:
    """Retorna True se o cache FIPE expirou ou nunca foi preenchido."""
    if not fipe_updated_at:
        return True
    try:
        updated = datetime.fromisoformat(fipe_updated_at.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - updated).days >= dias
    except Exception:
        return True


# ── CRUD Endpoints ─────────────────────────────────────────────────────────

@router.get("", response_model=list[PatrimonioFisicoItem])
async def list_patrimonios() -> list[PatrimonioFisicoItem]:
    try:
        client = get_client()
        resp = client.table("patrimonios_fisicos").select("*").order("created_at").execute()
    except Exception as exc:
        logger.error("patrimonios_list_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
    return [_to_item(r) for r in (resp.data or [])]


@router.post("", response_model=PatrimonioFisicoItem, status_code=201)
async def create_patrimonio(body: PatrimonioFisicoCreate) -> PatrimonioFisicoItem:
    if body.tipo not in _TIPOS_VALIDOS:
        raise HTTPException(status_code=422, detail=f"tipo inválido: {body.tipo}")
    if body.tipo == "imovel" and body.valor_manual is None:
        raise HTTPException(status_code=422, detail="imóveis exigem valor_manual")

    row_data = body.model_dump(exclude_none=False)
    valor_fipe = None
    fipe_codigo = None

    if body.tipo == "carro" and body.fipe_params:
        valor_fipe, fipe_codigo = await _buscar_valor_fipe(body.fipe_params)
        if valor_fipe:
            row_data["valor_fipe"] = valor_fipe
            row_data["fipe_codigo"] = fipe_codigo or body.fipe_codigo
            row_data["fipe_updated_at"] = datetime.now(timezone.utc).isoformat()

    row_data = {k: v for k, v in row_data.items() if v is not None or k in ("valor_fipe", "valor_manual")}

    try:
        client = get_client()
        resp = client.table("patrimonios_fisicos").insert(row_data).execute()
    except Exception as exc:
        logger.error("patrimonios_create_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    row = resp.data[0]
    logger.info("patrimonio_criado", id=row["id"], tipo=body.tipo, descricao=body.descricao)
    return _to_item(row)


@router.put("/{item_id}", response_model=PatrimonioFisicoItem)
async def update_patrimonio(item_id: str, body: PatrimonioFisicoUpdate) -> PatrimonioFisicoItem:
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=422, detail="nenhum campo para atualizar")

    try:
        client = get_client()
        resp = client.table("patrimonios_fisicos").update(updates).eq("id", item_id).execute()
    except Exception as exc:
        logger.error("patrimonios_update_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    if not resp.data:
        raise HTTPException(status_code=404, detail="patrimônio não encontrado")
    return _to_item(resp.data[0])


@router.delete("/{item_id}")
async def delete_patrimonio(item_id: str) -> dict:
    try:
        client = get_client()
        client.table("patrimonios_fisicos").delete().eq("id", item_id).execute()
    except Exception as exc:
        logger.error("patrimonios_delete_falhou", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
    logger.info("patrimonio_deletado", id=item_id)
    return {"ok": True}


@router.get("/{item_id}/refresh-fipe", response_model=PatrimonioFisicoItem)
async def refresh_fipe(item_id: str = Path(...)) -> PatrimonioFisicoItem:
    try:
        client = get_client()
        resp = client.table("patrimonios_fisicos").select("*").eq("id", item_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if not resp.data:
        raise HTTPException(status_code=404, detail="patrimônio não encontrado")

    row = resp.data[0]
    if row["tipo"] != "carro" or not row.get("fipe_params"):
        raise HTTPException(status_code=422, detail="refresh FIPE só disponível para carros com fipe_params")

    # Cache de 30 dias — não chama FIPE desnecessariamente
    if not _fipe_precisa_refresh(row.get("fipe_updated_at")):
        return _to_item(row)

    valor_fipe, fipe_codigo = await _buscar_valor_fipe(row["fipe_params"])
    if valor_fipe is None:
        raise HTTPException(status_code=502, detail="API FIPE indisponível — tente novamente")

    updates = {
        "valor_fipe": valor_fipe,
        "fipe_updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if fipe_codigo:
        updates["fipe_codigo"] = fipe_codigo

    try:
        client = get_client()
        resp = client.table("patrimonios_fisicos").update(updates).eq("id", item_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    _registrar_historico(client, item_id, valor_fipe)
    logger.info("fipe_atualizado", id=item_id, valor_fipe=valor_fipe)
    return _to_item(resp.data[0])


@router.get("/{item_id}/historico")
async def get_historico_asset(item_id: str) -> list[dict]:
    """Retorna histórico de valores FIPE para o gráfico de depreciação."""
    try:
        client = get_client()
        resp = (
            client.table("asset_value_history")
            .select("data_consulta, valor, fonte")
            .eq("asset_id", item_id)
            .order("data_consulta")
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return resp.data or []


# ── FIPE Proxy Endpoints (wizard de seleção) ───────────────────────────────

@router.get("/fipe/tabelas")
async def fipe_tabelas() -> list:
    try:
        async with httpx.AsyncClient(timeout=_FIPE_TIMEOUT) as client:
            resp = await client.post(f"{_FIPE_BASE}/ConsultarTabelaDeReferencia")
            resp.raise_for_status()
            data = resp.json()
        return data[:3] if isinstance(data, list) else [data]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FIPE indisponível: {exc}")


@router.get("/fipe/marcas")
async def fipe_marcas() -> list:
    try:
        async with httpx.AsyncClient(timeout=_FIPE_TIMEOUT) as client:
            tabela_resp = await client.post(f"{_FIPE_BASE}/ConsultarTabelaDeReferencia")
            tabela_resp.raise_for_status()
            tabelas = tabela_resp.json()
            tabela_ref = tabelas[0]["Codigo"] if tabelas else 0

            resp = await client.post(
                f"{_FIPE_BASE}/ConsultarMarcas",
                json={"codigoTabelaReferencia": tabela_ref, "codigoTipoVeiculo": 1},
            )
            resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FIPE indisponível: {exc}")


@router.get("/fipe/modelos/{marca_id}")
async def fipe_modelos(marca_id: int) -> dict:
    try:
        async with httpx.AsyncClient(timeout=_FIPE_TIMEOUT) as client:
            tabela_resp = await client.post(f"{_FIPE_BASE}/ConsultarTabelaDeReferencia")
            tabelas = tabela_resp.json()
            tabela_ref = tabelas[0]["Codigo"] if tabelas else 0

            resp = await client.post(
                f"{_FIPE_BASE}/ConsultarModelos",
                json={
                    "codigoTabelaReferencia": tabela_ref,
                    "codigoTipoVeiculo": 1,
                    "codigoMarca": marca_id,
                },
            )
            resp.raise_for_status()
        return {"tabela_ref": tabela_ref, "modelos": resp.json().get("Modelos", [])}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FIPE indisponível: {exc}")


@router.get("/fipe/anos/{marca_id}/{modelo_id}")
async def fipe_anos(marca_id: int, modelo_id: int, tabela_ref: int = 0) -> list:
    try:
        async with httpx.AsyncClient(timeout=_FIPE_TIMEOUT) as client:
            if tabela_ref == 0:
                tr = await client.post(f"{_FIPE_BASE}/ConsultarTabelaDeReferencia")
                tabela_ref = tr.json()[0]["Codigo"]

            resp = await client.post(
                f"{_FIPE_BASE}/ConsultarAnoModelo",
                json={
                    "codigoTabelaReferencia": tabela_ref,
                    "codigoTipoVeiculo": 1,
                    "codigoMarca": marca_id,
                    "codigoModelo": modelo_id,
                },
            )
            resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FIPE indisponível: {exc}")


@router.get("/fipe/valor/{marca_id}/{modelo_id}/{ano_id}")
async def fipe_valor(marca_id: int, modelo_id: int, ano_id: str, tabela_ref: int = 0) -> dict:
    """ano_id no formato '2021-1' (anoModelo-combustivel)"""
    try:
        partes = ano_id.split("-")
        ano_modelo = int(partes[0])
        combustivel_id = int(partes[1]) if len(partes) > 1 else 1

        async with httpx.AsyncClient(timeout=_FIPE_TIMEOUT) as client:
            if tabela_ref == 0:
                tr = await client.post(f"{_FIPE_BASE}/ConsultarTabelaDeReferencia")
                tabela_ref = tr.json()[0]["Codigo"]

            resp = await client.post(
                f"{_FIPE_BASE}/ConsultarValorComTodosParametros",
                json={
                    "codigoTabelaReferencia": tabela_ref,
                    "codigoTipoVeiculo": 1,
                    "codigoMarca": marca_id,
                    "codigoModelo": modelo_id,
                    "ano": ano_id,
                    "codigoTipoCombustivel": combustivel_id,
                    "anoModelo": ano_modelo,
                    "tipoConsulta": "tradicional",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        valor_float = _parse_brl(data.get("Valor", ""))
        return {
            "valor_str": data.get("Valor"),
            "valor_float": valor_float,
            "fipe_codigo": data.get("CodigoFipe"),
            "marca": data.get("Marca"),
            "modelo": data.get("Modelo"),
            "ano_modelo": data.get("AnoModelo"),
            "combustivel": data.get("Combustivel"),
            "fipe_params": {
                "tabela_ref": tabela_ref,
                "marca_id": marca_id,
                "modelo_id": modelo_id,
                "ano_id": ano_id,
                "ano_modelo": ano_modelo,
                "combustivel_id": combustivel_id,
            },
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FIPE indisponível: {exc}")
