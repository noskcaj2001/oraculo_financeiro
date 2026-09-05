import { useCallback, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import {
  usePortfolioSnapshots,
  usePortfolioSummary,
  useUploadPortfolio,
  useDeleteSnapshot,
} from "@/api/portfolio"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { PortfolioPosition, PortfolioDividend } from "@/types"

// ── Constantes ──────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  acoes: "Ações",
  etf: "ETF",
  fii: "FII",
  tesouro: "Tesouro Direto",
}

const TIPO_COLORS: Record<string, string> = {
  acoes: "#3b82f6",
  etf: "#a855f7",
  fii: "#22c55e",
  tesouro: "#f97316",
}

const TIPO_BADGE: Record<string, string> = {
  acoes: "bg-blue-100 text-blue-800",
  etf: "bg-purple-100 text-purple-800",
  fii: "bg-green-100 text-green-800",
  tesouro: "bg-orange-100 text-orange-800",
}

const EVENTO_BADGE: Record<string, string> = {
  "Rendimento": "bg-green-100 text-green-800",
  "Juros Sobre Capital Próprio": "bg-blue-100 text-blue-800",
}

// ── Utils ───────────────────────────────────────────────────────────────────

function formatBRL(v: number | null | undefined) {
  if (v == null) return "—"
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—"
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

function formatNum(v: number | null | undefined, decimals = 2) {
  if (v == null) return "—"
  return v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

// ── KPICards ────────────────────────────────────────────────────────────────

function KPICards({
  totalPortfolio, totalAcoes, totalEtf, totalFii, totalTesouro, totalProventos,
}: {
  totalPortfolio: number; totalAcoes: number; totalEtf: number
  totalFii: number; totalTesouro: number; totalProventos: number
}) {
  const cards = [
    { label: "Total patrimônio", value: totalPortfolio, highlight: true, borderClass: "border-t-2 border-t-primary" },
    { label: "Ações", value: totalAcoes, color: TIPO_COLORS.acoes, borderClass: "border-t-2 border-t-blue-500" },
    { label: "ETF", value: totalEtf, color: TIPO_COLORS.etf, borderClass: "border-t-2 border-t-purple-500" },
    { label: "FII", value: totalFii, color: TIPO_COLORS.fii, borderClass: "border-t-2 border-t-green-500" },
    { label: "Tesouro Direto", value: totalTesouro, color: TIPO_COLORS.tesouro, borderClass: "border-t-2 border-t-orange-500" },
  ]
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.label} className={`p-4 ${c.borderClass}`}>
          <p className="text-xs text-muted-foreground">{c.label}</p>
          <p
            className="text-xl font-bold mt-1 tabular-nums"
            style={c.color ? { color: c.color } : undefined}
          >
            {formatBRL(c.value)}
          </p>
          {c.highlight && totalPortfolio > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Proventos: {formatBRL(totalProventos)}
            </p>
          )}
        </Card>
      ))}
    </div>
  )
}

// ── Alocação (pizza) ─────────────────────────────────────────────────────────

function AlocacaoChart({
  totalAcoes, totalEtf, totalFii, totalTesouro,
}: {
  totalAcoes: number; totalEtf: number; totalFii: number; totalTesouro: number
}) {
  const total = totalAcoes + totalEtf + totalFii + totalTesouro
  const data = [
    { name: "Ações", value: totalAcoes, tipo: "acoes" },
    { name: "ETF", value: totalEtf, tipo: "etf" },
    { name: "FII", value: totalFii, tipo: "fii" },
    { name: "Tesouro", value: totalTesouro, tipo: "tesouro" },
  ].filter((d) => d.value > 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Alocação</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          <ResponsiveContainer width={160} height={160}>
            <PieChart>
              <Pie data={data} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                {data.map((entry) => (
                  <Cell key={entry.tipo} fill={TIPO_COLORS[entry.tipo]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => [formatBRL(Number(v)), ""]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-col gap-2">
            {data.map((d) => (
              <div key={d.tipo} className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: TIPO_COLORS[d.tipo] }} />
                <span className="text-muted-foreground min-w-20">{d.name}</span>
                <span className="font-mono font-medium">{total > 0 ? `${((d.value / total) * 100).toFixed(1)}%` : "—"}</span>
                <span className="text-muted-foreground text-xs">{formatBRL(d.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Tabela de posições ───────────────────────────────────────────────────────

type TabType = "acoes_etf_fii" | "tesouro"

function TabelaPosicoes({ posicoes }: { posicoes: PortfolioPosition[] }) {
  const [tab, setTab] = useState<TabType>("acoes_etf_fii")

  const variavel = posicoes.filter((p) => p.tipo_ativo !== "tesouro")
  const tesouro = posicoes.filter((p) => p.tipo_ativo === "tesouro")

  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">Posições</CardTitle>
          <div className="flex rounded-md border border-input overflow-hidden text-sm">
            <button
              onClick={() => setTab("acoes_etf_fii")}
              className={`px-3 py-1.5 transition-colors ${tab === "acoes_etf_fii" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              Ações / ETF / FII
            </button>
            <button
              onClick={() => setTab("tesouro")}
              className={`px-3 py-1.5 border-l border-input transition-colors ${tab === "tesouro" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              Tesouro Direto
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 mt-2">
        {tab === "acoes_etf_fii" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variavel.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-8">Nenhuma posição</TableCell>
                </TableRow>
              ) : (
                variavel.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-bold">{p.ticker}</TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-48 truncate">{p.nome}</TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIPO_BADGE[p.tipo_ativo] ?? "bg-muted"}`}>
                        {TIPO_LABELS[p.tipo_ativo] ?? p.tipo_ativo}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatNum(p.quantidade, 0)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatBRL(p.preco_fechamento)}</TableCell>
                    <TableCell className="text-right font-mono font-medium">{formatBRL(p.valor_atualizado)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Vencimento</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Valor atual</TableHead>
                <TableHead className="text-right">Rentab.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tesouro.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-8">Nenhum título</TableCell>
                </TableRow>
              ) : (
                tesouro.map((p) => {
                  const rentab = p.valor_aplicado && p.valor_atualizado && p.valor_aplicado > 0
                    ? ((p.valor_atualizado - p.valor_aplicado) / p.valor_aplicado) * 100
                    : null
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.nome || p.ticker}</TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">{formatDate(p.vencimento)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatNum(p.quantidade, 4)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatBRL(p.valor_aplicado)}</TableCell>
                      <TableCell className="text-right font-mono font-medium">{formatBRL(p.valor_atualizado)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm font-medium ${rentab != null && rentab >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {rentab != null ? `${rentab >= 0 ? "+" : ""}${rentab.toFixed(2)}%` : "—"}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ── Tabela de proventos ──────────────────────────────────────────────────────

function TabelaProventos({ proventos }: { proventos: PortfolioDividend[] }) {
  const total = proventos.reduce((s, d) => s + (d.valor_liquido ?? 0), 0)
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Proventos recebidos</CardTitle>
          {total > 0 && (
            <span className="text-sm font-mono font-bold text-green-600">{formatBRL(total)}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticker</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Pagamento</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">Preço unit.</TableHead>
              <TableHead className="text-right">Valor líquido</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proventos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-8">Nenhum provento neste mês</TableCell>
              </TableRow>
            ) : (
              proventos.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono font-bold">{d.ticker}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${EVENTO_BADGE[d.tipo_evento] ?? "bg-muted text-muted-foreground"}`}>
                      {d.tipo_evento === "Juros Sobre Capital Próprio" ? "JCP" : d.tipo_evento}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm">{formatDate(d.pagamento)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatNum(d.quantidade, 0)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{d.preco_unit != null ? `R$ ${d.preco_unit.toFixed(2)}` : "—"}</TableCell>
                  <TableCell className="text-right font-mono font-medium text-green-600">{formatBRL(d.valor_liquido)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ── UploadZone ───────────────────────────────────────────────────────────────

function UploadZone() {
  const upload = useUploadPortfolio()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) return
    upload.mutate(file)
  }, [upload])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  return (
    <Card
      className={`border-2 border-dashed transition-colors cursor-pointer ${
        dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"
      } ${upload.isPending ? "opacity-70 pointer-events-none" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <CardContent className="flex flex-col items-center justify-center py-8 gap-3">
        {upload.isPending ? (
          <>
            <svg className="w-8 h-8 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v8z" />
            </svg>
            <p className="text-sm text-muted-foreground">Extraindo dados com IA…</p>
          </>
        ) : (
          <>
            <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            <div className="text-center">
              <p className="text-sm font-medium">Upload do Relatório mensal consolidado B3</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Relatório mensal consolidado da B3 · investidor.b3.com.br
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Extratos e Informativos → Consolidado mensal
              </p>
            </div>
          </>
        )}
        {upload.isError && (
          <p className="text-xs text-destructive text-center">{(upload.error as Error).message}</p>
        )}
        {upload.isSuccess && (
          <p className="text-xs text-green-600">Upload concluído!</p>
        )}
      </CardContent>
      <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
    </Card>
  )
}

// ── SnapshotList ─────────────────────────────────────────────────────────────

function SnapshotList({
  selectedMes,
  onSelect,
}: {
  selectedMes: string | undefined
  onSelect: (mes: string) => void
}) {
  const { data: snapshots } = usePortfolioSnapshots()
  const del = useDeleteSnapshot()

  if (!snapshots?.length) return null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Relatórios carregados</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mês</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Upload</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshots.map((s) => {
              const [y, m] = s.mes.split("-")
              const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
              const label = `${monthNames[parseInt(m) - 1]}/${y}`
              return (
                <TableRow
                  key={s.id}
                  className={`cursor-pointer transition-colors ${selectedMes === s.mes ? "bg-muted/60" : "hover:bg-muted/30"}`}
                  onClick={() => onSelect(s.mes)}
                >
                  <TableCell className="font-medium">{label}</TableCell>
                  <TableCell className="text-right font-mono font-medium">{formatBRL(s.total_portfolio)}</TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs">{formatDate(s.uploaded_at?.split("T")[0])}</TableCell>
                  <TableCell>
                    <button
                      onClick={(e) => { e.stopPropagation(); del.mutate(s.id) }}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Excluir"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ── Patrimônio (main) ────────────────────────────────────────────────────────

export default function Patrimonio() {
  const [selectedMes, setSelectedMes] = useState<string | undefined>(undefined)
  const { data: summary, isLoading } = usePortfolioSummary(selectedMes)

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Patrimônio</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Carteira de investimentos — relatório mensal B3
          </p>
        </div>
        {summary && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Posição referente a</p>
            <p className="text-sm font-semibold">{(() => {
              const [y, m] = summary.mes.split("-")
              const names = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
              return `${names[parseInt(m)-1]}/${y}`
            })()}</p>
          </div>
        )}
      </div>

      {/* Upload */}
      <UploadZone />

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-6 justify-center animate-pulse">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v8z" />
          </svg>
          Carregando…
        </div>
      )}

      {/* Sem dados */}
      {!isLoading && !summary && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
            </svg>
          </div>
          <p className="text-lg font-medium">Nenhum relatório carregado</p>
          <p className="text-sm text-muted-foreground mt-1 mb-5 max-w-sm">
            Faça upload do PDF "Relatório mensal consolidado" disponível em investidor.b3.com.br para visualizar sua carteira.
          </p>
          <Link
            to="/visao-geral"
            className="text-sm text-primary hover:underline"
          >
            Ver Visão Geral →
          </Link>
        </div>
      )}

      {/* Dados disponíveis */}
      {summary && (
        <>
          <KPICards
            totalPortfolio={summary.total_portfolio}
            totalAcoes={summary.total_acoes}
            totalEtf={summary.total_etf}
            totalFii={summary.total_fii}
            totalTesouro={summary.total_tesouro}
            totalProventos={summary.total_proventos}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AlocacaoChart
              totalAcoes={summary.total_acoes}
              totalEtf={summary.total_etf}
              totalFii={summary.total_fii}
              totalTesouro={summary.total_tesouro}
            />
            <SnapshotList selectedMes={selectedMes} onSelect={setSelectedMes} />
          </div>

          <TabelaPosicoes posicoes={summary.posicoes} />
          <TabelaProventos proventos={summary.proventos} />
        </>
      )}

      {/* Lista de snapshots quando sem dados mas existem snapshots */}
      {!summary && !isLoading && (
        <SnapshotList selectedMes={selectedMes} onSelect={setSelectedMes} />
      )}
    </div>
  )
}
