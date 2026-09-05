import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// ── Schema ─────────────────────────────────────────────────────────────────

const schema = z.object({
  meta: z.coerce.number().positive("Obrigatório"),
  aporte_mensal: z.coerce.number().min(0, "Obrigatório"),
  taxa_anual: z.coerce.number().min(0).max(999),
  capital_inicial: z.coerce.number().min(0).default(0),
})

type FormData = z.infer<typeof schema>

// ── Types ──────────────────────────────────────────────────────────────────

interface PontoProjecao {
  mes: number
  patrimonio: number
  aportado: number
  rendimento: number
}

interface MetasResponse {
  meta: number
  taxa_anual: number
  taxa_mensal: number
  prazo_meses: number | null
  patrimonio_final: number
  total_aportado: number
  total_rendimento: number
  projecao: PontoProjecao[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function formatPrazo(meses: number | null): string {
  if (meses === null) return "Não atingida em 50 anos"
  const anos = Math.floor(meses / 12)
  const m = meses % 12
  if (anos === 0) return `${m} ${m === 1 ? "mês" : "meses"}`
  if (m === 0) return `${anos} ${anos === 1 ? "ano" : "anos"}`
  return `${anos}a ${m}m`
}

async function calcular(data: FormData): Promise<MetasResponse> {
  const res = await fetch("/api/metas/calcular", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? "Erro no cálculo")
  }
  return res.json() as Promise<MetasResponse>
}

// ── Field ──────────────────────────────────────────────────────────────────

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

const inputCls = "rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"

// ── Component ──────────────────────────────────────────────────────────────

export default function Metas({ embedded = false }: { embedded?: boolean }) {
  const [result, setResult] = useState<MetasResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: { taxa_anual: 12, capital_inicial: 0 },
  })

  async function onSubmit(data: FormData) {
    setLoading(true)
    setApiError(null)
    try {
      setResult(await calcular(data))
    } catch (e) {
      setApiError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const chartData = result?.projecao.map((p) => ({
    mes: p.mes,
    Patrimônio: p.patrimonio,
    Aportado: p.aportado,
    Rendimento: p.rendimento,
  }))

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold">Planejador de Metas</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Projete quanto tempo leva para atingir seu objetivo financeiro.
          </p>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Meta (R$)" error={errors.meta?.message}>
              <input {...register("meta")} placeholder="100000" className={inputCls} />
            </Field>
            <Field label="Aporte mensal (R$)" error={errors.aporte_mensal?.message}>
              <input {...register("aporte_mensal")} placeholder="500" className={inputCls} />
            </Field>
            <Field label="Rentabilidade anual (%)" error={errors.taxa_anual?.message}>
              <input {...register("taxa_anual")} placeholder="12" step="0.1" className={inputCls} />
            </Field>
            <Field label="Capital inicial (R$)" error={errors.capital_inicial?.message}>
              <input {...register("capital_inicial")} placeholder="0" className={inputCls} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" disabled={loading} className="w-full sm:w-auto">
                {loading ? "Calculando…" : "Calcular"}
              </Button>
            </div>
          </form>
          {apiError && <p className="mt-3 text-sm text-destructive">{apiError}</p>}
        </CardContent>
      </Card>

      {result && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: "Prazo estimado", value: formatPrazo(result.prazo_meses) },
              { label: "Patrimônio final", value: formatBRL(result.patrimonio_final) },
              { label: "Total aportado", value: formatBRL(result.total_aportado) },
              { label: "Total em rendimento", value: formatBRL(result.total_rendimento) },
            ].map((k) => (
              <Card key={k.label} className="p-4">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-xl font-bold mt-1 leading-tight">{k.value}</p>
              </Card>
            ))}
          </div>

          {/* Meta highlight */}
          {result.prazo_meses !== null && (
            <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900 px-4 py-3 text-sm text-green-800 dark:text-green-300">
              Com aportes de {formatBRL(result.total_aportado / (result.prazo_meses || 1))}/mês a {result.taxa_anual}% a.a.,
              você atinge {formatBRL(result.meta)} em{" "}
              <strong>{formatPrazo(result.prazo_meses)}</strong>.
            </div>
          )}

          {/* Gráfico de área */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Projeção de patrimônio</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                  <defs>
                    <linearGradient id="gradPatrimonio" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradAportado" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="mes"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => v % 12 === 0 ? `${v / 12}a` : ""}
                    label={{ value: "Meses", position: "insideBottom", offset: -2, fontSize: 11 }}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${(v / 1_000).toFixed(0)}k`}
                    width={52}
                  />
                  <Tooltip formatter={(v) => formatBRL(Number(v))} labelFormatter={(l) => `Mês ${l}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="Patrimônio" stroke="#3b82f6" fill="url(#gradPatrimonio)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="Aportado" stroke="#22c55e" fill="url(#gradAportado)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
