import { useMutation, useQuery } from "@tanstack/react-query"

// ── Types ─────────────────────────────────────────────────────────────────

export interface Quote {
  ticker: string
  price: number
  prev_close: number
  pct_change: number
  volume: number
  day_high: number
  day_low: number
  currency: string
  cached: boolean
}

export interface ContextDoc {
  ticker: string | null
  period: string | null
  text: string | null
  score: number | null
  doc_type: string | null
}

export interface ChatResponse {
  answer: string
  context_docs: ContextDoc[]
  latency_ms: number
  tokens_used: number
  trace_id: string | null
  classificacao: string | null
}

export interface Signal {
  ticker: string
  date: string
  signal: "compra" | "neutro" | "venda"
  confidence: number
  model_version: string
}

// ── Fetchers ──────────────────────────────────────────────────────────────

async function fetchQuotes(): Promise<Quote[]> {
  const res = await fetch("/api/b3/quotes")
  if (!res.ok) throw new Error("Erro ao buscar cotações")
  return res.json() as Promise<Quote[]>
}

async function fetchSignals(ticker?: string): Promise<Signal[]> {
  const url = ticker ? `/api/b3/signals?ticker=${ticker}` : "/api/b3/signals"
  const res = await fetch(url)
  if (!res.ok) throw new Error("Erro ao buscar sinais")
  return res.json() as Promise<Signal[]>
}

async function postChat(body: {
  question: string
  ticker_filter?: string
  top_k?: number
  use_financial_context?: boolean
}): Promise<ChatResponse> {
  const res = await fetch("/api/b3/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? "Erro no chat RAG")
  }
  return res.json() as Promise<ChatResponse>
}

// ── Hooks ─────────────────────────────────────────────────────────────────

export function useQuotes() {
  return useQuery({
    queryKey: ["b3", "quotes"],
    queryFn: fetchQuotes,
    refetchInterval: 60_000,
    staleTime: 55_000,
  })
}

export function useSignals(ticker?: string) {
  return useQuery({
    queryKey: ["b3", "signals", ticker ?? "all"],
    queryFn: () => fetchSignals(ticker),
    staleTime: 300_000,
  })
}

export function useChat() {
  return useMutation({ mutationFn: postChat })
}
