import { useRef, useState } from "react"
import { useChat, useQuotes, useSignals } from "@/api/b3"
import type { ChatResponse, Quote, Signal } from "@/api/b3"

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

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatVolume(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return String(v)
}

// ── Quotes section ─────────────────────────────────────────────────────────

function QuotesSection({ quotes, isLoading }: { quotes: Quote[] | undefined; isLoading: boolean }) {
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
              {(quotes ?? []).map((q) => (
                <TableRow key={q.ticker}>
                  <TableCell className="font-mono font-semibold text-sm">{q.ticker.replace(".SA", "")}</TableCell>
                  <TableCell className="text-right font-mono">R$ {formatBRL(q.price)}</TableCell>
                  <TableCell className={`text-right font-mono font-medium ${q.pct_change >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {q.pct_change >= 0 ? "+" : ""}{q.pct_change.toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm hidden sm:table-cell">
                    R$ {formatBRL(q.day_high)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm hidden sm:table-cell">
                    R$ {formatBRL(q.day_low)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm hidden md:table-cell">
                    {formatVolume(q.volume)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ── Signals section ────────────────────────────────────────────────────────

const SIGNAL_STYLE: Record<string, string> = {
  compra: "bg-green-100 text-green-800",
  neutro: "bg-yellow-100 text-yellow-800",
  venda: "bg-red-100 text-red-800",
}

const SIGNAL_LABEL: Record<string, string> = {
  compra: "Compra",
  neutro: "Neutro",
  venda: "Venda",
}

function SignalsSection({ signals, isLoading }: { signals: Signal[] | undefined; isLoading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Sinais ML</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground animate-pulse">Carregando sinais…</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Sinal</TableHead>
                <TableHead className="text-right">Confiança</TableHead>
                <TableHead className="hidden sm:table-cell">Data</TableHead>
                <TableHead className="hidden md:table-cell text-muted-foreground">Modelo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(signals ?? []).map((s) => (
                <TableRow key={s.ticker}>
                  <TableCell className="font-mono font-semibold text-sm">{s.ticker.replace(".SA", "")}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SIGNAL_STYLE[s.signal] ?? "bg-muted"}`}>
                      {SIGNAL_LABEL[s.signal] ?? s.signal}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden hidden sm:block">
                        <div
                          className={`h-full rounded-full ${s.signal === "compra" ? "bg-green-500" : s.signal === "venda" ? "bg-red-500" : "bg-yellow-500"}`}
                          style={{ width: `${Math.round(s.confidence * 100)}%` }}
                        />
                      </div>
                      <span className="font-mono text-sm">{Math.round(s.confidence * 100)}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm hidden sm:table-cell">{s.date}</TableCell>
                  <TableCell className="text-muted-foreground text-xs hidden md:table-cell">{s.model_version}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ── Chat section ───────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  meta?: Pick<ChatResponse, "latency_ms" | "tokens_used" | "classificacao">
}

const CLASSIFICACAO_STYLE: Record<string, string> = {
  PASS: "bg-green-100 text-green-700",
  BORDERLINE: "bg-yellow-100 text-yellow-700",
  HALLUCINATION: "bg-red-100 text-red-700",
}

function ChatSection() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [usePersonalCtx, setUsePersonalCtx] = useState(true)
  const { mutate, isPending } = useChat()
  const bottomRef = useRef<HTMLDivElement>(null)

  function sendMessage() {
    const q = input.trim()
    if (!q || isPending) return
    setInput("")
    setMessages((prev) => [...prev, { role: "user", content: q }])

    mutate(
      { question: q, top_k: 5, use_financial_context: usePersonalCtx },
      {
        onSuccess: (data) => {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: data.answer,
              meta: {
                latency_ms: data.latency_ms,
                tokens_used: data.tokens_used,
                classificacao: data.classificacao,
              },
            },
          ])
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
        },
        onError: (err) => {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Erro: ${(err as Error).message}` },
          ])
        },
      },
    )
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Chat RAG — Pergunte sobre B3</CardTitle>
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
              Faça uma pergunta sobre as ações da B3.
              <br />
              Ex: "Como está PETR4?" ou "Compare VALE3 e ITUB4"
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
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

        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); sendMessage() }}
        >
          <input
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

// ── Page ──────────────────────────────────────────────────────────────────

export default function B3() {
  const { data: quotes, isLoading: quotesLoading } = useQuotes()
  const { data: signals, isLoading: signalsLoading } = useSignals()

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">B3</h1>
        <p className="text-muted-foreground text-sm mt-1">Cotações, sinais de ML e análise via RAG</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <QuotesSection quotes={quotes} isLoading={quotesLoading} />
        <SignalsSection signals={signals} isLoading={signalsLoading} />
      </div>

      <ChatSection />
    </div>
  )
}
