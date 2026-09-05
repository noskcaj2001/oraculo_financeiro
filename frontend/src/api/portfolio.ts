import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { PortfolioSnapshot, PortfolioSummary } from "@/types"

async function fetchSnapshots(): Promise<PortfolioSnapshot[]> {
  const res = await fetch("/api/portfolio/snapshots")
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail?: string }).detail ?? "Erro ao carregar snapshots")
  }
  return res.json() as Promise<PortfolioSnapshot[]>
}

async function fetchSummary(mes?: string): Promise<PortfolioSummary | null> {
  const url = mes ? `/api/portfolio/summary?mes=${mes}` : "/api/portfolio/summary"
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail?: string }).detail ?? "Erro ao carregar portfólio")
  }
  return res.json() as Promise<PortfolioSummary | null>
}

async function uploadPortfolio(file: File) {
  const form = new FormData()
  form.append("file", file)
  const res = await fetch("/api/portfolio/upload", { method: "POST", body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail?: string }).detail ?? "Erro no upload")
  }
  return res.json()
}

async function deleteSnapshot(id: string): Promise<void> {
  const res = await fetch(`/api/portfolio/${id}`, { method: "DELETE" })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail?: string }).detail ?? "Erro ao excluir snapshot")
  }
}

export function usePortfolioSnapshots() {
  return useQuery({
    queryKey: ["portfolio-snapshots"],
    queryFn: fetchSnapshots,
    staleTime: 60_000,
  })
}

export function usePortfolioSummary(mes?: string) {
  return useQuery({
    queryKey: ["portfolio-summary", mes ?? "latest"],
    queryFn: () => fetchSummary(mes),
    staleTime: 60_000,
  })
}

export function useUploadPortfolio() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: uploadPortfolio,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-snapshots"] })
      qc.invalidateQueries({ queryKey: ["portfolio-summary"] })
    },
  })
}

export function useDeleteSnapshot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteSnapshot,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-snapshots"] })
      qc.invalidateQueries({ queryKey: ["portfolio-summary"] })
    },
  })
}
