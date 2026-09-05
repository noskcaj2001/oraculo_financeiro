import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useFinanciamentos, type FinanciamentoItem } from "@/api/analiseIntegrada"

// ── Schema ─────────────────────────────────────────────────────────────────

const schema = z.object({
  valor: z.coerce.number().positive("Deve ser positivo"),
  taxa_mensal: z.coerce.number().positive("Deve ser positivo").max(99),
  parcelas: z.coerce.number().int().min(1).max(480),
  sistema: z.enum(["price", "sac"]),
})

type FormData = z.infer<typeof schema>

// ── Types ──────────────────────────────────────────────────────────────────

interface Parcela {
  numero: number
  saldo_devedor: number
  amortizacao: number
  juros: number
  prestacao: number
}

interface SimuladorResponse {
  sistema: string
  valor: number
  taxa_mensal: number
  parcelas_total: number
  prestacao_inicial: number
  prestacao_final: number
  total_pago: number
  total_juros: number
  tabela: Parcela[]
}

interface AmorCalc {
  total_pago_novo: number
  total_juros_novo: number
  economia_juros: number
  parcelas_total_novo: number
  meses_economizados: number | null
  nova_prestacao: number | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

async function simular(data: FormData): Promise<SimuladorResponse> {
  const res = await fetch("/api/simulador/divida", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? "Erro na simulação")
  }
  return res.json() as Promise<SimuladorResponse>
}

function calcularAmortizacao(
  result: SimuladorResponse,
  valorAmort: number,
  aposParc: number,
  modalidade: "prazo" | "parcela",
): AmorCalc | null {
  const i = result.taxa_mensal / 100
  const N = aposParc
  const tabela = result.tabela

  const pagoAteN = tabela.slice(0, N).reduce((s, p) => s + p.prestacao, 0)
  const saldoPosN = tabela[N - 1].saldo_devedor
  const saldoNovo = Math.max(0, saldoPosN - valorAmort)

  let parcelas_restantes_novas: number
  let total_restante: number
  let nova_prestacao: number | null = null
  let meses_economizados: number | null = null

  if (saldoNovo === 0) {
    parcelas_restantes_novas = 0
    total_restante = 0
    meses_economizados = result.parcelas_total - N
  } else if (result.sistema === "price") {
    const PMT = result.prestacao_inicial
    if (modalidade === "prazo") {
      const n_novo = Math.ceil(-Math.log(1 - (saldoNovo * i) / PMT) / Math.log(1 + i))
      parcelas_restantes_novas = n_novo
      total_restante = n_novo * PMT
      meses_economizados = result.parcelas_total - N - n_novo
    } else {
      const remaining = result.parcelas_total - N
      const PMT_novo = (saldoNovo * i) / (1 - Math.pow(1 + i, -remaining))
      parcelas_restantes_novas = remaining
      total_restante = remaining * PMT_novo
      nova_prestacao = PMT_novo
    }
  } else {
    // SAC
    const amortOriginal = result.valor / result.parcelas_total
    if (modalidade === "prazo") {
      const n_novo = Math.ceil(saldoNovo / amortOriginal)
      let totalSac = 0
      let saldo = saldoNovo
      for (let k = 0; k < n_novo; k++) {
        totalSac += saldo * i + Math.min(amortOriginal, saldo)
        saldo -= Math.min(amortOriginal, saldo)
      }
      parcelas_restantes_novas = n_novo
      total_restante = totalSac
      meses_economizados = result.parcelas_total - N - n_novo
    } else {
      const remaining = result.parcelas_total - N
      const amortNovo = saldoNovo / remaining
      let totalSac = 0
      let saldo = saldoNovo
      for (let k = 0; k < remaining; k++) {
        totalSac += saldo * i + amortNovo
        saldo -= amortNovo
      }
      parcelas_restantes_novas = remaining
      total_restante = totalSac
      nova_prestacao = saldoNovo * i + amortNovo
    }
  }

  const total_pago_novo = pagoAteN + valorAmort + total_restante
  const total_juros_novo = total_pago_novo - result.valor
  const economia_juros = result.total_juros - total_juros_novo

  return {
    total_pago_novo,
    total_juros_novo,
    economia_juros,
    parcelas_total_novo: N + parcelas_restantes_novas,
    meses_economizados,
    nova_prestacao,
  }
}

// ── Field ──────────────────────────────────────────────────────────────────

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

const inputCls =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"

// ── Amortização panel ──────────────────────────────────────────────────────

function AmortizacaoPanel({ result }: { result: SimuladorResponse }) {
  const [valorAmort, setValorAmort] = useState("")
  const [aposParc, setAposParc] = useState("1")
  const [modalidade, setModalidade] = useState<"prazo" | "parcela">("prazo")
  const [calc, setCalc] = useState<AmorCalc | null>(null)
  const [err, setErr] = useState("")

  function calcular() {
    const v = parseFloat(valorAmort.replace(",", "."))
    const n = parseInt(aposParc)
    if (isNaN(v) || v <= 0) {
      setErr("Informe um valor válido.")
      return
    }
    if (isNaN(n) || n < 1 || n > result.parcelas_total) {
      setErr(`Parcela deve ser entre 1 e ${result.parcelas_total}.`)
      return
    }
    const saldo = result.tabela[n - 1].saldo_devedor
    if (v > saldo) {
      setErr(`Valor excede o saldo devedor após a parcela ${n} (${formatBRL(saldo)}).`)
      return
    }
    setErr("")
    setCalc(calcularAmortizacao(result, v, n, modalidade))
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Amortização Extraordinária</CardTitle>
        <p className="text-xs text-muted-foreground">
          Simule o efeito de um pagamento extra sobre o saldo devedor e veja quanto você economiza em juros.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Valor a amortizar (R$)">
            <input
              value={valorAmort}
              onChange={(e) => setValorAmort(e.target.value)}
              placeholder="10000"
              className={inputCls}
            />
          </Field>
          <Field label={`Após a parcela # (1–${result.parcelas_total})`}>
            <input
              value={aposParc}
              onChange={(e) => setAposParc(e.target.value)}
              type="number"
              min={1}
              max={result.parcelas_total}
              className={inputCls}
            />
          </Field>
          <Field label="Objetivo">
            <select
              value={modalidade}
              onChange={(e) => setModalidade(e.target.value as "prazo" | "parcela")}
              className={inputCls}
            >
              <option value="prazo">Reduzir prazo (manter parcela)</option>
              <option value="parcela">Reduzir parcela (manter prazo)</option>
            </select>
          </Field>
        </div>

        {err && <p className="text-xs text-destructive">{err}</p>}

        <Button variant="outline" onClick={calcular}>
          Calcular impacto
        </Button>

        {calc && (
          <div className="space-y-4 pt-1">
            {/* Economy highlight */}
            <div className="rounded-lg border border-green-500 bg-green-50 dark:bg-green-950/20 p-4 flex flex-wrap gap-6">
              <div>
                <p className="text-xs font-medium text-green-700 dark:text-green-400">Economia em juros</p>
                <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                  {formatBRL(calc.economia_juros)}
                </p>
              </div>
              {calc.meses_economizados !== null && (
                <div className="border-l border-green-300 dark:border-green-700 pl-6">
                  <p className="text-xs font-medium text-green-700 dark:text-green-400">Meses economizados</p>
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                    {calc.meses_economizados}
                  </p>
                </div>
              )}
              {calc.nova_prestacao !== null && (
                <div className="border-l border-green-300 dark:border-green-700 pl-6">
                  <p className="text-xs font-medium text-green-700 dark:text-green-400">Nova prestação</p>
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                    {formatBRL(calc.nova_prestacao)}
                  </p>
                </div>
              )}
            </div>

            {/* Side-by-side comparison */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border p-4 space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                  Sem amortização
                </p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total pago</span>
                    <span className="font-mono">{formatBRL(result.total_pago)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total em juros</span>
                    <span className="font-mono text-red-600">{formatBRL(result.total_juros)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Prazo total</span>
                    <span className="font-mono">{result.parcelas_total} meses</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-green-400 dark:border-green-700 p-4 space-y-2">
                <p className="text-xs font-semibold uppercase text-green-700 dark:text-green-400 tracking-wide">
                  Com amortização
                </p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total pago</span>
                    <span className="font-mono">{formatBRL(calc.total_pago_novo)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total em juros</span>
                    <span className="font-mono text-green-600">{formatBRL(calc.total_juros_novo)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Prazo total</span>
                    <span className="font-mono">{calc.parcelas_total_novo} meses</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Simulador({ embedded = false }: { embedded?: boolean }) {
  const [result, setResult] = useState<SimuladorResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: { sistema: "price", parcelas: 12 },
  })

  const { data: financiamentos } = useFinanciamentos(true)

  function preencherForm(f: FinanciamentoItem) {
    reset({
      valor: f.saldo_devedor,
      taxa_mensal: parseFloat((f.taxa_mensal * 100).toFixed(4)),
      parcelas: f.meses_restantes ?? 360,
      sistema: "price",
    })
    setResult(null)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function onSubmit(data: FormData) {
    setLoading(true)
    setApiError(null)
    try {
      setResult(await simular(data))
    } catch (e) {
      setApiError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const chartData = result?.tabela.map((p) => ({
    parcela: p.numero,
    Saldo: p.saldo_devedor,
    Juros: p.juros,
    Prestação: p.prestacao,
  }))

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold">Simulador de Dívida</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Calcule parcelas e juros totais pelos sistemas Price ou SAC.
          </p>
        </div>
      )}

      {financiamentos && financiamentos.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Meus financiamentos cadastrados
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {financiamentos.map((f) => (
              <Card key={f.id} className="border border-border">
                <CardContent className="pt-4 pb-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm leading-tight">{f.descricao}</p>
                      {f.banco && (
                        <p className="text-xs text-muted-foreground">{f.banco}</p>
                      )}
                    </div>
                    <span className="text-xs rounded-full px-2 py-0.5 bg-muted text-muted-foreground capitalize shrink-0">
                      {f.tipo}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div>
                      <span className="text-muted-foreground">Saldo devedor</span>
                      <p className="font-mono font-semibold">{formatBRL(f.saldo_devedor)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Parcela</span>
                      <p className="font-mono font-semibold">{formatBRL(f.parcela_mensal)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Taxa mensal</span>
                      <p className="font-mono">{(f.taxa_mensal * 100).toFixed(2)}%</p>
                    </div>
                    {f.meses_restantes !== null && (
                      <div>
                        <span className="text-muted-foreground">Meses restantes</span>
                        <p className="font-mono">{f.meses_restantes}</p>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-1"
                    onClick={() => preencherForm(f)}
                  >
                    Simular este financiamento
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Valor da dívida (R$)" error={errors.valor?.message}>
              <input {...register("valor")} placeholder="10000" className={inputCls} />
            </Field>
            <Field label="Taxa mensal (%)" error={errors.taxa_mensal?.message}>
              <input {...register("taxa_mensal")} placeholder="1.99" step="0.01" className={inputCls} />
            </Field>
            <Field label="Parcelas" error={errors.parcelas?.message}>
              <input {...register("parcelas")} type="number" placeholder="12" className={inputCls} />
            </Field>
            <Field label="Sistema" error={errors.sistema?.message}>
              <select {...register("sistema")} className={inputCls}>
                <option value="price">Price (parcela fixa)</option>
                <option value="sac">SAC (amortização fixa)</option>
              </select>
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" disabled={loading} className="w-full sm:w-auto">
                {loading ? "Calculando…" : "Simular"}
              </Button>
            </div>
          </form>
          {apiError && (
            <p className="mt-3 text-sm text-destructive">{apiError}</p>
          )}
        </CardContent>
      </Card>

      {result && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: "Prestação inicial", value: formatBRL(result.prestacao_inicial) },
              { label: result.sistema === "sac" ? "Prestação final" : "Prestação (fixa)", value: formatBRL(result.prestacao_final) },
              { label: "Total pago", value: formatBRL(result.total_pago) },
              { label: "Total em juros", value: formatBRL(result.total_juros) },
            ].map((k) => (
              <Card key={k.label} className="p-4">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-xl font-bold mt-1">{k.value}</p>
              </Card>
            ))}
          </div>

          {/* Gráfico */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Evolução da dívida</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="parcela" tick={{ fontSize: 11 }} label={{ value: "Parcela", position: "insideBottom", offset: -2, fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={44} />
                  <Tooltip formatter={(v) => formatBRL(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="Saldo" stroke="#3b82f6" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="Juros" stroke="#ef4444" dot={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="Prestação" stroke="#a855f7" dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Amortização extraordinária */}
          <AmortizacaoPanel result={result} />

          {/* Tabela (primeiras e últimas 6 parcelas, ou todas se ≤ 24) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tabela de amortização</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead className="text-right">Prestação</TableHead>
                    <TableHead className="text-right">Amortização</TableHead>
                    <TableHead className="text-right">Juros</TableHead>
                    <TableHead className="text-right">Saldo devedor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(result.tabela.length <= 24
                    ? result.tabela
                    : [...result.tabela.slice(0, 6), ...result.tabela.slice(-6)]
                  ).map((p, idx) => (
                    <>
                      {idx === 6 && result.tabela.length > 24 && (
                        <TableRow key="ellipsis">
                          <TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-2">
                            ··· {result.tabela.length - 12} parcelas omitidas ···
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow key={p.numero}>
                        <TableCell className="text-muted-foreground text-sm">{p.numero}</TableCell>
                        <TableCell className="text-right font-mono">{formatBRL(p.prestacao)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{formatBRL(p.amortizacao)}</TableCell>
                        <TableCell className="text-right font-mono text-red-600">{formatBRL(p.juros)}</TableCell>
                        <TableCell className="text-right font-mono">{formatBRL(p.saldo_devedor)}</TableCell>
                      </TableRow>
                    </>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
