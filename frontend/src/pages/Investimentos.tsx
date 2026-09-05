import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import { useChat, useQuotes, useSignals } from "@/api/b3"
import type { ChatResponse, Quote, Signal } from "@/api/b3"
import {
  usePortfolioSnapshots,
  usePortfolioSummary,
  useUploadPortfolio,
  useDeleteSnapshot,
} from "@/api/portfolio"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import type { PortfolioPosition, PortfolioDividend } from "@/types"

// ── Constantes ─────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  acoes: "Ações", etf: "ETF", fii: "FII", tesouro: "Tesouro Direto",
}
const TIPO_COLORS: Record<string, string> = {
  acoes: "#3b82f6", etf: "#a855f7", fii: "#22c55e", tesouro: "#f97316",
}
const TIPO_BADGE: Record<string, string> = {
  acoes: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  etf: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
  fii: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  tesouro: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
}
const EVENTO_BADGE: Record<string, string> = {
  "Rendimento": "bg-green-100 text-green-800",
  "Juros Sobre Capital Próprio": "bg-blue-100 text-blue-800",
}
const SIGNAL_STYLE: Record<string, string> = {
  compra: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  neutro: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300",
  venda: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
}
const SIGNAL_BAR: Record<string, string> = {
  compra: "bg-green-500", neutro: "bg-yellow-500", venda: "bg-red-500",
}
const SIGNAL_LABEL: Record<string, string> = {
  compra: "Compra", neutro: "Neutro", venda: "Venda",
}
const CLASSIFICACAO_STYLE: Record<string, string> = {
  PASS: "bg-green-100 text-green-700",
  BORDERLINE: "bg-yellow-100 text-yellow-700",
  HALLUCINATION: "bg-red-100 text-red-700",
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
function formatVolume(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return String(v)
}

// Remove sufixo .SA ou .F para comparar com tickers do portfólio
function norm(ticker: string) {
  return ticker.replace(/\.(SA|F)$/i, "").toUpperCase()
}

// Template de pergunta contextual baseada no sinal
function buildQuestion(ticker: string, signal: string) {
  if (signal === "compra")
    return `${ticker} tem sinal de compra — quais fundamentos suportam isso e devo aumentar minha posição?`
  if (signal === "venda")
    return `${ticker} tem sinal de venda — por que o modelo recomenda saída? Há risco em continuar segurando?`
  return `${ticker} está com sinal neutro — há catalisadores próximos ou devo realocar esse capital?`
}

// ════════════════════════════════════════════════════════════════
// ABA CARTEIRA — componentes
// ════════════════════════════════════════════════════════════════

const MONTH_NAMES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
function fmtMesLabel(mes: string) {
  const [y, m] = mes.split("-")
  return `${MONTH_NAMES[parseInt(m) - 1]}/${y}`
}

function KPICards({ totalPortfolio, totalAcoes, totalEtf, totalFii, totalTesouro, totalProventos, monthlyReturn, prevMes }: {
  totalPortfolio: number; totalAcoes: number; totalEtf: number
  totalFii: number; totalTesouro: number; totalProventos: number
  monthlyReturn: number | null
  prevMes: string | undefined
}) {
  const cards = [
    { label: "Total patrimônio", value: totalPortfolio, highlight: true, borderClass: "border-t-2 border-t-primary" },
    { label: "Ações",           value: totalAcoes,      color: TIPO_COLORS.acoes,   borderClass: "border-t-2 border-t-blue-500" },
    { label: "ETF",             value: totalEtf,        color: TIPO_COLORS.etf,     borderClass: "border-t-2 border-t-purple-500" },
    { label: "FII",             value: totalFii,        color: TIPO_COLORS.fii,     borderClass: "border-t-2 border-t-green-500" },
    { label: "Tesouro Direto",  value: totalTesouro,    color: TIPO_COLORS.tesouro, borderClass: "border-t-2 border-t-orange-500" },
  ]

  const returnPositive = monthlyReturn != null && monthlyReturn >= 0
  const returnBorderClass = monthlyReturn == null
    ? "border-t-muted-foreground/30"
    : returnPositive ? "border-t-emerald-500" : "border-t-red-500"

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <Card key={c.label} className={`p-4 ${c.borderClass}`}>
          <p className="text-xs text-muted-foreground">{c.label}</p>
          <p className="text-xl font-bold mt-1 tabular-nums" style={c.color ? { color: c.color } : undefined}>
            {formatBRL(c.value)}
          </p>
          {c.highlight && totalPortfolio > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">Proventos: {formatBRL(totalProventos)}</p>
          )}
        </Card>
      ))}

      {/* Rentabilidade mensal */}
      <Card className={`p-4 border-t-2 ${returnBorderClass}`}>
        <p className="text-xs text-muted-foreground">Rentab. mensal</p>
        {monthlyReturn != null ? (
          <>
            <p className={`text-xl font-bold mt-1 tabular-nums ${returnPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
              {returnPositive ? "+" : ""}{monthlyReturn.toFixed(2)}%
            </p>
            {prevMes && (
              <p className="text-xs text-muted-foreground mt-0.5">vs {fmtMesLabel(prevMes)}</p>
            )}
          </>
        ) : (
          <>
            <p className="text-xl font-bold mt-1 text-muted-foreground tabular-nums">—</p>
            <p className="text-xs text-muted-foreground mt-0.5">sem mês anterior</p>
          </>
        )}
      </Card>
    </div>
  )
}

function AlocacaoChart({ totalAcoes, totalEtf, totalFii, totalTesouro }: {
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
      <CardHeader className="pb-2"><CardTitle className="text-base">Alocação</CardTitle></CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          <ResponsiveContainer width={160} height={160}>
            <PieChart>
              <Pie data={data} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                {data.map((entry) => <Cell key={entry.tipo} fill={TIPO_COLORS[entry.tipo]} />)}
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

// ── Painel de drill-down expandido por ticker ──────────────────────────────

function DrilldownPanel({
  posicao, signal, quote, peso, totalPortfolio, onAsk,
}: {
  posicao: PortfolioPosition
  signal: Signal | undefined
  quote: Quote | undefined
  peso: number
  totalPortfolio: number
  onAsk: (ticker: string, signal: Signal | undefined) => void
}) {
  const pnlCusto = posicao.valor_aplicado && posicao.valor_atualizado && posicao.valor_aplicado > 0
    ? ((posicao.valor_atualizado - posicao.valor_aplicado) / posicao.valor_aplicado) * 100
    : null
  const valorVivo = quote && posicao.quantidade ? quote.price * posicao.quantidade : null
  const pnlVivo = valorVivo && posicao.valor_atualizado && posicao.valor_atualizado > 0
    ? ((valorVivo - posicao.valor_atualizado) / posicao.valor_atualizado) * 100
    : null

  return (
    <div className="bg-muted/30 border-t border-border px-4 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Cotação ao vivo */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Cotação ao vivo</p>
        {quote ? (
          <>
            <p className="text-lg font-bold tabular-nums">
              R$ {quote.price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className={`text-sm font-medium ${quote.pct_change >= 0 ? "text-green-600" : "text-red-500"}`}>
              {quote.pct_change >= 0 ? "▲" : "▼"} {Math.abs(quote.pct_change).toFixed(2)}% hoje
            </p>
            <p className="text-xs text-muted-foreground">
              Máx {formatBRL(quote.day_high)} · Mín {formatBRL(quote.day_low)}
            </p>
            <p className="text-xs text-muted-foreground">Vol. {formatVolume(quote.volume)}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Sem cotação</p>
        )}
      </div>

      {/* Sinal ML */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Sinal ML</p>
        {signal ? (
          <>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-sm px-2.5 py-0.5 rounded-full font-semibold ${SIGNAL_STYLE[signal.signal] ?? "bg-muted"}`}>
                {SIGNAL_LABEL[signal.signal] ?? signal.signal}
              </span>
              <span className="text-sm font-mono font-medium">{Math.round(signal.confidence * 100)}%</span>
            </div>
            <div className="w-32 h-1.5 rounded-full bg-muted overflow-hidden mt-1">
              <div
                className={`h-full rounded-full ${SIGNAL_BAR[signal.signal] ?? "bg-muted-foreground"}`}
                style={{ width: `${Math.round(signal.confidence * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{signal.model_version} · {signal.date}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Sem sinal disponível</p>
        )}
      </div>

      {/* P&L */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">P&L</p>
        <div className="space-y-1 mt-1">
          {pnlCusto !== null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">vs custo</span>
              <span className={`font-mono font-semibold ${pnlCusto >= 0 ? "text-green-600" : "text-red-500"}`}>
                {pnlCusto >= 0 ? "+" : ""}{pnlCusto.toFixed(2)}%
              </span>
            </div>
          )}
          {pnlVivo !== null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">vs relatório B3</span>
              <span className={`font-mono font-semibold ${pnlVivo >= 0 ? "text-green-600" : "text-red-500"}`}>
                {pnlVivo >= 0 ? "+" : ""}{pnlVivo.toFixed(2)}%
              </span>
            </div>
          )}
          {valorVivo !== null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Valor vivo</span>
              <span className="font-mono font-semibold">{formatBRL(valorVivo)}</span>
            </div>
          )}
          {totalPortfolio > 0 && posicao.valor_atualizado != null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Peso carteira</span>
              <span className="font-mono font-semibold">{peso.toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Ação */}
      <div className="flex flex-col justify-center gap-2">
        <Button
          size="sm"
          onClick={() => onAsk(posicao.ticker, signal)}
          className="w-full"
        >
          <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
          </svg>
          Perguntar sobre {posicao.ticker}
        </Button>
        {signal && (
          <p className="text-xs text-muted-foreground text-center leading-snug">
            {signal.signal === "compra" && "Devo aumentar posição?"}
            {signal.signal === "venda" && "Devo reduzir posição?"}
            {signal.signal === "neutro" && "Há catalisadores próximos?"}
          </p>
        )}
      </div>
    </div>
  )
}

// ── TabelaPosicoes enriquecida ─────────────────────────────────────────────

function TabelaPosicoes({
  posicoes, signalsMap, quotesMap, totalPortfolio, onAsk,
}: {
  posicoes: PortfolioPosition[]
  signalsMap: Map<string, Signal>
  quotesMap: Map<string, Quote>
  totalPortfolio: number
  onAsk: (ticker: string, signal: Signal | undefined) => void
}) {
  const [tab, setTab] = useState<"acoes_etf_fii" | "tesouro">("acoes_etf_fii")
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null)

  const variavel = posicoes.filter((p) => p.tipo_ativo !== "tesouro")
  const tesouro = posicoes.filter((p) => p.tipo_ativo === "tesouro")

  function toggleExpand(ticker: string) {
    setExpandedTicker((prev) => (prev === ticker ? null : ticker))
  }

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
                <TableHead className="hidden md:table-cell">Nome</TableHead>
                <TableHead className="hidden sm:table-cell">Tipo</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Qtd</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right hidden sm:table-cell">P&L</TableHead>
                <TableHead className="text-center">Sinal</TableHead>
                <TableHead className="text-right hidden md:table-cell">Var. hoje</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {variavel.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground text-sm py-8">
                    Nenhuma posição
                  </TableCell>
                </TableRow>
              ) : variavel.map((p) => {
                const signal = signalsMap.get(p.ticker)
                const quote = quotesMap.get(p.ticker)
                const pnl = p.valor_aplicado && p.valor_atualizado && p.valor_aplicado > 0
                  ? ((p.valor_atualizado - p.valor_aplicado) / p.valor_aplicado) * 100
                  : null
                const peso = totalPortfolio > 0 && p.valor_atualizado != null
                  ? (p.valor_atualizado / totalPortfolio) * 100 : 0
                const isExpanded = expandedTicker === p.ticker

                return (
                  <>
                    <TableRow
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => toggleExpand(p.ticker)}
                    >
                      <TableCell className="font-mono font-bold">{p.ticker}</TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-40 truncate hidden md:table-cell">
                        {p.nome}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIPO_BADGE[p.tipo_ativo] ?? "bg-muted"}`}>
                          {TIPO_LABELS[p.tipo_ativo] ?? p.tipo_ativo}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm hidden sm:table-cell">
                        {formatNum(p.quantidade, 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatBRL(p.valor_atualizado)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm hidden sm:table-cell">
                        {pnl !== null ? (
                          <span className={pnl >= 0 ? "text-green-600" : "text-red-500"}>
                            {pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}%
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {signal ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SIGNAL_STYLE[signal.signal] ?? "bg-muted"}`}>
                            {SIGNAL_LABEL[signal.signal]}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm hidden md:table-cell">
                        {quote ? (
                          <span className={quote.pct_change >= 0 ? "text-green-600" : "text-red-500"}>
                            {quote.pct_change >= 0 ? "+" : ""}{quote.pct_change.toFixed(2)}%
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <svg
                          className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow key={`${p.id}-detail`} className="hover:bg-transparent">
                        <TableCell colSpan={9} className="p-0">
                          <DrilldownPanel
                            posicao={p}
                            signal={signal}
                            quote={quote}
                            peso={peso}
                            totalPortfolio={totalPortfolio}
                            onAsk={onAsk}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                )
              })}
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
                  <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-8">
                    Nenhum título
                  </TableCell>
                </TableRow>
              ) : tesouro.map((p) => {
                const rentab = p.valor_aplicado && p.valor_atualizado && p.valor_aplicado > 0
                  ? ((p.valor_atualizado - p.valor_aplicado) / p.valor_aplicado) * 100 : null
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
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function TabelaProventos({ proventos }: { proventos: PortfolioDividend[] }) {
  const total = proventos.reduce((s, d) => s + (d.valor_liquido ?? 0), 0)
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Proventos recebidos</CardTitle>
          {total > 0 && <span className="text-sm font-mono font-bold text-green-600">{formatBRL(total)}</span>}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticker</TableHead><TableHead>Tipo</TableHead>
              <TableHead className="text-right">Pagamento</TableHead><TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">Preço unit.</TableHead><TableHead className="text-right">Valor líquido</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proventos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-8">Nenhum provento</TableCell>
              </TableRow>
            ) : proventos.map((d) => (
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
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function UploadZone() {
  const upload = useUploadPortfolio()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) return
    upload.mutate(file)
  }, [upload])
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]; if (file) handleFile(file)
  }, [handleFile])
  return (
    <Card
      className={`border-2 border-dashed transition-colors cursor-pointer ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"} ${upload.isPending ? "opacity-70 pointer-events-none" : ""}`}
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
              <p className="text-xs text-muted-foreground mt-0.5">investidor.b3.com.br → Extratos e Informativos → Consolidado mensal</p>
            </div>
          </>
        )}
        {upload.isError && <p className="text-xs text-destructive text-center">{(upload.error as Error).message}</p>}
        {upload.isSuccess && <p className="text-xs text-green-600">Upload concluído!</p>}
      </CardContent>
      <input ref={inputRef} type="file" accept=".pdf" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
    </Card>
  )
}

function SnapshotList({ selectedMes, onSelect }: { selectedMes: string | undefined; onSelect: (mes: string) => void }) {
  const { data: snapshots } = usePortfolioSnapshots()
  const del = useDeleteSnapshot()
  if (!snapshots?.length) return null
  const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Relatórios carregados</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mês</TableHead><TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Upload</TableHead><TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshots.map((s) => {
              const [y, m] = s.mes.split("-")
              return (
                <TableRow
                  key={s.id}
                  className={`cursor-pointer transition-colors ${selectedMes === s.mes ? "bg-muted/60" : "hover:bg-muted/30"}`}
                  onClick={() => onSelect(s.mes)}
                >
                  <TableCell className="font-medium">{monthNames[parseInt(m) - 1]}/{y}</TableCell>
                  <TableCell className="text-right font-mono font-medium">{formatBRL(s.total_portfolio)}</TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs">{formatDate(s.uploaded_at?.split("T")[0])}</TableCell>
                  <TableCell>
                    <button
                      onClick={(e) => { e.stopPropagation(); del.mutate(s.id) }}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
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

function TabCarteira({
  signalsMap, quotesMap, onAsk,
}: {
  signalsMap: Map<string, Signal>
  quotesMap: Map<string, Quote>
  onAsk: (ticker: string, signal: Signal | undefined) => void
}) {
  const [selectedMes, setSelectedMes] = useState<string | undefined>(undefined)
  const { data: snapshots } = usePortfolioSnapshots()
  const { data: summary, isLoading } = usePortfolioSummary(selectedMes)

  const meses = useMemo(
    () => [...(snapshots ?? [])].sort((a, b) => a.mes.localeCompare(b.mes)).map((s) => s.mes),
    [snapshots],
  )
  const mesCurrent = selectedMes ?? meses[meses.length - 1]
  const idx = meses.indexOf(mesCurrent ?? "")
  const canPrev = idx > 0
  const canNext = idx !== -1 && idx < meses.length - 1

  const prevMes = idx > 0 ? meses[idx - 1] : undefined
  const prevMonthTotal = prevMes
    ? (snapshots ?? []).find((s) => s.mes === prevMes)?.total_portfolio ?? null
    : null
  const monthlyReturn = prevMonthTotal != null && summary != null
    ? ((summary.total_portfolio - prevMonthTotal) / prevMonthTotal) * 100
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">Carteira de investimentos — relatório mensal B3</p>
        {meses.length > 0 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => canPrev && setSelectedMes(meses[idx - 1])}
              disabled={!canPrev}
              className="p-1.5 rounded hover:bg-muted disabled:opacity-30 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
            <span className="text-sm font-semibold min-w-20 text-center tabular-nums">
              {mesCurrent ? fmtMesLabel(mesCurrent) : "—"}
            </span>
            <button
              onClick={() => canNext ? setSelectedMes(meses[idx + 1]) : setSelectedMes(undefined)}
              disabled={!canNext && selectedMes === undefined}
              className="p-1.5 rounded hover:bg-muted disabled:opacity-30 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <UploadZone />

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-6 justify-center animate-pulse">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v8z" />
          </svg>
          Carregando…
        </div>
      )}

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
          <Link to="/visao-geral" className="text-sm text-primary hover:underline">Ver Visão Geral →</Link>
        </div>
      )}

      {summary && (
        <>
          <KPICards
            totalPortfolio={summary.total_portfolio}
            totalAcoes={summary.total_acoes}
            totalEtf={summary.total_etf}
            totalFii={summary.total_fii}
            totalTesouro={summary.total_tesouro}
            totalProventos={summary.total_proventos}
            monthlyReturn={monthlyReturn}
            prevMes={prevMes}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AlocacaoChart
              totalAcoes={summary.total_acoes}
              totalEtf={summary.total_etf}
              totalFii={summary.total_fii}
              totalTesouro={summary.total_tesouro}
            />
            <SnapshotList selectedMes={mesCurrent} onSelect={setSelectedMes} />
          </div>
          <TabelaPosicoes
            posicoes={summary.posicoes}
            signalsMap={signalsMap}
            quotesMap={quotesMap}
            totalPortfolio={summary.total_portfolio}
            onAsk={onAsk}
          />
          <TabelaProventos proventos={summary.proventos} />
        </>
      )}

      {!summary && !isLoading && (
        <SnapshotList selectedMes={mesCurrent} onSelect={setSelectedMes} />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// ABA MERCADO — componentes
// ════════════════════════════════════════════════════════════════

// ── Seção Oportunidades na Carteira ───────────────────────────────────────

function OportunidadesSection({
  posicoes, signalsMap, quotesMap, totalPortfolio, onAsk,
}: {
  posicoes: PortfolioPosition[]
  signalsMap: Map<string, Signal>
  quotesMap: Map<string, Quote>
  totalPortfolio: number
  onAsk: (ticker: string, signal: Signal | undefined) => void
}) {
  const oportunidades = useMemo(() => {
    const variavel = posicoes.filter((p) => p.tipo_ativo !== "tesouro" && p.valor_atualizado != null)
    return variavel
      .map((p) => {
        const signal = signalsMap.get(p.ticker)
        const quote = quotesMap.get(p.ticker)
        const peso = totalPortfolio > 0 ? ((p.valor_atualizado ?? 0) / totalPortfolio) * 100 : 0
        const score = signal ? signal.confidence * (peso / 100) : 0
        const pnl = p.valor_aplicado && p.valor_atualizado && p.valor_aplicado > 0
          ? ((p.valor_atualizado - p.valor_aplicado) / p.valor_aplicado) * 100 : null
        return { p, signal, quote, peso, score, pnl }
      })
      .filter((item) => item.signal && (item.signal.signal !== "neutro" || item.signal.confidence >= 0.6))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  }, [posicoes, signalsMap, quotesMap, totalPortfolio])

  if (oportunidades.length === 0) return null

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Oportunidades na sua Carteira</CardTitle>
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
            {oportunidades.length} ativo{oportunidades.length !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Ordenado por score (confiança do sinal × peso no portfólio). Clique em "Perguntar" para análise via RAG.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticker</TableHead>
              <TableHead>Sinal</TableHead>
              <TableHead className="text-right">Confiança</TableHead>
              <TableHead className="text-right hidden sm:table-cell">% Portfólio</TableHead>
              <TableHead className="text-right hidden sm:table-cell">P&L</TableHead>
              <TableHead className="text-right hidden md:table-cell">Var. hoje</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {oportunidades.map(({ p, signal, quote, peso, pnl }) => (
              <TableRow key={p.ticker}>
                <TableCell className="font-mono font-bold">{p.ticker}</TableCell>
                <TableCell>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SIGNAL_STYLE[signal!.signal] ?? "bg-muted"}`}>
                    {SIGNAL_LABEL[signal!.signal]}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-14 h-1.5 rounded-full bg-muted overflow-hidden hidden sm:block">
                      <div
                        className={`h-full rounded-full ${SIGNAL_BAR[signal!.signal] ?? "bg-muted-foreground"}`}
                        style={{ width: `${Math.round(signal!.confidence * 100)}%` }}
                      />
                    </div>
                    <span className="font-mono text-sm">{Math.round(signal!.confidence * 100)}%</span>
                  </div>
                </TableCell>
                <TableCell className="text-right text-sm font-mono hidden sm:table-cell">
                  {peso.toFixed(1)}%
                </TableCell>
                <TableCell className="text-right text-sm font-mono hidden sm:table-cell">
                  {pnl !== null ? (
                    <span className={pnl >= 0 ? "text-green-600" : "text-red-500"}>
                      {pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}%
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right text-sm font-mono hidden md:table-cell">
                  {quote ? (
                    <span className={quote.pct_change >= 0 ? "text-green-600" : "text-red-500"}>
                      {quote.pct_change >= 0 ? "+" : ""}{quote.pct_change.toFixed(2)}%
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <button
                    onClick={() => onAsk(p.ticker, signal)}
                    className="text-xs text-primary hover:underline font-medium whitespace-nowrap"
                  >
                    Perguntar →
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ── Cotações ───────────────────────────────────────────────────────────────

function QuotesSection({
  quotes, isLoading, portfolioTickers,
}: {
  quotes: Quote[] | undefined
  isLoading: boolean
  portfolioTickers: Set<string>
}) {
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Cotações B3</CardTitle>
        <span className="text-xs text-muted-foreground">Atualiza a cada 60s</span>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground animate-pulse">Carregando cotações…</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Var %</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Máx</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Mín</TableHead>
                <TableHead className="text-right hidden md:table-cell">Volume</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(quotes ?? []).map((q) => {
                const ticker = norm(q.ticker)
                const naCarteira = portfolioTickers.has(ticker)
                return (
                  <TableRow key={q.ticker} className={naCarteira ? "bg-primary/5" : ""}>
                    <TableCell className="font-mono font-semibold text-sm">
                      <span className="flex items-center gap-1.5">
                        {ticker}
                        {naCarteira && (
                          <span className="text-xs bg-primary/15 text-primary px-1.5 py-0.5 rounded font-medium">
                            minha
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      R$ {q.price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className={`text-right font-mono font-medium ${q.pct_change >= 0 ? "text-green-600" : "text-red-500"}`}>
                      {q.pct_change >= 0 ? "+" : ""}{q.pct_change.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm hidden sm:table-cell">
                      R$ {q.day_high.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm hidden sm:table-cell">
                      R$ {q.day_low.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm hidden md:table-cell">
                      {formatVolume(q.volume)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ── Sinais ML com filtro e ação ────────────────────────────────────────────

function SignalsSection({
  signals, isLoading, portfolioTickers, onAsk,
}: {
  signals: Signal[] | undefined
  isLoading: boolean
  portfolioTickers: Set<string>
  onAsk: (ticker: string, signal: Signal | undefined) => void
}) {
  const temCarteira = portfolioTickers.size > 0
  const [filter, setFilter] = useState<"carteira" | "todos">(temCarteira ? "carteira" : "todos")

  const displayed = useMemo(() => {
    const all = signals ?? []
    if (filter === "carteira" && temCarteira)
      return all.filter((s) => portfolioTickers.has(norm(s.ticker)))
    return all
  }, [signals, filter, portfolioTickers, temCarteira])

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Sinais ML</CardTitle>
          {temCarteira && (
            <div className="flex rounded-md border border-input overflow-hidden text-xs">
              <button
                onClick={() => setFilter("carteira")}
                className={`px-2.5 py-1 transition-colors ${filter === "carteira" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
              >
                Minha carteira
              </button>
              <button
                onClick={() => setFilter("todos")}
                className={`px-2.5 py-1 border-l border-input transition-colors ${filter === "todos" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
              >
                Todos
              </button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground animate-pulse">Carregando sinais…</div>
        ) : displayed.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {filter === "carteira"
              ? "Nenhum sinal disponível para os tickers da carteira."
              : "Nenhum sinal disponível."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Sinal</TableHead>
                <TableHead className="text-right">Confiança</TableHead>
                <TableHead className="hidden sm:table-cell">Data</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map((s) => {
                const ticker = norm(s.ticker)
                const naCarteira = portfolioTickers.has(ticker)
                return (
                  <TableRow key={s.ticker} className={naCarteira ? "bg-primary/5" : ""}>
                    <TableCell className="font-mono font-semibold text-sm">
                      <span className="flex items-center gap-1.5">
                        {ticker}
                        {naCarteira && (
                          <span className="text-xs bg-primary/15 text-primary px-1.5 py-0.5 rounded font-medium">
                            minha
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SIGNAL_STYLE[s.signal] ?? "bg-muted"}`}>
                        {SIGNAL_LABEL[s.signal] ?? s.signal}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden hidden sm:block">
                          <div
                            className={`h-full rounded-full ${SIGNAL_BAR[s.signal] ?? "bg-muted-foreground"}`}
                            style={{ width: `${Math.round(s.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-sm">{Math.round(s.confidence * 100)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm hidden sm:table-cell">{s.date}</TableCell>
                    <TableCell className="text-right">
                      <button
                        onClick={() => onAsk(ticker, s)}
                        className="text-xs text-primary hover:underline font-medium"
                      >
                        Perguntar →
                      </button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ── Chat RAG com prefill de pergunta ──────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  meta?: Pick<ChatResponse, "latency_ms" | "tokens_used" | "classificacao">
}

function ChatSection({
  prefilledQuestion,
  onClearPrefilled,
}: {
  prefilledQuestion: string | null
  onClearPrefilled: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [usePersonalCtx, setUsePersonalCtx] = useState(true)
  const { mutate, isPending } = useChat()
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (prefilledQuestion) {
      setInput(prefilledQuestion)
      onClearPrefilled()
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [prefilledQuestion, onClearPrefilled])

  function sendMessage() {
    const q = input.trim()
    if (!q || isPending) return
    setInput("")
    setMessages((prev) => [...prev, { role: "user", content: q }])
    mutate(
      { question: q, top_k: 5, use_financial_context: usePersonalCtx },
      {
        onSuccess: (data) => {
          setMessages((prev) => [...prev, {
            role: "assistant", content: data.answer,
            meta: { latency_ms: data.latency_ms, tokens_used: data.tokens_used, classificacao: data.classificacao },
          }])
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
        },
        onError: (err) => {
          setMessages((prev) => [...prev, { role: "assistant", content: `Erro: ${(err as Error).message}` }])
        },
      }
    )
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Chat RAG — Pergunte sobre B3</CardTitle>
            {prefilledQuestion === null && messages.length === 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Clique em "Perguntar →" em qualquer sinal ou posição para pré-preencher a pergunta.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setUsePersonalCtx((v) => !v)}
            title={usePersonalCtx ? "Contexto pessoal ativo (prompt v3)" : "Contexto pessoal desativado (prompt v2)"}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
              usePersonalCtx
                ? "bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-950 dark:border-indigo-700 dark:text-indigo-300"
                : "bg-muted border-border text-muted-foreground"
            }`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
            {usePersonalCtx ? "Contexto pessoal" : "Sem contexto"}
          </button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 min-h-48 max-h-96 overflow-y-auto pr-1">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Faça uma pergunta sobre as ações da B3.<br />
              Ex: "Como está PETR4?" ou "Compare VALE3 e ITUB4"
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
              }`}>
                {m.content}
              </div>
              {m.meta && (
                <div className="flex items-center gap-2 px-1">
                  {m.meta.classificacao && (
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${CLASSIFICACAO_STYLE[m.meta.classificacao] ?? "bg-muted"}`}>
                      {m.meta.classificacao}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {Math.round(m.meta.latency_ms)}ms · {m.meta.tokens_used} tokens
                  </span>
                </div>
              )}
            </div>
          ))}
          {isPending && (
            <div className="flex items-start gap-2">
              <div className="bg-muted rounded-xl px-4 py-2.5 text-sm text-muted-foreground animate-pulse">
                Consultando RAG…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendMessage() }}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte sobre uma ação…"
            disabled={isPending}
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <Button type="submit" disabled={isPending || !input.trim()} size="sm">
            {isPending ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v8z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function TabMercado({
  quotes, signals, quotesLoading, signalsLoading,
  latestPositions, totalPortfolio,
  prefilledQuestion, onClearPrefilled, onAsk,
}: {
  quotes: Quote[] | undefined
  signals: Signal[] | undefined
  quotesLoading: boolean
  signalsLoading: boolean
  latestPositions: PortfolioPosition[]
  totalPortfolio: number
  prefilledQuestion: string | null
  onClearPrefilled: () => void
  onAsk: (ticker: string, signal: Signal | undefined) => void
}) {
  const signalsMap = useMemo(() => {
    const map = new Map<string, Signal>()
    for (const s of signals ?? []) map.set(norm(s.ticker), s)
    return map
  }, [signals])

  const quotesMap = useMemo(() => {
    const map = new Map<string, Quote>()
    for (const q of quotes ?? []) map.set(norm(q.ticker), q)
    return map
  }, [quotes])

  const portfolioTickers = useMemo(
    () => new Set(latestPositions.filter((p) => p.tipo_ativo !== "tesouro").map((p) => p.ticker)),
    [latestPositions]
  )

  const variavel = latestPositions.filter((p) => p.tipo_ativo !== "tesouro")

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Cotações em tempo real, sinais de ML e análise via RAG</p>

      {/* Oportunidades na Carteira — só aparece quando há portfólio carregado */}
      {variavel.length > 0 && (
        <OportunidadesSection
          posicoes={variavel}
          signalsMap={signalsMap}
          quotesMap={quotesMap}
          totalPortfolio={totalPortfolio}
          onAsk={onAsk}
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <QuotesSection quotes={quotes} isLoading={quotesLoading} portfolioTickers={portfolioTickers} />
        <SignalsSection
          signals={signals}
          isLoading={signalsLoading}
          portfolioTickers={portfolioTickers}
          onAsk={onAsk}
        />
      </div>

      <ChatSection prefilledQuestion={prefilledQuestion} onClearPrefilled={onClearPrefilled} />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Página principal
// ════════════════════════════════════════════════════════════════

type Tab = "carteira" | "mercado"

export default function Investimentos() {
  const [tab, setTab] = useState<Tab>("carteira")
  const [prefilledQuestion, setPrefilledQuestion] = useState<string | null>(null)

  // Hooks compartilhados entre abas
  const { data: quotes, isLoading: quotesLoading } = useQuotes()
  const { data: signals, isLoading: signalsLoading } = useSignals()

  // Portfolio mais recente para a aba Mercado
  const { data: snapshots } = usePortfolioSnapshots()
  const latestMes = useMemo(() => {
    if (!snapshots?.length) return undefined
    return [...snapshots].sort((a, b) => b.mes.localeCompare(a.mes))[0].mes
  }, [snapshots])
  const { data: latestSummary } = usePortfolioSummary(latestMes)

  const latestPositions = latestSummary?.posicoes ?? []
  const totalPortfolio = latestSummary?.total_portfolio ?? 0

  // Maps de lookup por ticker (normalizado sem .SA)
  const signalsMap = useMemo(() => {
    const map = new Map<string, Signal>()
    for (const s of signals ?? []) map.set(norm(s.ticker), s)
    return map
  }, [signals])

  const quotesMap = useMemo(() => {
    const map = new Map<string, Quote>()
    for (const q of quotes ?? []) map.set(norm(q.ticker), q)
    return map
  }, [quotes])

  // Ao clicar "Perguntar sobre TICKER": monta pergunta contextual e muda para aba Mercado
  function handleAskAboutTicker(ticker: string, signal: Signal | undefined) {
    const question = buildQuestion(ticker, signal?.signal ?? "neutro")
    setPrefilledQuestion(question)
    setTab("mercado")
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header + tabs */}
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Investimentos</h1>
        <div className="flex gap-1 border-b border-border">
          {([
            { id: "carteira", label: "Carteira", icon: "M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" },
            { id: "mercado",  label: "Mercado",  icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" },
          ] as { id: Tab; label: string; icon: string }[]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={t.icon} />
              </svg>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "carteira" ? (
        <TabCarteira
          signalsMap={signalsMap}
          quotesMap={quotesMap}
          onAsk={handleAskAboutTicker}
        />
      ) : (
        <TabMercado
          quotes={quotes}
          signals={signals}
          quotesLoading={quotesLoading}
          signalsLoading={signalsLoading}
          latestPositions={latestPositions}
          totalPortfolio={totalPortfolio}
          prefilledQuestion={prefilledQuestion}
          onClearPrefilled={() => setPrefilledQuestion(null)}
          onAsk={handleAskAboutTicker}
        />
      )}
    </div>
  )
}
