import { type ReactNode, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useDashboardSummary } from "@/api/dashboard"
import {
  useGastosFixos, useCreateGastoFixo, useUpdateGastoFixo, useDeleteGastoFixo,
  useGastosPontuais, useCreateGastoPontual, useDeleteGastoPontual,
  type GastoFixoCreate, type GastoPontualCreate,
} from "@/api/analiseIntegrada"
import { useCategorias, usePatchTransactionCategoria } from "@/api/transactions"
import { catLabel, catColor, catBadge } from "@/lib/categories"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { CategorySummary, TransactionItem } from "@/types"

// ── Constantes ──────────────────────────────────────────────────────────────
// Labels e cores das categorias vêm de @/lib/categories.

// ── Utils ───────────────────────────────────────────────────────────────────

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function formatDate(iso: string) {
  if (!iso) return "—"
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

function prevMonth(mes: string) {
  const [y, m] = mes.split("-").map(Number)
  const pm = m === 1 ? 12 : m - 1
  const py = m === 1 ? y - 1 : y
  return `${py}-${String(pm).padStart(2, "0")}`
}

function nextMonth(mes: string) {
  const [y, m] = mes.split("-").map(Number)
  const nm = m === 12 ? 1 : m + 1
  const ny = m === 12 ? y + 1 : y
  return `${ny}-${String(nm).padStart(2, "0")}`
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

// ── MonthNav ────────────────────────────────────────────────────────────────

function MonthNav({ mes, onChange }: { mes: string; onChange: (m: string) => void }) {
  const [y, m] = mes.split("-")
  const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
  const label = `${monthNames[parseInt(m) - 1]} ${y}`
  const isCurrentMonth = mes === currentMonth()
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(prevMonth(mes))}
        className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="font-semibold text-sm min-w-24 text-center px-1">{label}</span>
      <button
        onClick={() => onChange(nextMonth(mes))}
        disabled={isCurrentMonth}
        className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {!isCurrentMonth && (
        <button
          onClick={() => onChange(currentMonth())}
          className="ml-1 text-xs text-primary hover:underline font-medium"
        >
          Hoje
        </button>
      )}
    </div>
  )
}

// ── KPICards ────────────────────────────────────────────────────────────────

function KPICards({
  totalGasto,
  totalEstornos,
  totalLiquido,
  totalFixos,
  totalPontuais,
  totalSaidas,
  totalTransacoes,
}: {
  totalGasto: number
  totalEstornos: number
  totalLiquido: number
  totalFixos: number
  totalPontuais: number
  totalSaidas: number
  totalTransacoes: number
}) {
  const ticketMedio = totalTransacoes > 0 ? totalLiquido / totalTransacoes : 0
  const temExtras = totalFixos > 0 || totalPontuais > 0

  return (
    <div className="space-y-3">
      {/* Card principal — total saídas */}
      <Card className="p-4 border-l-4 border-l-red-500">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground">Total de saídas no mês</p>
            <p className="text-3xl font-bold tabular-nums mt-0.5">{formatBRL(totalSaidas)}</p>
          </div>
          {temExtras && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground pt-1">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                Cartão <span className="tabular-nums font-medium text-foreground">{formatBRL(totalLiquido)}</span>
              </span>
              {totalFixos > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-orange-400" />
                  Fixos <span className="tabular-nums font-medium text-foreground">{formatBRL(totalFixos)}</span>
                </span>
              )}
              {totalPontuais > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-yellow-400" />
                  Extras <span className="tabular-nums font-medium text-foreground">{formatBRL(totalPontuais)}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Cards secundários */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Fatura bruta</p>
          <p className="text-xl font-bold mt-1 tabular-nums">{formatBRL(totalGasto)}</p>
        </Card>

        <Card className={`p-4 ${totalEstornos < 0 ? "border-green-200 bg-green-50 dark:bg-green-950/20" : ""}`}>
          <p className="text-xs text-muted-foreground">Estornos</p>
          <p className={`text-xl font-bold mt-1 tabular-nums ${totalEstornos < 0 ? "text-green-600" : "text-muted-foreground"}`}>
            {totalEstornos < 0 ? formatBRL(totalEstornos) : "—"}
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Transações</p>
          <p className="text-xl font-bold mt-1 tabular-nums">{totalTransacoes}</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Ticket médio</p>
          <p className="text-xl font-bold mt-1 tabular-nums">{formatBRL(ticketMedio)}</p>
        </Card>
      </div>
    </div>
  )
}

// ── CategorySection ─────────────────────────────────────────────────────────

function CategorySection({
  categorias,
  totalGasto,
  selectedCategory,
  onSelectCategory,
}: {
  categorias: CategorySummary[]
  totalGasto: number
  selectedCategory: string | null
  onSelectCategory: (cat: string | null) => void
}) {
  const barData = categorias.map((c) => ({
    name: catLabel(c.categoria),
    value: c.total,
    categoria: c.categoria,
  }))

  const chartHeight = Math.max(240, categorias.length * 38)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Gráfico de barras horizontal */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Por categoria</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart
              data={barData}
              layout="vertical"
              margin={{ left: 4, right: 20, top: 4, bottom: 4 }}
              onClick={(payload: unknown) => {
                const p = payload as { activePayload?: Array<{ payload: { categoria: string } }> } | null
                if (p?.activePayload?.[0]) {
                  const cat = p.activePayload[0].payload.categoria
                  onSelectCategory(selectedCategory === cat ? null : cat)
                }
              }}
            >
              <XAxis
                type="number"
                tickFormatter={(v: number) =>
                  v >= 1000 ? `R$${(v / 1000).toFixed(1)}k` : `R$${v.toFixed(0)}`
                }
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={105}
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(v) => [formatBRL(Number(v)), "Total"]}
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.6 }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22} style={{ cursor: "pointer" }}>
                {barData.map((entry) => (
                  <Cell
                    key={entry.categoria}
                    fill={catColor(entry.categoria)}
                    opacity={selectedCategory && selectedCategory !== entry.categoria ? 0.3 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {selectedCategory && (
            <p className="text-xs text-center text-muted-foreground mt-1">
              Clique na barra novamente para remover filtro
            </p>
          )}
        </CardContent>
      </Card>

      {/* Tabela de categorias com progress bars */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalhamento</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">% do total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categorias.map((c) => {
                const pct = totalGasto > 0 ? (c.total / totalGasto) * 100 : 0
                const isSelected = selectedCategory === c.categoria
                return (
                  <TableRow
                    key={c.categoria}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? "bg-muted/60" : "hover:bg-muted/30"
                    }`}
                    onClick={() => onSelectCategory(isSelected ? null : c.categoria)}
                  >
                    <TableCell>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium transition-shadow ${
                          catBadge(c.categoria)
                        } ${isSelected ? "ring-2 ring-offset-1 ring-current" : ""}`}
                      >
                        {catLabel(c.categoria)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono font-medium text-sm">{formatBRL(c.total)}</span>
                      <div className="h-1 mt-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: catColor(c.categoria),
                          }}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">
                      {pct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ── TransactionsTable ───────────────────────────────────────────────────────

type SortField = "data" | "valor"
type SortDir = "asc" | "desc"

/** Badge de categoria com <select> nativo sobreposto para correção rápida. */
function CategoriaCell({ t }: { t: TransactionItem }) {
  const { data: categorias } = useCategorias()
  const patch = usePatchTransactionCategoria()
  const opts = categorias ?? []

  return (
    <span className="relative inline-flex items-center gap-1">
      <Badge
        variant="secondary"
        className={`text-xs ${catBadge(t.categoria)} ${patch.isPending ? "opacity-50" : ""}`}
      >
        {catLabel(t.categoria)}
      </Badge>
      <svg className="w-3 h-3 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m19 9-7 7-7-7" />
      </svg>
      <select
        aria-label="Alterar categoria"
        title="Alterar categoria"
        value={t.categoria}
        disabled={patch.isPending}
        onChange={(e) => {
          if (e.target.value !== t.categoria) {
            patch.mutate({ id: t.id, categoria: e.target.value })
          }
        }}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
      >
        {opts.every((o) => o.slug !== t.categoria) && (
          <option value={t.categoria}>{catLabel(t.categoria)}</option>
        )}
        {opts.map((o) => (
          <option key={o.slug} value={o.slug}>{o.label}</option>
        ))}
      </select>
    </span>
  )
}

function TransactionsTable({
  transacoes,
  selectedCategory,
  onSelectCategory,
}: {
  transacoes: TransactionItem[]
  selectedCategory: string | null
  onSelectCategory: (cat: string | null) => void
}) {
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  // categorias presentes no mês, com contagem, ordenadas por nome
  const categoriasPresentes = useMemo(() => {
    const count = new Map<string, number>()
    for (const t of transacoes) count.set(t.categoria, (count.get(t.categoria) ?? 0) + 1)
    return [...count.entries()]
      .map(([cat, n]) => ({ cat, n }))
      .sort((a, b) => catLabel(a.cat).localeCompare(catLabel(b.cat)))
  }, [transacoes])

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("desc")
    }
  }

  const filtered = useMemo(() => {
    setPage(1)
    let result = transacoes
    if (selectedCategory) {
      result = result.filter((t) => t.categoria === selectedCategory)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((t) =>
        (t.estabelecimento || t.descricao).toLowerCase().includes(q),
      )
    }
    if (sortField) {
      result = [...result].sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1
        if (sortField === "data") return a.data.localeCompare(b.data) * dir
        if (sortField === "valor") return (a.valor - b.valor) * dir
        return 0
      })
    }
    return result
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transacoes, selectedCategory, search, sortField, sortDir])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function SortIndicator({ field }: { field: SortField }) {
    if (sortField !== field)
      return <span className="ml-1 text-muted-foreground/40 text-[10px]">↕</span>
    return <span className="ml-1 text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>
  }

  const hasActiveFilters = selectedCategory || search.trim()

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base">Transações do mês</CardTitle>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-xs text-muted-foreground">
                {filtered.length === transacoes.length
                  ? `${transacoes.length} transações`
                  : `${filtered.length} de ${transacoes.length} transações`}
              </p>
              {selectedCategory && (
                <button
                  onClick={() => onSelectCategory(null)}
                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-muted hover:bg-muted/80 transition-colors"
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: catColor(selectedCategory) }}
                  />
                  {catLabel(selectedCategory)}
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Filtro de categoria */}
            <select
              value={selectedCategory ?? ""}
              onChange={(e) => onSelectCategory(e.target.value || null)}
              className="py-1.5 pl-2.5 pr-7 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Filtrar por categoria"
            >
              <option value="">Todas as categorias</option>
              {categoriasPresentes.map(({ cat, n }) => (
                <option key={cat} value={cat}>
                  {catLabel(cat)} ({n})
                </option>
              ))}
            </select>

            {/* Busca */}
            <div className="relative">
              <svg className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar estabelecimento…"
                className="pl-8 pr-7 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring w-52"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer select-none hover:text-foreground transition-colors"
                onClick={() => handleSort("data")}
              >
                Data <SortIndicator field="data" />
              </TableHead>
              <TableHead>Estabelecimento</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Parcela</TableHead>
              <TableHead
                className="text-right cursor-pointer select-none hover:text-foreground transition-colors"
                onClick={() => handleSort("valor")}
              >
                Valor <SortIndicator field="valor" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-10">
                  {hasActiveFilters
                    ? "Nenhuma transação com este filtro"
                    : "Nenhuma transação encontrada"}
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((t) => (
                <TableRow
                  key={t.id}
                  className={t.estorno ? "bg-green-50/50 dark:bg-green-950/10" : ""}
                >
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(t.data)}
                  </TableCell>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      {t.estabelecimento || t.descricao}
                      {t.estorno && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">
                          estorno
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <CategoriaCell t={t} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {t.total_parcelas > 1 ? `${t.parcela_atual}/${t.total_parcelas}` : "—"}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono font-medium ${
                      t.estorno ? "text-green-600" : ""
                    }`}
                  >
                    {formatBRL(t.valor)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
            <span className="text-muted-foreground text-xs">
              {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const pg = totalPages <= 5 ? i + 1 : page <= 3 ? i + 1 : page >= totalPages - 2 ? totalPages - 4 + i : page - 2 + i
                return (
                  <button
                    key={pg}
                    onClick={() => setPage(pg)}
                    className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                      pg === page
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {pg}
                  </button>
                )
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Accordion Panel ────────────────────────────────────────────────────────

function Panel({ title, badge, children }: { title: string; badge?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <span className="font-medium text-sm flex items-center gap-2">
          {title}
          {badge !== undefined && (
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{badge}</span>
          )}
        </span>
        <svg className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  )
}

// ── Categorias ──────────────────────────────────────────────────────────────

const CAT: Record<string, { label: string; dot: string; chip: string }> = {
  moradia:    { label: "Moradia",    dot: "bg-green-500",  chip: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  condominio: { label: "Condomínio", dot: "bg-teal-500",   chip: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300" },
  iptu:       { label: "IPTU",       dot: "bg-slate-500",  chip: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  saude:      { label: "Saúde",      dot: "bg-red-500",    chip: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  academia:   { label: "Academia",   dot: "bg-orange-500", chip: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" },
  streaming:  { label: "Streaming",  dot: "bg-purple-500", chip: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300" },
  transporte: { label: "Transporte", dot: "bg-blue-500",   chip: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  educacao:   { label: "Educação",   dot: "bg-yellow-500", chip: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300" },
  seguro:     { label: "Seguro",     dot: "bg-indigo-500", chip: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300" },
  outros:     { label: "Outros",     dot: "bg-gray-400",   chip: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
}

function CatChip({ cat }: { cat: string }) {
  const c = CAT[cat] ?? CAT.outros
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${c.chip}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  )
}

function CatPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(CAT).map(([key, { label, chip, dot }]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-all ${
            value === key
              ? `${chip} border-current ring-2 ring-current/30`
              : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:bg-muted"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${value === key ? dot : "bg-muted-foreground/40"}`} />
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Toggle Switch ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        checked ? "bg-primary" : "bg-muted"
      }`}
    >
      <span className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
        checked ? "translate-x-4" : "translate-x-0"
      }`} />
    </button>
  )
}

// ── Painel Gastos Fixos ─────────────────────────────────────────────────────

const EMPTY_FIXO: GastoFixoCreate = { descricao: "", categoria: "moradia", valor: 0 }

function PainelGastosFixos({ onMutate }: { onMutate: () => void }) {
  const { data: items = [] } = useGastosFixos()
  const create = useCreateGastoFixo()
  const update = useUpdateGastoFixo()
  const remove = useDeleteGastoFixo()
  const [form, setForm] = useState<GastoFixoCreate>(EMPTY_FIXO)
  const [showing, setShowing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const ativos = items.filter((i) => i.ativo)
  const inativos = items.filter((i) => !i.ativo)
  const total = ativos.reduce((s, i) => s + i.valor, 0)

  function handleSave() {
    create.mutate(form, {
      onSuccess: () => { setShowing(false); setForm(EMPTY_FIXO); onMutate() },
    })
  }

  function handleDelete(id: string) {
    if (deletingId === id) {
      remove.mutate(id, { onSuccess: onMutate })
      setDeletingId(null)
    } else {
      setDeletingId(id)
    }
  }

  return (
    <div className="space-y-4">
      {/* Cabeçalho com resumo */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Comprometimento mensal</p>
            <p className="text-lg font-bold tabular-nums">{formatBRL(total)}<span className="text-sm font-normal text-muted-foreground">/mês</span></p>
          </div>
          {inativos.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {inativos.length} inativo{inativos.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <button
          onClick={() => { setShowing((s) => !s); setDeletingId(null) }}
          className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
            showing
              ? "text-muted-foreground hover:bg-muted"
              : "bg-primary/10 text-primary hover:bg-primary/20"
          }`}
        >
          {showing ? (
            <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" /></svg>Cancelar</>
          ) : (
            <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" /></svg>Novo</>
          )}
        </button>
      </div>

      {/* Formulário de adição */}
      {showing && (
        <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Descrição</label>
              <input
                autoFocus
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Ex: Netflix, Gympass, Aluguel…"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && form.descricao && form.valor > 0 && handleSave()}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Valor mensal</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">R$</span>
                <input
                  type="number" min="0" step="0.01"
                  className="w-full border border-border rounded-lg pl-9 pr-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="0,00"
                  value={form.valor || ""}
                  onChange={(e) => setForm({ ...form, valor: parseFloat(e.target.value) || 0 })}
                  onKeyDown={(e) => e.key === "Enter" && form.descricao && form.valor > 0 && handleSave()}
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Categoria</label>
            <CatPicker value={form.categoria ?? "outros"} onChange={(v) => setForm({ ...form, categoria: v })} />
          </div>
          <div className="flex justify-end">
            <button
              disabled={!form.descricao || form.valor <= 0 || create.isPending}
              onClick={handleSave}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
            >
              {create.isPending ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v8z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
              Salvar gasto fixo
            </button>
          </div>
        </div>
      )}

      {/* Lista de itens */}
      {items.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <svg className="w-10 h-10 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <p className="text-sm">Nenhum gasto fixo cadastrado.</p>
          <p className="text-xs mt-1">Clique em "Novo" para adicionar.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {[...ativos, ...inativos].map((item) => (
            <div
              key={item.id}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                item.ativo ? "hover:bg-muted/40" : "opacity-50 hover:opacity-70"
              }`}
            >
              <Toggle checked={item.ativo} onChange={() => update.mutate({ id: item.id, ativo: !item.ativo }, { onSuccess: onMutate })} />
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-medium ${!item.ativo ? "line-through text-muted-foreground" : ""}`}>
                  {item.descricao}
                </span>
              </div>
              <CatChip cat={item.categoria} />
              <span className="text-sm font-semibold tabular-nums w-24 text-right">{formatBRL(item.valor)}</span>
              <button
                onClick={() => handleDelete(item.id)}
                title={deletingId === item.id ? "Clique novamente para confirmar" : "Remover"}
                className={`shrink-0 p-1 rounded transition-colors ${
                  deletingId === item.id
                    ? "text-white bg-red-500 hover:bg-red-600"
                    : "text-muted-foreground/40 hover:text-red-500 opacity-0 group-hover:opacity-100"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Painel Gastos Pontuais ──────────────────────────────────────────────────

const EMPTY_PONTUAL: Omit<GastoPontualCreate, "mes"> = { descricao: "", categoria: "outros", valor: 0 }

function PainelGastosPontuais({ mes, onMutate }: { mes: string; onMutate: () => void }) {
  const { data: items = [] } = useGastosPontuais(mes)
  const create = useCreateGastoPontual()
  const remove = useDeleteGastoPontual()
  const [form, setForm] = useState(EMPTY_PONTUAL)
  const [showing, setShowing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const total = items.reduce((s, i) => s + i.valor, 0)
  const [y, m] = mes.split("-")
  const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
  const mesLabel = `${monthNames[parseInt(m) - 1]}/${y}`

  function handleSave() {
    create.mutate({ mes, ...form }, {
      onSuccess: () => { setShowing(false); setForm(EMPTY_PONTUAL); onMutate() },
    })
  }

  function handleDelete(id: string) {
    if (deletingId === id) { remove.mutate(id, { onSuccess: onMutate }); setDeletingId(null) }
    else setDeletingId(id)
  }

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Extras em {mesLabel}</p>
          <p className="text-lg font-bold tabular-nums">
            {formatBRL(total)}
            {items.length > 0 && <span className="text-sm font-normal text-muted-foreground ml-1">({items.length} {items.length === 1 ? "item" : "itens"})</span>}
          </p>
        </div>
        <button
          onClick={() => { setShowing((s) => !s); setDeletingId(null) }}
          className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
            showing
              ? "text-muted-foreground hover:bg-muted"
              : "bg-primary/10 text-primary hover:bg-primary/20"
          }`}
        >
          {showing ? (
            <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" /></svg>Cancelar</>
          ) : (
            <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" /></svg>Novo</>
          )}
        </button>
      </div>

      {/* Formulário */}
      {showing && (
        <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Descrição</label>
              <input
                autoFocus
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Ex: Dentista, conserto, viagem…"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && form.descricao && form.valor > 0 && handleSave()}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Valor</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">R$</span>
                <input
                  type="number" min="0" step="0.01"
                  className="w-full border border-border rounded-lg pl-9 pr-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="0,00"
                  value={form.valor || ""}
                  onChange={(e) => setForm({ ...form, valor: parseFloat(e.target.value) || 0 })}
                  onKeyDown={(e) => e.key === "Enter" && form.descricao && form.valor > 0 && handleSave()}
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Categoria</label>
            <CatPicker value={form.categoria ?? "outros"} onChange={(v) => setForm({ ...form, categoria: v })} />
          </div>
          <div className="flex justify-end">
            <button
              disabled={!form.descricao || form.valor <= 0 || create.isPending}
              onClick={handleSave}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
            >
              {create.isPending ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v8z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
              Salvar gasto pontual
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      {items.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <svg className="w-10 h-10 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
          </svg>
          <p className="text-sm">Nenhum gasto extra em {mesLabel}.</p>
          <p className="text-xs mt-1">Clique em "Novo" para registrar.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((item) => (
            <div key={item.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/40 transition-colors">
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{item.descricao}</span>
              </div>
              <CatChip cat={item.categoria} />
              <span className="text-sm font-semibold tabular-nums text-red-600 w-24 text-right">
                −{formatBRL(item.valor)}
              </span>
              <button
                onClick={() => handleDelete(item.id)}
                title={deletingId === item.id ? "Clique novamente para confirmar" : "Remover"}
                className={`shrink-0 p-1 rounded transition-colors ${
                  deletingId === item.id
                    ? "text-white bg-red-500 hover:bg-red-600"
                    : "text-muted-foreground/40 hover:text-red-500 opacity-0 group-hover:opacity-100"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── EmptyState ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
      </div>
      <p className="text-lg font-medium">Nenhuma transação neste mês</p>
      <p className="text-sm text-muted-foreground mt-1 mb-5">
        Faça upload de uma fatura para visualizar os gastos aqui.
      </p>
      <Link
        to="/faturas"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
        Upload de fatura
      </Link>
    </div>
  )
}

// ── Dashboard (main) ────────────────────────────────────────────────────────

export default function Dashboard() {
  const [mes, setMes] = useState(currentMonth)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const { data, isLoading, error, refetch: refetchDashboard } = useDashboardSummary(mes)

  function handleMonthChange(m: string) {
    setMes(m)
    setSelectedCategory(null)
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Análise de Gastos</h1>
          <p className="text-muted-foreground text-sm mt-1">Gastos mensais por categoria</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <MonthNav mes={mes} onChange={handleMonthChange} />
          <Link
            to="/faturas"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            Subir fatura
          </Link>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-3 text-muted-foreground text-sm animate-pulse py-8 justify-center">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v8z" />
          </svg>
          Carregando…
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {data && data.total_transacoes === 0 && <EmptyState />}

      {data && data.total_transacoes > 0 && (
        <>
          <KPICards
            totalGasto={data.total_gasto}
            totalEstornos={data.total_estornos}
            totalLiquido={data.total_liquido}
            totalFixos={data.total_fixos}
            totalPontuais={data.total_pontuais}
            totalSaidas={data.total_saidas}
            totalTransacoes={data.total_transacoes}
          />

          <CategorySection
            categorias={data.por_categoria}
            totalGasto={data.total_gasto}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />

          <TransactionsTable
            transacoes={data.transacoes}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />
        </>
      )}

      {/* Gastos fixos e pontuais */}
      <GastosPaineis mes={mes} onMutate={refetchDashboard} />
    </div>
  )
}

function GastosPaineis({ mes, onMutate }: { mes: string; onMutate: () => void }) {
  const { data: fixos = [] } = useGastosFixos()

  const [y, m] = mes.split("-")
  const mn = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
  const mesLabel = `${mn[parseInt(m) - 1]}/${y}`

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Gastos recorrentes e extras</h2>
      <Panel title="Gastos Fixos Mensais" badge={fixos.filter((f) => f.ativo).length}>
        <PainelGastosFixos onMutate={onMutate} />
      </Panel>
      <Panel title={`Gastos Pontuais — ${mesLabel}`}>
        <PainelGastosPontuais mes={mes} onMutate={onMutate} />
      </Panel>
    </div>
  )
}
