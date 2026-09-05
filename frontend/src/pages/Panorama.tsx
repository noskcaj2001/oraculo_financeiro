import { useRef, useState, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  AreaChart, Area, BarChart, Bar, Cell, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts"
import {
  useAnaliseIntegrada, useHistorico, useRelatorio,
  type AlertaSchema, type AIInsight,
} from "@/api/analiseIntegrada"
import { usePatrimonioTotal } from "@/api/patrimonioTotal"
import { useChat, type ChatResponse } from "@/api/b3"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

// ── Formatadores ───────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
}

function pct(v: number) {
  return `${v.toFixed(1)}%`
}

function mesLabel(mes: string) {
  const [y, m] = mes.split("-")
  const names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
  return `${names[parseInt(m) - 1]}/${y.slice(2)}`
}

function projetar(capital: number, aporte: number, taxaAnual: number, anos: number): number {
  const taxaMensal = (1 + taxaAnual) ** (1 / 12) - 1
  const meses = anos * 12
  if (taxaMensal === 0) return capital + aporte * meses
  return capital * (1 + taxaMensal) ** meses + aporte * (((1 + taxaMensal) ** meses - 1) / taxaMensal)
}

// ── Constantes ─────────────────────────────────────────────────────────────

const CENARIOS = [
  { label: "Conservador", taxa: 0.06, cor: "text-blue-600 dark:text-blue-400" },
  { label: "Moderado", taxa: 0.10, cor: "text-indigo-600 dark:text-indigo-400" },
  { label: "Arrojado", taxa: 0.15, cor: "text-violet-600 dark:text-violet-400" },
]
const PRAZOS = [1, 2, 5]
const PIE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"]

const SIGNAL_COLORS: Record<string, string> = {
  compra: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400",
  neutro: "text-yellow-600 bg-yellow-50 dark:bg-yellow-950/40 dark:text-yellow-400",
  venda: "text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-400",
}

const INSIGHT_BORDER: Record<number, string> = {
  1: "border-l-red-500", 2: "border-l-yellow-500", 3: "border-l-blue-500",
}
const INSIGHT_BADGE: Record<number, string> = {
  1: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  2: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-400",
  3: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
}
const INSIGHT_LABEL: Record<number, string> = { 1: "Urgente", 2: "Importante", 3: "Informativo" }
const CATEGORIA_LABEL: Record<string, string> = {
  fluxo_caixa: "Fluxo de Caixa",
  investimentos: "Investimentos",
  patrimonio: "Patrimônio",
  acao: "Ação Recomendada",
}

const ALERTA_BORDER: Record<string, string> = {
  danger: "border-l-red-500", warn: "border-l-yellow-500", info: "border-l-blue-400",
}
const ALERTA_BADGE: Record<string, string> = {
  danger: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  warn: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
}
const ALERTA_LABEL: Record<string, string> = { danger: "Atenção", warn: "Aviso", info: "Info" }

// ── KPI Card ───────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = "border-l-border" }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className={`bg-card border border-border border-l-4 ${color} rounded-lg p-4`}>
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Equity Bar ─────────────────────────────────────────────────────────────

function EquityBar({ pctPago, label }: { pctPago: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, pctPago))
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        <span className="shrink-0 ml-2 font-medium">{pct(clamped)} quitado</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

// ── Alerta Card (dismissível) ──────────────────────────────────────────────

function AlertaCard({ alerta, onDismiss }: { alerta: AlertaSchema; onDismiss?: () => void }) {
  return (
    <div className={`bg-card border border-border border-l-4 ${ALERTA_BORDER[alerta.severidade] ?? "border-l-gray-400"} rounded-xl p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ALERTA_BADGE[alerta.severidade] ?? ""}`}>
              {ALERTA_LABEL[alerta.severidade] ?? alerta.severidade}
            </span>
          </div>
          <p className="font-medium text-sm">{alerta.titulo}</p>
          {(alerta as any).descricao && (
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{(alerta as any).descricao}</p>
          )}
          {alerta.acao_sugerida && (
            <p className="text-xs text-primary mt-2">💡 {alerta.acao_sugerida}</p>
          )}
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

// ── Waterfall Chart ────────────────────────────────────────────────────────

function WaterfallChart({ renda, fixos, fatura, pontuais, saldo }: {
  renda: number; fixos: number; fatura: number; pontuais: number; saldo: number
}) {
  const data = [
    { name: "Renda", base: 0, valor: renda, cor: "#10b981" },
    { name: "−Fixos", base: renda - fixos, valor: fixos, cor: "#f59e0b" },
    { name: "−Fatura", base: renda - fixos - fatura, valor: fatura, cor: "#ef4444" },
    { name: "−Pontuais", base: renda - fixos - fatura - pontuais, valor: pontuais, cor: "#f97316" },
    { name: "= Saldo", base: 0, valor: saldo, cor: saldo >= 0 ? "#6366f1" : "#dc2626" },
  ]

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 8 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} width={52} />
        <Tooltip formatter={(v: number, name: string) => name === "valor" ? [brl(v), "Valor"] : [null, null]} />
        <Bar dataKey="base" stackId="a" fill="transparent" />
        <Bar dataKey="valor" stackId="a" radius={[4, 4, 0, 0]}>
          {data.map((entry, i) => <Cell key={i} fill={entry.cor} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Insight Card ───────────────────────────────────────────────────────────

function InsightCard({ insight }: { insight: AIInsight }) {
  return (
    <div className={`bg-card border border-border border-l-4 ${INSIGHT_BORDER[insight.prioridade]} rounded-xl p-4`}>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${INSIGHT_BADGE[insight.prioridade]}`}>
          {INSIGHT_LABEL[insight.prioridade]}
        </span>
        <span className="text-xs text-muted-foreground">
          {CATEGORIA_LABEL[insight.categoria] ?? insight.categoria}
        </span>
      </div>
      <p className="font-medium text-sm">{insight.titulo}</p>
      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{insight.texto}</p>
    </div>
  )
}

// ── Custom Tooltip ─────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-xs space-y-1">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{brl(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Navegação de Mês ───────────────────────────────────────────────────────

function NavMes({ mes, onChange }: { mes: string; onChange: (m: string) => void }) {
  const hoje = new Date()
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`

  function deslocar(delta: number) {
    const [y, m] = mes.split("-").map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  }

  const ehAtual = mes === mesAtual

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => deslocar(-1)}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
      </button>
      <span className="text-sm font-semibold text-foreground min-w-[80px] text-center">{mesLabel(mes)}</span>
      <button
        onClick={() => deslocar(1)}
        disabled={ehAtual}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      </button>
      {!ehAtual && (
        <button onClick={() => onChange(mesAtual)} className="text-xs text-primary hover:underline ml-1">
          Hoje
        </button>
      )}
    </div>
  )
}

// ── Chat Contextual ────────────────────────────────────────────────────────

interface ChatMsg { role: "user" | "assistant"; content: string }

function ChatContextual({ mes }: { mes: string }) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState("")
  const { mutate, isPending } = useChat()
  const bottomRef = useRef<HTMLDivElement>(null)

  function send() {
    const q = input.trim()
    if (!q || isPending) return
    setInput("")
    setMessages((prev) => [...prev, { role: "user", content: q }])
    mutate(
      { question: q, top_k: 5, use_financial_context: true },
      {
        onSuccess: (data: ChatResponse) => {
          setMessages((prev) => [...prev, { role: "assistant", content: data.answer }])
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
        },
        onError: (err) => {
          setMessages((prev) => [...prev, { role: "assistant", content: `Erro: ${(err as Error).message}` }])
        },
      }
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Pergunte ao Oráculo</CardTitle>
          <span className="text-xs bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full dark:bg-indigo-950 dark:border-indigo-700 dark:text-indigo-300">
            contexto pessoal ativo
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          O Oráculo conhece seu patrimônio, renda e carteira — perguntas personalizadas para {mesLabel(mes)}.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 min-h-32 max-h-72 overflow-y-auto pr-1">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Ex: "Dado meu comprometimento, devo comprar mais PETR4?" ou "Como está minha diversificação?"
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {isPending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-xl px-4 py-2.5 text-sm text-muted-foreground animate-pulse">
                Consultando com contexto pessoal…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send() }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte sobre seu patrimônio e mercado…"
            disabled={isPending}
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <Button type="submit" size="sm" disabled={isPending || !input.trim()}>
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

// ── Relatório Mensal ───────────────────────────────────────────────────────

function RelatorioPanel({ mes }: { mes: string }) {
  const [enabled, setEnabled] = useState(false)
  const { data, isLoading, isError, refetch } = useRelatorio(mes, enabled)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Relatório Mensal — {mesLabel(mes)}</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { if (!enabled) setEnabled(true); else refetch() }}
            disabled={isLoading}
          >
            {isLoading ? (
              <svg className="w-3.5 h-3.5 animate-spin mr-1.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v8z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
              </svg>
            )}
            {isLoading ? "Gerando…" : data ? "Atualizar" : "Gerar com IA"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!enabled && !data && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Clique em "Gerar com IA" para criar um relatório personalizado do mês com análise e recomendações.
          </p>
        )}
        {isError && <p className="text-sm text-red-600 py-2">Erro ao gerar relatório. Tente novamente.</p>}
        {data && (
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap">
            {data.relatorio}
          </div>
        )}
        {data && (
          <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
            Gerado em {data.gerado_em} · {Math.round(data.latency_ms)}ms
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ── Panorama ───────────────────────────────────────────────────────────────

export default function Panorama() {
  const hoje = new Date()
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`
  const [mes, setMes] = useState(mesAtual)
  const [dismissedAlertas, setDismissedAlertas] = useState<Set<string>>(new Set())
  const qc = useQueryClient()

  const analise = useAnaliseIntegrada(mes)
  const historico = useHistorico(12)
  const patrimonio = usePatrimonioTotal()

  const data = analise.data
  const hist = historico.data ?? []
  const fins = patrimonio.data?.financiamentos ?? []

  const pl = data?.patrimonio.patrimonio_liquido ?? 0
  const renda = data?.fluxo_caixa.renda_total ?? 0
  const saldo = data?.fluxo_caixa.saldo_disponivel ?? 0
  const poupanca = data?.fluxo_caixa.taxa_poupanca ?? 0
  const comprometimento = data?.fluxo_caixa.taxa_comprometimento ?? 0
  const dividas = data?.patrimonio.total_financiamentos ?? 0
  const aporte = Math.max(saldo, 0)
  const portfolioB3 = data?.patrimonio.portfolio_b3 ?? 0

  const alertasVisiveis = useMemo(
    () => (data?.alertas ?? []).filter((a) => !dismissedAlertas.has(a.tipo + a.titulo)),
    [data?.alertas, dismissedAlertas]
  )

  const allocationData = useMemo(() => {
    if (!data) return []
    const items: { name: string; value: number }[] = []
    if (data.patrimonio.portfolio_b3 > 0) items.push({ name: "Carteira B3", value: data.patrimonio.portfolio_b3 })
    if (data.patrimonio.ativos_fisicos > 0) items.push({ name: "Ativos Físicos", value: data.patrimonio.ativos_fisicos })
    return items
  }, [data])

  const chartData = hist.map((h) => ({
    mes: mesLabel(h.mes),
    "Patrimônio Líq.": Math.round(h.patrimonio_liquido),
    "Renda": Math.round(h.total_renda),
    "Saldo": Math.round(h.saldo),
  }))

  const isLoading = analise.isLoading || historico.isLoading
  const isError = analise.isError
  const hasSinais = (data?.sinais_relevantes?.length ?? 0) > 0

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Panorama Financeiro</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Visão executiva consolidada</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <NavMes mes={mes} onChange={setMes} />
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ["analise-integrada"] })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Atualizar
          </button>
        </div>
      </div>

      {isError && (
        <div className="p-4 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400">
          Erro ao carregar dados. Verifique se o backend está rodando.
        </div>
      )}

      {/* KPI primário — Patrimônio Líquido full width */}
      <div className={`bg-card border border-border border-l-4 ${pl >= 0 ? "border-l-emerald-500" : "border-l-red-500"} rounded-xl p-5`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Patrimônio Líquido</p>
            <p className="text-4xl font-bold text-foreground tabular-nums">{isLoading ? "—" : brl(pl)}</p>
            <p className="text-sm text-muted-foreground mt-1">Ativos totais: {brl(data?.patrimonio.total_ativos ?? 0)}</p>
          </div>
          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">B3</p>
              <p className="font-semibold tabular-nums">{brl(portfolioB3)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Ativos Físicos</p>
              <p className="font-semibold tabular-nums">{brl(data?.patrimonio.ativos_fisicos ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Dívidas</p>
              <p className="font-semibold tabular-nums text-orange-600">{brl(dividas)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* KPIs secundários — 5 colunas */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KpiCard
          label="Renda Mensal"
          value={isLoading ? "—" : brl(renda)}
          sub={renda === 0 ? "Não registrada" : mesLabel(mes)}
          color="border-l-sky-500"
        />
        <KpiCard
          label="Saldo p/ Investir"
          value={isLoading ? "—" : brl(saldo)}
          sub={saldo < 0 ? "Saldo negativo" : "Após todos os gastos"}
          color={saldo >= 0 ? "border-l-green-500" : "border-l-red-500"}
        />
        <KpiCard
          label="Taxa de Poupança"
          value={isLoading ? "—" : pct(poupanca)}
          sub={poupanca >= 20 ? "Excelente" : poupanca >= 10 ? "Boa" : "Abaixo da meta (20%)"}
          color={poupanca >= 20 ? "border-l-emerald-500" : poupanca >= 10 ? "border-l-yellow-500" : "border-l-red-500"}
        />
        <KpiCard
          label="Comprometimento"
          value={isLoading ? "—" : pct(comprometimento)}
          sub={comprometimento > 70 ? "Alto — revisar gastos" : "Dentro do limite"}
          color={comprometimento > 70 ? "border-l-red-500" : "border-l-border"}
        />
        <KpiCard
          label="Total de Dívidas"
          value={isLoading ? "—" : brl(dividas)}
          sub={fins.length > 0 ? `${fins.length} financiamento(s)` : "Sem financiamentos"}
          color={dividas > 0 ? "border-l-orange-500" : "border-l-emerald-500"}
        />
      </div>

      {/* Alertas dismissíveis */}
      {alertasVisiveis.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Alertas — {alertasVisiveis.length} identificado{alertasVisiveis.length !== 1 ? "s" : ""}
          </h2>
          {alertasVisiveis.map((a) => (
            <AlertaCard
              key={a.tipo + a.titulo}
              alerta={a}
              onDismiss={() => setDismissedAlertas((prev) => new Set([...prev, a.tipo + a.titulo]))}
            />
          ))}
        </div>
      )}

      {/* Waterfall — Fluxo de Caixa */}
      {data && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Fluxo de Caixa — {mesLabel(mes)}</CardTitle>
          </CardHeader>
          <CardContent>
            <WaterfallChart
              renda={data.fluxo_caixa.renda_total}
              fixos={data.fluxo_caixa.gastos_fixos_total}
              fatura={data.fluxo_caixa.fatura_cartao}
              pontuais={data.fluxo_caixa.gastos_pontuais_total}
              saldo={data.fluxo_caixa.saldo_disponivel}
            />
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3 text-xs">
              {[
                { label: "Renda", v: data.fluxo_caixa.renda_total, color: "text-emerald-600" },
                { label: "Gastos Fixos", v: data.fluxo_caixa.gastos_fixos_total, color: "text-yellow-600" },
                { label: "Fatura Cartão", v: data.fluxo_caixa.fatura_cartao, color: "text-red-600" },
                { label: "Pontuais", v: data.fluxo_caixa.gastos_pontuais_total, color: "text-orange-600" },
                { label: "Saldo", v: data.fluxo_caixa.saldo_disponivel, color: data.fluxo_caixa.saldo_disponivel >= 0 ? "text-indigo-600" : "text-red-600" },
              ].map((item) => (
                <div key={item.label} className="text-center">
                  <p className="text-muted-foreground">{item.label}</p>
                  <p className={`font-semibold tabular-nums ${item.color}`}>{brl(item.v)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Evolução 12 meses */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Evolução Patrimonial — últimos 12 meses</CardTitle>
        </CardHeader>
        <CardContent>
          {hist.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
              Sem histórico disponível. A cada mês calculado, os dados aparecem aqui.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="gradPL" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradRenda" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="Patrimônio Líq." stroke="#6366f1" strokeWidth={2} fill="url(#gradPL)" dot={false} />
                <Area type="monotone" dataKey="Renda" stroke="#0ea5e9" strokeWidth={1.5} fill="url(#gradRenda)" dot={false} strokeDasharray="4 2" />
                <Area type="monotone" dataKey="Saldo" stroke="#10b981" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="2 3" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Grid: Projeções + Composição */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Projeções 3 cenários × 3 prazos */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Projeções de Patrimônio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Capital base: {brl(portfolioB3)} · Aporte mensal: {brl(aporte)}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border">
                    <th className="text-left pb-2 font-medium">Cenário</th>
                    {PRAZOS.map((n) => (
                      <th key={n} className="text-right pb-2 font-medium">{n} ano{n > 1 ? "s" : ""}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {CENARIOS.map((c) => (
                    <tr key={c.label}>
                      <td className={`py-2.5 font-medium ${c.cor}`}>
                        {c.label}
                        <span className="text-xs text-muted-foreground font-normal ml-1">
                          {(c.taxa * 100).toFixed(0)}% a.a.
                        </span>
                      </td>
                      {PRAZOS.map((n) => (
                        <td key={n} className="text-right py-2.5 font-medium tabular-nums">
                          {brl(projetar(portfolioB3, aporte, c.taxa, n))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {portfolioB3 === 0 && (
              <p className="text-xs text-muted-foreground italic">
                Suba o extrato B3 para ver projeções baseadas na carteira real.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Composição do Patrimônio + mini Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Composição do Patrimônio</CardTitle>
          </CardHeader>
          <CardContent>
            {data ? (
              <div className="flex gap-4 items-start">
                <div className="flex-1 space-y-3">
                  {[
                    { label: "Carteira B3", value: data.patrimonio.portfolio_b3, color: "bg-indigo-500" },
                    { label: "Ativos Físicos", value: data.patrimonio.ativos_fisicos, color: "bg-emerald-500" },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>{item.label}</span>
                        <span className="font-medium text-foreground">{brl(item.value)}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full ${item.color} rounded-full`}
                          style={{ width: data.patrimonio.total_ativos > 0 ? `${(item.value / data.patrimonio.total_ativos) * 100}%` : "0%" }}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="border-t border-border pt-2 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Ativos</span>
                      <span className="font-semibold">{brl(data.patrimonio.total_ativos)}</span>
                    </div>
                    <div className="flex justify-between text-red-500">
                      <span>− Financiamentos</span>
                      <span className="font-semibold tabular-nums">{brl(data.patrimonio.total_financiamentos)}</span>
                    </div>
                    <div className="flex justify-between font-bold border-t border-border pt-1">
                      <span>= Patrimônio Líquido</span>
                      <span className={pl >= 0 ? "text-emerald-600" : "text-red-600"}>{brl(pl)}</span>
                    </div>
                  </div>
                </div>
                {allocationData.length > 0 && (
                  <div className="w-28 shrink-0">
                    <ResponsiveContainer width="100%" height={120}>
                      <PieChart>
                        <Pie
                          data={allocationData}
                          dataKey="value"
                          cx="50%"
                          cy="50%"
                          innerRadius={28}
                          outerRadius={50}
                          paddingAngle={2}
                        >
                          {allocationData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => brl(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
                Carregando…
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Grid: Sinais ML + Financiamentos */}
      {(hasSinais || fins.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {hasSinais && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Sinais ML — Sua Carteira</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data!.sinais_relevantes.map((s) => (
                  <div key={s.ticker} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-medium w-16">{s.ticker}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SIGNAL_COLORS[s.signal] ?? ""}`}>
                        {s.signal.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.valor_posicao !== null && (
                        <span className="text-xs text-muted-foreground tabular-nums">{brl(s.valor_posicao)}</span>
                      )}
                      <div className="w-20 bg-muted rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${s.confidence * 100}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-9 text-right">{pct(s.confidence * 100)}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {fins.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Financiamentos Ativos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {fins.map((f) => (
                  <div key={f.id} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium truncate">{f.descricao}</span>
                      <span className="text-muted-foreground shrink-0 ml-2">{brl(f.saldo_devedor)}</span>
                    </div>
                    <EquityBar
                      pctPago={f.equity_pct}
                      label={f.banco ? `${f.banco} · ${brl(f.parcela_mensal)}/mês` : `${brl(f.parcela_mensal)}/mês`}
                    />
                    {f.meses_restantes !== null && (
                      <p className="text-xs text-muted-foreground">{f.meses_restantes} meses restantes</p>
                    )}
                  </div>
                ))}
                <div className="pt-2 border-t border-border flex justify-between text-sm">
                  <span className="text-muted-foreground">Total dívidas</span>
                  <span className="font-semibold">{brl(dividas)}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Insights do Oráculo */}
      {data && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Insights do Oráculo</CardTitle>
              {data.latency_ms > 0 && (
                <span className="text-xs text-muted-foreground">{data.latency_ms.toFixed(0)}ms</span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {data.insights_ai.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Sem insights disponíveis. Cadastre seus dados financeiros para gerar análises.
              </p>
            ) : (
              <div className="space-y-3">
                {data.insights_ai.map((insight, i) => <InsightCard key={i} insight={insight} />)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Relatório Mensal */}
      <RelatorioPanel mes={mes} />

      {/* Chat com contexto pessoal */}
      <ChatContextual mes={mes} />

    </div>
  )
}
