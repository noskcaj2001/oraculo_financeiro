import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, ReferenceLine,
} from "recharts"
import { usePatrimonioTotal, useAssetHistory } from "@/api/patrimonioTotal"
import {
  usePatrimoniosFisicos, useCreatePatrimonioFisico, useDeletePatrimonioFisico,
  useRefreshFipe, useFipeMarcas, useFipeModelos, useFipeAnos, useFipeValor,
  useFinanciamentos, useCreateFinanciamento, useDeleteFinanciamento,
  type PatrimonioFisicoCreate, type FinanciamentoCreate, type FinanciamentoItem,
} from "@/api/analiseIntegrada"
import { useState, useEffect } from "react"
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

// ── Formatação ──────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function pct(v: number, casas = 1) {
  return `${v.toFixed(casas)}%`
}

// ── KPI Card ───────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: "green" | "red" | "blue" | "yellow"
}) {
  const border = {
    green: "border-l-emerald-500",
    red: "border-l-red-500",
    blue: "border-l-indigo-500",
    yellow: "border-l-yellow-500",
  }[accent ?? "blue"] ?? "border-l-indigo-500"

  return (
    <div className={`bg-card border border-border border-l-4 ${border} rounded-xl p-4`}>
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  )
}

// ── Gauge de Equity ────────────────────────────────────────────────────────

function EquityBar({ pago, label }: { pago: number; label: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>{label}</span>
        <span className="font-medium text-foreground">{pct(pago)} pago</span>
      </div>
      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all"
          style={{ width: `${Math.min(100, pago)}%` }}
        />
      </div>
    </div>
  )
}

// ── Gráfico de Depreciação ─────────────────────────────────────────────────

function DepreciacaoChart({ assetId }: { assetId: string }) {
  const { data = [], isLoading } = useAssetHistory(assetId)

  if (isLoading) return <p className="text-xs text-muted-foreground">Carregando histórico...</p>
  if (data.length < 2) return <p className="text-xs text-muted-foreground italic">Histórico disponível após 2+ consultas FIPE</p>

  const chartData = data.map((d) => ({
    name: d.data_consulta.slice(0, 7),
    valor: d.valor,
  }))

  return (
    <ResponsiveContainer width="100%" height={90}>
      <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 9 }} tickLine={false} />
        <YAxis hide domain={["auto", "auto"]} />
        <Tooltip formatter={(v: number) => [brl(v), "Valor FIPE"]} />
        <Line type="monotone" dataKey="valor" stroke="#6366f1" strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── FIPE Wizard (reusado da AnaliseIntegrada) ──────────────────────────────

function FipeWizard({ onConfirm }: { onConfirm: (data: PatrimonioFisicoCreate) => void }) {
  const [step, setStep] = useState(0)
  const [descricao, setDescricao] = useState("")
  const [valorAquisicao, setValorAquisicao] = useState("")
  const [marcaId, setMarcaId] = useState<number | null>(null)
  const [modeloId, setModeloId] = useState<number | null>(null)
  const [anoId, setAnoId] = useState<string | null>(null)
  const [tabelaRef, setTabelaRef] = useState(0)

  const { data: marcas, isLoading: lMarcas } = useFipeMarcas()
  const { data: modelosData, isLoading: lModelos } = useFipeModelos(marcaId)
  const { data: anos, isLoading: lAnos } = useFipeAnos(marcaId, modeloId, tabelaRef)
  const { data: valorData, isLoading: lValor } = useFipeValor(marcaId, modeloId, anoId, tabelaRef)

  const cls = "w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"

  if (step === 0) return (
    <div className="space-y-2">
      <input className={cls} placeholder="Descrição (ex: Corolla XEI 2022)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      <input type="number" min="0" step="1000" className={cls} placeholder="Valor de aquisição R$ (opcional)" value={valorAquisicao} onChange={(e) => setValorAquisicao(e.target.value)} />
      <button disabled={!descricao} onClick={() => setStep(1)} className="w-full bg-primary text-primary-foreground rounded-lg py-2 text-sm font-medium disabled:opacity-50">
        Próximo — Marca
      </button>
    </div>
  )

  if (step === 1) return (
    <div className="space-y-2">
      {lMarcas ? <p className="text-sm text-muted-foreground">Carregando marcas...</p> : (
        <select className={cls} value={marcaId ?? ""} onChange={(e) => { setMarcaId(Number(e.target.value)); setModeloId(null); setAnoId(null) }}>
          <option value="">Selecione a marca</option>
          {marcas?.map((m) => <option key={m.Value} value={m.Value}>{m.Label}</option>)}
        </select>
      )}
      <div className="flex gap-2">
        <button onClick={() => setStep(0)} className="flex-1 border border-border rounded-lg py-2 text-sm">Voltar</button>
        <button disabled={!marcaId} onClick={() => { setTabelaRef(modelosData?.tabela_ref ?? 0); setStep(2) }} className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-sm font-medium disabled:opacity-50">Próximo</button>
      </div>
    </div>
  )

  if (step === 2) return (
    <div className="space-y-2">
      {lModelos ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
        <select className={cls} value={modeloId ?? ""} onChange={(e) => { setModeloId(Number(e.target.value)); setAnoId(null) }}>
          <option value="">Selecione o modelo</option>
          {modelosData?.modelos.map((m) => <option key={m.Value} value={m.Value}>{m.Label}</option>)}
        </select>
      )}
      <div className="flex gap-2">
        <button onClick={() => setStep(1)} className="flex-1 border border-border rounded-lg py-2 text-sm">Voltar</button>
        <button disabled={!modeloId} onClick={() => setStep(3)} className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-sm font-medium disabled:opacity-50">Próximo</button>
      </div>
    </div>
  )

  if (step === 3) return (
    <div className="space-y-2">
      {lAnos ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
        <select className={cls} value={anoId ?? ""} onChange={(e) => setAnoId(e.target.value)}>
          <option value="">Selecione o ano</option>
          {anos?.map((a) => <option key={a.Value} value={a.Value}>{a.Label}</option>)}
        </select>
      )}
      <div className="flex gap-2">
        <button onClick={() => setStep(2)} className="flex-1 border border-border rounded-lg py-2 text-sm">Voltar</button>
        <button disabled={!anoId} onClick={() => setStep(4)} className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-sm font-medium disabled:opacity-50">Ver FIPE</button>
      </div>
    </div>
  )

  return (
    <div className="space-y-2">
      {lValor ? <p className="text-sm text-muted-foreground">Consultando FIPE...</p> : valorData && (
        <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
          <p>{valorData.marca} {valorData.modelo} {valorData.ano_modelo}</p>
          <p className="text-lg font-bold text-emerald-600">{valorData.valor_str}</p>
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={() => setStep(3)} className="flex-1 border border-border rounded-lg py-2 text-sm">Voltar</button>
        <button disabled={!valorData} onClick={() => {
          if (!valorData) return
          onConfirm({
            tipo: "carro", descricao,
            marca: valorData.marca, modelo: valorData.modelo, ano_modelo: valorData.ano_modelo,
            fipe_codigo: valorData.fipe_codigo, fipe_params: valorData.fipe_params,
            valor_aquisicao: valorAquisicao ? parseFloat(valorAquisicao) : undefined,
          })
        }} className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-sm font-medium disabled:opacity-50">
          Salvar
        </button>
      </div>
    </div>
  )
}

// ── Mapa ────────────────────────────────────────────────────────────────────

const PIN_ICON = L.divIcon({
  className: "",
  html: `<div style="position:relative;width:32px;height:42px;filter:drop-shadow(0 4px 6px rgba(99,102,241,0.4))">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42" width="32" height="42">
      <path d="M16 0C9.4 0 4 5.4 4 12c0 8.8 12 28 12 28S28 20.8 28 12C28 5.4 22.6 0 16 0z" fill="#6366f1"/>
      <circle cx="16" cy="12" r="5" fill="white"/>
      <circle cx="16" cy="12" r="3" fill="#6366f1"/>
    </svg>
    <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:12px;height:4px;background:rgba(99,102,241,0.25);border-radius:50%;filter:blur(3px)"></div>
  </div>`,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  popupAnchor: [0, -44],
})

function MapResizer() {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 150)
    return () => clearTimeout(t)
  }, [map])
  return null
}

function PropertyMap({ coords, address }: { coords: { lat: number; lon: number }; address: string }) {
  return (
    <div className="rounded-xl overflow-hidden border border-border shadow-md" style={{ height: 300 }}>
      <MapContainer
        center={[coords.lat, coords.lon]}
        zoom={16}
        scrollWheelZoom={false}
        zoomControl={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={20}
        />
        <Marker position={[coords.lat, coords.lon]} icon={PIN_ICON}>
          <Popup>
            <span className="text-xs font-medium">{address}</span>
          </Popup>
        </Marker>
        <MapResizer />
      </MapContainer>
    </div>
  )
}

// ── Geocoding via Nominatim ────────────────────────────────────────────────

interface Coords { lat: number; lon: number }

// Bounding boxes (lon_min,lat_min,lon_max,lat_max) das principais cidades BR
const CITY_VIEWBOXES: Record<string, string> = {
  "são paulo":      "-46.826,-23.782,-46.365,-23.356",
  "sao paulo":      "-46.826,-23.782,-46.365,-23.356",
  "rio de janeiro": "-43.796,-23.083,-43.088,-22.745",
  "belo horizonte": "-44.064,-20.077,-43.858,-19.803",
  "brasília":       "-48.330,-16.054,-47.305,-15.503",
  "brasilia":       "-48.330,-16.054,-47.305,-15.503",
  "curitiba":       "-49.410,-25.629,-49.154,-25.328",
  "porto alegre":   "-51.316,-30.274,-51.063,-29.949",
  "salvador":       "-38.570,-13.012,-38.289,-12.806",
  "recife":         "-35.053,-8.159,-34.872,-7.950",
  "fortaleza":      "-38.631,-3.873,-38.410,-3.689",
  "manaus":         "-60.104,-3.202,-59.838,-2.975",
}

function cleanAddress(raw: string): string {
  // "Apartamento - Rua X, 400 - Bairro, Cidade/SP" → "Rua X, 400, Bairro, Cidade, SP, Brasil"
  const parts = raw.split(/\s*-\s*/)
  const addrParts = /\d/.test(parts[0]) ? parts : parts.slice(1)
  return addrParts
    .join(", ")
    .replace(/\/([A-Z]{2})\b/, ", $1, Brasil")
}

function dropNeighborhood(address: string): string {
  // "Rua X, 400, Bairro, Cidade, SP, Brasil" → "Rua X, 400, Cidade, SP, Brasil"
  const tokens = address.split(",").map((s) => s.trim())
  if (tokens.length >= 5) return [...tokens.slice(0, 2), ...tokens.slice(3)].join(", ")
  return address
}

function detectViewbox(raw: string): string | undefined {
  const lower = raw.toLowerCase()
  return Object.entries(CITY_VIEWBOXES).find(([city]) => lower.includes(city))?.[1]
}

async function tryGeocode(q: string, viewbox?: string): Promise<Coords | null> {
  let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=br`
  if (viewbox) url += `&viewbox=${viewbox}&bounded=1`
  const r = await fetch(url, { headers: { "Accept-Language": "pt-BR", "User-Agent": "OraculoClaude/1.0" } })
  const data: Array<{ lat: string; lon: string }> = await r.json()
  if (!data.length) return null
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) }
}

async function geocodeAddress(raw: string): Promise<Coords | null> {
  const full = cleanAddress(raw)
  const vb = detectViewbox(raw)
  // 1) endereço completo limpo + viewbox da cidade
  return (
    (await tryGeocode(full, vb)) ??
    // 2) sem bairro + viewbox
    (await tryGeocode(dropNeighborhood(full), vb)) ??
    // 3) sem viewbox (nacional)
    (await tryGeocode(dropNeighborhood(full)))
  )
}

// ── Card de Financiamento ──────────────────────────────────────────────────

function FinanciamentoCard({ f, onDelete }: { f: FinanciamentoItem; onDelete: () => void }) {
  const [showMap, setShowMap] = useState(false)
  const [coords, setCoords] = useState<Coords | null>(null)
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState("")
  const [customQuery, setCustomQuery] = useState("")
  const [showCustomInput, setShowCustomInput] = useState(false)

  const pagoPct = f.valor_total > 0 ? ((f.valor_total - f.saldo_devedor) / f.valor_total) * 100 : 0
  const taxaAnual = (Math.pow(1 + f.taxa_mensal, 12) - 1) * 100
  const totalRestante = f.meses_restantes !== null ? f.parcela_mensal * f.meses_restantes : null
  const jurosRestantes = totalRestante !== null ? totalRestante - f.saldo_devedor : null

  function runGeocode(query: string) {
    setGeoLoading(true)
    setGeoError("")
    geocodeAddress(query)
      .then((c) => {
        if (c) { setCoords(c); setGeoError(""); setShowCustomInput(false) }
        else { setGeoError("Endereço não encontrado."); setShowCustomInput(true) }
      })
      .catch(() => { setGeoError("Erro ao buscar localização."); setShowCustomInput(true) })
      .finally(() => setGeoLoading(false))
  }

  useEffect(() => {
    if (!showMap || coords) return
    runGeocode(f.descricao)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap])

  const gmapsUrl = `https://maps.google.com/maps?q=${encodeURIComponent(f.descricao)}`

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">{f.descricao}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {[f.banco, f.tipo === "imovel" ? "Imóvel" : f.tipo === "veiculo" ? "Veículo" : "Outro"].filter(Boolean).join(" · ")}
            {f.meses_restantes !== null && ` · ${f.meses_restantes} meses restantes`}
          </p>
        </div>
        <button onClick={onDelete} className="text-muted-foreground hover:text-red-500 shrink-0 mt-0.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Equity bar */}
      <EquityBar pago={pagoPct} label={`Saldo devedor: ${brl(f.saldo_devedor)} de ${brl(f.valor_total)}`} />

      {/* Detalhamento financeiro */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5 text-xs pt-1">
        <div>
          <p className="text-muted-foreground">Parcela mensal</p>
          <p className="font-semibold font-mono mt-0.5">{brl(f.parcela_mensal)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Taxa mensal / anual</p>
          <p className="font-semibold font-mono mt-0.5">{pct(f.taxa_mensal * 100, 3)} / {pct(taxaAnual, 2)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Equity acumulado</p>
          <p className="font-semibold font-mono text-emerald-600 mt-0.5">{brl(f.valor_total - f.saldo_devedor)}</p>
        </div>
        {totalRestante !== null && (
          <div>
            <p className="text-muted-foreground">Total a pagar (est.)</p>
            <p className="font-semibold font-mono mt-0.5">{brl(totalRestante)}</p>
          </div>
        )}
        {jurosRestantes !== null && jurosRestantes > 0 && (
          <div>
            <p className="text-muted-foreground">Juros restantes (est.)</p>
            <p className="font-semibold font-mono text-red-500 mt-0.5">{brl(jurosRestantes)}</p>
          </div>
        )}
        {f.vencimento_estimado && (
          <div>
            <p className="text-muted-foreground">Vencimento estimado</p>
            <p className="font-semibold mt-0.5">
              {new Date(f.vencimento_estimado + "T00:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
            </p>
          </div>
        )}
      </div>

      {/* Mapa (apenas para imóvel) */}
      {f.tipo === "imovel" && (
        <div className="space-y-3 pt-1">
          <button
            onClick={() => setShowMap((s) => !s)}
            disabled={geoLoading}
            className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {geoLoading
              ? "Buscando localização…"
              : showMap
              ? "Ocultar mapa"
              : "Ver localização no mapa"}
          </button>

          {geoError && (
            <div className="space-y-2">
              <p className="text-xs text-red-500">{geoError}</p>
              {showCustomInput && (
                <div className="flex gap-2">
                  <input
                    value={customQuery}
                    onChange={(e) => setCustomQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && customQuery.trim() && runGeocode(customQuery)}
                    placeholder="Ex: Rua José Martins Coelho, São Paulo"
                    className="flex-1 border border-border rounded-lg px-3 py-1.5 text-xs bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    disabled={!customQuery.trim() || geoLoading}
                    onClick={() => runGeocode(customQuery)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                  >
                    Buscar
                  </button>
                </div>
              )}
            </div>
          )}

          {showMap && coords && (
            <div className="space-y-2">
              <PropertyMap coords={coords} address={f.descricao} />

              {/* Rodapé do mapa */}
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                  <span>Localização aproximada via OpenStreetMap</span>
                </div>
                <a
                  href={gmapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Google Maps
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────

export default function PatrimonioTotal() {
  const { data, isLoading, isError, error } = usePatrimonioTotal()
  const { data: ativos = [] } = usePatrimoniosFisicos()
  const { data: financiamentos = [] } = useFinanciamentos()
  const createAtivo = useCreatePatrimonioFisico()
  const deleteAtivo = useDeletePatrimonioFisico()
  const refreshFipe = useRefreshFipe()
  const createFin = useCreateFinanciamento()
  const deleteFin = useDeleteFinanciamento()

  const [addingAtivo, setAddingAtivo] = useState<"none" | "carro" | "imovel">("none")
  const [addingFin, setAddingFin] = useState(false)
  const [imovelForm, setImovelForm] = useState({ descricao: "", valor_manual: 0, valor_aquisicao: 0, data_aquisicao: "" })
  const [finForm, setFinForm] = useState<FinanciamentoCreate>({
    descricao: "", tipo: "imovel", banco: "", valor_total: 0,
    saldo_devedor: 0, taxa_mensal: 0, parcela_mensal: 0,
  })

  // Dados para o gráfico de breakdown
  const chartData = data ? [
    { name: "Carteira B3", valor: data.portfolio_b3, fill: "#6366f1" },
    { name: "Ativos Físicos", valor: data.total_ativos_fisicos, fill: "#10b981" },
    { name: "Dívidas", valor: -data.total_passivos, fill: "#ef4444" },
  ].filter((d) => Math.abs(d.valor) > 0) : []

  const inputCls = "border border-border rounded-lg px-3 py-2 text-sm bg-background w-full"

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Patrimônio Total</h1>
        <p className="text-sm text-muted-foreground">
          Ativos reais vs passivos — visão completa do seu patrimônio líquido
          {data && <span className="ml-2 text-xs">· atualizado {data.gerado_em}</span>}
        </p>
      </div>

      {isError && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-600">
          {(error as Error)?.message}
        </div>
      )}

      {/* KPI Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted/30 rounded-xl animate-pulse" />)}
        </div>
      ) : data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Total Ativos"
            value={brl(data.total_ativos)}
            sub={`B3 + físicos`}
            accent="blue"
          />
          <KpiCard
            label="Total Passivos"
            value={brl(data.total_passivos)}
            sub={data.financiamentos.length > 0 ? `${data.financiamentos.length} financiamento${data.financiamentos.length > 1 ? "s" : ""}` : "sem dívidas"}
            accent={data.total_passivos > 0 ? "red" : "green"}
          />
          <KpiCard
            label="Patrimônio Líquido"
            value={brl(data.patrimonio_liquido)}
            accent={data.patrimonio_liquido >= 0 ? "green" : "red"}
          />
          <KpiCard
            label="Parcelas / Renda"
            value={data.comprometimento_financiamento_pct !== null ? pct(data.comprometimento_financiamento_pct) : "—"}
            sub={data.renda_media_3m > 0 ? `Renda média ${brl(data.renda_media_3m)}/mês` : "sem renda registrada"}
            accent={
              data.comprometimento_financiamento_pct === null ? "blue"
              : data.comprometimento_financiamento_pct > 30 ? "red"
              : "green"
            }
          />
        </div>
      ) : null}

      {/* Breakdown visual */}
      {data && chartData.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Composição Patrimonial</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 16, right: 32 }}>
              <XAxis type="number" tickFormatter={(v) => `R$${(Math.abs(v) / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
              <Tooltip formatter={(v: number) => [brl(Math.abs(v)), ""]} />
              <ReferenceLine x={0} stroke="hsl(var(--border))" />
              <Bar dataKey="valor" radius={4}>
                {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 pt-3 border-t border-border flex justify-between text-sm">
            <span className="text-muted-foreground">Patrimônio Líquido</span>
            <span className={`font-bold tabular-nums ${data.patrimonio_liquido >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {brl(data.patrimonio_liquido)}
            </span>
          </div>
        </div>
      )}

      {/* Ativos Físicos */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Ativos Físicos</h2>
          <div className="flex gap-2">
            <button onClick={() => setAddingAtivo(addingAtivo === "carro" ? "none" : "carro")}
              className="text-xs text-primary hover:underline">+ Carro (FIPE)</button>
            <button onClick={() => setAddingAtivo(addingAtivo === "imovel" ? "none" : "imovel")}
              className="text-xs text-primary hover:underline">+ Imóvel</button>
          </div>
        </div>

        {addingAtivo === "carro" && (
          <div className="bg-muted/30 p-4 rounded-lg">
            <p className="text-sm font-medium mb-3">Cadastrar via tabela FIPE</p>
            <FipeWizard onConfirm={(d) => createAtivo.mutate(d, { onSuccess: () => setAddingAtivo("none") })} />
          </div>
        )}

        {addingAtivo === "imovel" && (
          <div className="bg-muted/30 p-3 rounded-lg space-y-2">
            <p className="text-sm font-medium">Cadastrar imóvel</p>
            <input className={inputCls} placeholder="Descrição" value={imovelForm.descricao} onChange={(e) => setImovelForm({ ...imovelForm, descricao: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" min="0" step="1000" className={inputCls} placeholder="Valor atual R$"
                value={imovelForm.valor_manual || ""} onChange={(e) => setImovelForm({ ...imovelForm, valor_manual: parseFloat(e.target.value) || 0 })} />
              <input type="number" min="0" step="1000" className={inputCls} placeholder="Valor de aquisição R$ (opcional)"
                value={imovelForm.valor_aquisicao || ""} onChange={(e) => setImovelForm({ ...imovelForm, valor_aquisicao: parseFloat(e.target.value) || 0 })} />
            </div>
            <input type="date" className={inputCls} onChange={(e) => setImovelForm({ ...imovelForm, data_aquisicao: e.target.value })} />
            <button
              disabled={!imovelForm.descricao || imovelForm.valor_manual <= 0 || createAtivo.isPending}
              onClick={() => createAtivo.mutate({
                tipo: "imovel", descricao: imovelForm.descricao, valor_manual: imovelForm.valor_manual,
                valor_aquisicao: imovelForm.valor_aquisicao || undefined,
                data_aquisicao: imovelForm.data_aquisicao || undefined,
              }, { onSuccess: () => { setAddingAtivo("none"); setImovelForm({ descricao: "", valor_manual: 0, valor_aquisicao: 0, data_aquisicao: "" }) } })}
              className="w-full bg-primary text-primary-foreground rounded-lg py-2 text-sm font-medium disabled:opacity-50"
            >Salvar Imóvel</button>
          </div>
        )}

        <div className="space-y-3">
          {ativos.map((item) => (
            <div key={item.id} className="border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium">{item.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.tipo === "carro" ? `${item.marca ?? ""} ${item.modelo ?? ""} ${item.ano_modelo ?? ""}`.trim() : "Imóvel"}
                    {item.fipe_updated_at && ` · FIPE ${new Date(item.fipe_updated_at).toLocaleDateString("pt-BR")}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {item.tipo === "carro" && item.fipe_params && (
                    <button onClick={() => refreshFipe.mutate(item.id)} disabled={refreshFipe.isPending}
                      className="text-xs text-primary hover:underline disabled:opacity-50">↺ FIPE</button>
                  )}
                  <span className="text-sm font-bold tabular-nums text-emerald-600">{brl(item.valor_efetivo)}</span>
                  <button onClick={() => deleteAtivo.mutate(item.id)} className="text-muted-foreground hover:text-red-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Depreciação */}
              {item.valor_aquisicao && item.valor_efetivo > 0 && (
                <div className="text-xs text-muted-foreground flex gap-4">
                  <span>Aquisição: <strong className="text-foreground">{brl(item.valor_aquisicao)}</strong></span>
                  {item.depreciacao_pct !== undefined && item.depreciacao_pct !== null && (
                    <span className={item.depreciacao_pct > 0 ? "text-red-500" : "text-emerald-500"}>
                      {item.depreciacao_pct > 0 ? `↓ ${pct(item.depreciacao_pct)} desvalorizado` : `↑ valorizado`}
                    </span>
                  )}
                </div>
              )}

              {/* Gráfico de histórico FIPE */}
              {item.tipo === "carro" && <DepreciacaoChart assetId={item.id} />}
            </div>
          ))}
          {ativos.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum ativo físico cadastrado.</p>
          )}
        </div>
      </div>

      {/* Financiamentos */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Financiamentos</h2>
          <button onClick={() => setAddingFin((s) => !s)} className="text-xs text-primary hover:underline">
            {addingFin ? "Cancelar" : "+ Adicionar"}
          </button>
        </div>

        {addingFin && (
          <div className="bg-muted/30 p-3 rounded-lg space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder="Descrição" value={finForm.descricao} onChange={(e) => setFinForm({ ...finForm, descricao: e.target.value })} />
              <select className={inputCls} value={finForm.tipo} onChange={(e) => setFinForm({ ...finForm, tipo: e.target.value as "imovel" | "veiculo" | "outro" })}>
                <option value="imovel">Imóvel</option>
                <option value="veiculo">Veículo</option>
                <option value="outro">Outro</option>
              </select>
              <input className={inputCls} placeholder="Banco" value={finForm.banco ?? ""} onChange={(e) => setFinForm({ ...finForm, banco: e.target.value })} />
              <input type="number" min="0" className={inputCls} placeholder="Valor total R$" value={finForm.valor_total || ""} onChange={(e) => setFinForm({ ...finForm, valor_total: parseFloat(e.target.value) || 0 })} />
              <input type="number" min="0" className={inputCls} placeholder="Saldo devedor R$" value={finForm.saldo_devedor || ""} onChange={(e) => setFinForm({ ...finForm, saldo_devedor: parseFloat(e.target.value) || 0 })} />
              <input type="number" min="0" step="0.001" className={inputCls} placeholder="Taxa mensal % (ex: 0.75)"
                value={finForm.taxa_mensal * 100 || ""}
                onChange={(e) => setFinForm({ ...finForm, taxa_mensal: (parseFloat(e.target.value) || 0) / 100 })} />
              <input type="number" min="0" className={inputCls} placeholder="Parcela mensal R$" value={finForm.parcela_mensal || ""} onChange={(e) => setFinForm({ ...finForm, parcela_mensal: parseFloat(e.target.value) || 0 })} />
              <input type="date" className={inputCls} onChange={(e) => setFinForm({ ...finForm, vencimento_estimado: e.target.value })} />
            </div>
            <button
              disabled={!finForm.descricao || finForm.valor_total <= 0 || finForm.parcela_mensal <= 0 || createFin.isPending}
              onClick={() => createFin.mutate(finForm, { onSuccess: () => setAddingFin(false) })}
              className="w-full bg-primary text-primary-foreground rounded-lg py-2 text-sm font-medium disabled:opacity-50"
            >Salvar Financiamento</button>
          </div>
        )}

        <div className="space-y-3">
          {financiamentos.filter((f) => f.ativo).map((f) => (
            <FinanciamentoCard key={f.id} f={f} onDelete={() => deleteFin.mutate(f.id)} />
          ))}
          {financiamentos.filter((f) => f.ativo).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum financiamento ativo.</p>
          )}
        </div>
      </div>
    </div>
  )
}
