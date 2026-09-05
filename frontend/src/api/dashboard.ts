import { useQuery } from "@tanstack/react-query"
import type { DashboardSummary } from "@/types"

async function fetchSummary(mes?: string): Promise<DashboardSummary> {
  const url = mes ? `/api/dashboard/summary?mes=${mes}` : "/api/dashboard/summary"
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? "Erro ao carregar dashboard")
  }
  return res.json() as Promise<DashboardSummary>
}

export function useDashboardSummary(mes?: string) {
  return useQuery({
    queryKey: ["dashboard", mes ?? "current"],
    queryFn: () => fetchSummary(mes),
    staleTime: 60_000,
  })
}
