import { useState } from "react"
import { Link } from "react-router-dom"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRenda, useRendaResumo, useCreateRenda, useDeleteRenda } from "@/api/renda"
import { useAlertas } from "@/api/analiseIntegrada"
import { usePortfolioSummary } from "@/api/portfolio"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// ── Constantes ──────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  salario: "Salário",
  plr: "PLR",
  decimo_terceiro: "13º Salário",
  bonus: "Bônus",
  outros: "Outros",
}

const TIPO_COLORS: Record<string, string> = {
  salario: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  plr: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
  decimo_terceiro: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  bonus: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300",
  outros: "bg-gray-100 text-gray-800 dark:bg-gray-800/60 dark:text-gray-300",
}

// ── Utils ───────────────────────────────────────────────────────────────────

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
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

// ── ResumoCards ─────────────────────────────────────────────────────────────

function ResumoCards({
  totalRenda,
  totalGastos,
  saldo,
  taxaPoupanca,
}: {
  totalRenda: number
  totalGastos: number
  saldo: number
  taxaPoupanca: number
}) {
  const saldoPositivo = saldo >= 0

  return (
    <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
      {/* Renda */}
      <Card className="p-4 border-l-4 border-l-green-500">
        <div className="flex items-start justify-between">
          <p className="text-xs text-muted-foreground">Renda total</p>
          <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
          </svg>
        </div>
        <p className="text-2xl font-bold mt-1 text-green-600 tabular-nums">{formatBRL(totalRenda)}</p>
        <p className="text-xs text-muted-foreground mt-0.5">Entradas do mês</p>
      </Card>

      {/* Gastos */}
      <Card className="p-4 border-l-4 border-l-slate-400">
        <div className="flex items-start justify-between">
          <p className="text-xs text-muted-foreground">Total líquido</p>
          <svg className="w-4 h-4 text-muted-foreground/40 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
          </svg>
        </div>
        <p className="text-2xl font-bold mt-1 tabular-nums">{formatBRL(totalGastos)}</p>
        {totalRenda > 0 ? (
          <p className="text-xs text-muted-foreground mt-0.5">
            {((totalGastos / totalRenda) * 100).toFixed(0)}% da renda
          </p>
        ) : (
          <p className="text-xs text-muted-foreground mt-0.5">Faturas do mês</p>
        )}
      </Card>

      {/* Saldo */}
      <Card className={`p-4 ${
        saldoPositivo
          ? "border-l-4 border-l-green-500 border-green-200 bg-green-50 dark:bg-green-950/20"
          : "border-l-4 border-l-red-500 border-red-200 bg-red-50 dark:bg-red-950/20"
      }`}>
        <div className="flex items-start justify-between">
          <p className="text-xs text-muted-foreground">Saldo</p>
          <svg className={`w-4 h-4 shrink-0 ${saldoPositivo ? "text-green-500" : "text-red-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d={saldoPositivo
                ? "M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                : "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              }
            />
          </svg>
        </div>
        <p className={`text-2xl font-bold mt-1 tabular-nums ${saldoPositivo ? "text-green-600" : "text-red-600"}`}>
          {formatBRL(saldo)}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">Renda − Gastos</p>
      </Card>

      {/* Taxa de poupança */}
      <Card className="p-4 border-l-4 border-l-primary">
        <div className="flex items-start justify-between">
          <p className="text-xs text-muted-foreground">Taxa de poupança</p>
          <svg className="w-4 h-4 text-primary/40 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125m16.5 2.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
          </svg>
        </div>
        <p className="text-2xl font-bold mt-1 tabular-nums">
          {totalRenda > 0 ? `${taxaPoupanca.toFixed(1)}%` : "—"}
        </p>
        {totalRenda > 0 && taxaPoupanca >= 20 && (
          <p className="text-xs text-green-600 mt-0.5">Meta: 20% atingida!</p>
        )}
        {totalRenda > 0 && taxaPoupanca < 20 && taxaPoupanca >= 0 && (
          <p className="text-xs text-muted-foreground mt-0.5">Meta: 20%</p>
        )}
        {taxaPoupanca < 0 && (
          <p className="text-xs text-red-600 mt-0.5">Gastos acima da renda</p>
        )}
        {totalRenda === 0 && (
          <p className="text-xs text-muted-foreground mt-0.5">Meta: 20%</p>
        )}
      </Card>
    </div>
  )
}

// ── Barra de progresso renda vs gastos ──────────────────────────────────────

function BarraRendaGastos({
  totalRenda,
  totalGastos,
}: {
  totalRenda: number
  totalGastos: number
}) {
  if (totalRenda <= 0) return null
  const pct = Math.min((totalGastos / totalRenda) * 100, 100)
  const overcap = totalGastos > totalRenda

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Comprometimento da renda</span>
        <span className={`text-sm font-mono font-bold ${overcap ? "text-red-600" : "text-foreground"}`}>
          {pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-3 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${overcap ? "bg-red-500" : pct > 80 ? "bg-yellow-500" : "bg-green-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5">
        <span className="text-xs text-muted-foreground">R$ 0</span>
        <span className="text-xs text-muted-foreground">{formatBRL(totalRenda)}</span>
      </div>
    </Card>
  )
}

// ── Formulário de nova renda ─────────────────────────────────────────────────

const schema = z.object({
  tipo: z.enum(["salario", "plr", "decimo_terceiro", "bonus", "outros"]),
  descricao: z.string().min(2, "Mínimo 2 caracteres"),
  valor: z.coerce.number().positive("Valor deve ser positivo"),
})

type FormData = z.infer<typeof schema>

function AddRendaForm({ mes }: { mes: string }) {
  const createRenda = useCreateRenda()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = useForm<FormData>({ resolver: zodResolver(schema) as any })

  function onSubmit(data: FormData) {
    createRenda.mutate(
      { ...data, mes },
      { onSuccess: () => reset() },
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div>
          <CardTitle className="text-base">Nova entrada de renda</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Registre uma fonte de renda para este mês</p>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap gap-3 items-end">
          {/* Tipo */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Tipo</label>
            <select
              {...register("tipo")}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="salario">Salário</option>
              <option value="plr">PLR</option>
              <option value="decimo_terceiro">13º Salário</option>
              <option value="bonus">Bônus</option>
              <option value="outros">Outros</option>
            </select>
          </div>

          {/* Descrição */}
          <div className="flex flex-col gap-1 flex-1 min-w-40">
            <label className="text-xs text-muted-foreground font-medium">Descrição</label>
            <input
              {...register("descricao")}
              placeholder="Ex: Salário empresa X"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {errors.descricao && (
              <span className="text-xs text-destructive">{errors.descricao.message}</span>
            )}
          </div>

          {/* Valor */}
          <div className="flex flex-col gap-1 w-36">
            <label className="text-xs text-muted-foreground font-medium">Valor (R$)</label>
            <input
              {...register("valor")}
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0,00"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {errors.valor && (
              <span className="text-xs text-destructive">{errors.valor.message}</span>
            )}
          </div>

          <button
            type="submit"
            disabled={createRenda.isPending}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {createRenda.isPending ? "Salvando…" : "Adicionar"}
          </button>

          {createRenda.isError && (
            <p className="w-full text-xs text-destructive">
              {(createRenda.error as Error).message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

// ── Lista de entradas ────────────────────────────────────────────────────────

function RendaList({ mes }: { mes: string }) {
  const { data, isLoading, error } = useRenda(mes)
  const deleteRenda = useDeleteRenda()

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Entradas do mês</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 animate-pulse">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <div className="h-5 w-16 rounded-full bg-muted" />
              <div className="flex-1 h-4 bg-muted rounded w-40" />
              <div className="h-4 bg-muted rounded w-24 ml-auto" />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <p className="text-sm text-destructive py-2">{(error as Error).message}</p>
    )
  }

  const entries = data ?? []
  const total = entries.reduce((s, e) => s + e.valor, 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Entradas do mês</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-12">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-foreground">Nenhuma renda registrada</p>
                    <p className="text-xs text-muted-foreground max-w-52">
                      Registre seu salário ou outra entrada no formulário acima para calcular o saldo do mês.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              <>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIPO_COLORS[entry.tipo] ?? "bg-muted"}`}>
                        {TIPO_LABELS[entry.tipo] ?? entry.tipo}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{entry.descricao}</TableCell>
                    <TableCell className="text-right font-mono font-medium text-green-600">
                      {formatBRL(entry.valor)}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => deleteRenda.mutate(entry.id)}
                        disabled={deleteRenda.isPending}
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
                ))}
                {/* Total row */}
                <TableRow className="bg-muted/30 font-semibold border-t-2 border-border">
                  <TableCell colSpan={2} className="text-sm">Total</TableCell>
                  <TableCell className="text-right font-mono font-bold text-green-600 text-sm">
                    {formatBRL(total)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ── VisaoGeral (main) ────────────────────────────────────────────────────────

export default function VisaoGeral() {
  const [mes, setMes] = useState(currentMonth)
  const { data: resumo, isLoading: resumoLoading } = useRendaResumo(mes)
  const { data: portfolio } = usePortfolioSummary(mes)
  const { data: alertas = [] } = useAlertas(mes)
  const alertasUrgentes = alertas.filter((a) => a.severidade === "danger").slice(0, 3)

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Visão Geral</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Renda, gastos e saúde financeira do mês
          </p>
        </div>
        <MonthNav mes={mes} onChange={setMes} />
      </div>

      {/* Alertas urgentes */}
      {alertasUrgentes.length > 0 && (
        <div className="space-y-2">
          {alertasUrgentes.map((a, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 px-4 py-3 text-sm">
              <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-red-800 dark:text-red-300">{a.titulo}</p>
                {a.acao_sugerida && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{a.acao_sugerida}</p>
                )}
              </div>
              <Link to="/panorama" className="text-xs text-red-700 dark:text-red-300 hover:underline shrink-0 font-medium">
                Ver todos →
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Link
          to="/faturas"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          Subir fatura
        </Link>
        <Link
          to="/gastos"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
          </svg>
          Ver gastos
        </Link>
        <Link
          to="/panorama"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
          </svg>
          Panorama completo
        </Link>
        <Link
          to="/planejar"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
          </svg>
          Planejar
        </Link>
      </div>

      {/* KPI cards de resumo financeiro */}
      {resumoLoading ? (
        <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-4 animate-pulse border-l-4 border-l-muted">
              <div className="flex items-start justify-between mb-2">
                <div className="h-3 bg-muted rounded w-24" />
                <div className="w-4 h-4 bg-muted rounded" />
              </div>
              <div className="h-8 bg-muted rounded w-36 mt-1" />
              <div className="h-3 bg-muted rounded w-20 mt-2" />
            </Card>
          ))}
        </div>
      ) : (
        <ResumoCards
          totalRenda={resumo?.total_renda ?? 0}
          totalGastos={resumo?.total_gastos ?? 0}
          saldo={resumo?.saldo ?? 0}
          taxaPoupanca={resumo?.taxa_poupanca ?? 0}
        />
      )}

      {/* Barra de comprometimento */}
      {resumo && resumo.total_renda > 0 && (
        <BarraRendaGastos
          totalRenda={resumo.total_renda}
          totalGastos={resumo.total_gastos}
        />
      )}

      {/* Card de patrimônio investido */}
      <Card className="p-4 bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium">Patrimônio investido</p>
              <p className="text-2xl font-bold tabular-nums text-primary">
                {portfolio ? formatBRL(portfolio.total_portfolio) : "—"}
              </p>
            </div>
          </div>
          {portfolio && portfolio.total_portfolio > 0 && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                <span className="text-muted-foreground text-xs">Ações</span>
                <span className="font-mono text-xs font-medium tabular-nums">{formatBRL(portfolio.total_acoes)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
                <span className="text-muted-foreground text-xs">ETF</span>
                <span className="font-mono text-xs font-medium tabular-nums">{formatBRL(portfolio.total_etf ?? 0)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                <span className="text-muted-foreground text-xs">FII</span>
                <span className="font-mono text-xs font-medium tabular-nums">{formatBRL(portfolio.total_fii)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                <span className="text-muted-foreground text-xs">Tesouro</span>
                <span className="font-mono text-xs font-medium tabular-nums">{formatBRL(portfolio.total_tesouro)}</span>
              </div>
            </div>
          )}
          <Link
            to="/patrimonio"
            className="text-sm text-primary hover:underline flex items-center gap-1 shrink-0"
          >
            Ver carteira completa
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </Card>

      {/* Formulário + lista de renda */}
      <AddRendaForm mes={mes} />
      <RendaList mes={mes} />
    </div>
  )
}
