import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { RendaItem, RendaResumo } from "@/types"

async function fetchRenda(mes: string): Promise<RendaItem[]> {
  const res = await fetch(`/api/renda?mes=${mes}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail?: string }).detail ?? "Erro ao carregar renda")
  }
  return res.json() as Promise<RendaItem[]>
}

async function fetchRendaResumo(mes: string): Promise<RendaResumo> {
  const res = await fetch(`/api/renda/resumo?mes=${mes}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail?: string }).detail ?? "Erro ao carregar resumo de renda")
  }
  return res.json() as Promise<RendaResumo>
}

async function createRenda(data: {
  mes: string
  tipo: string
  descricao: string
  valor: number
}): Promise<RendaItem> {
  const res = await fetch("/api/renda", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail?: string }).detail ?? "Erro ao criar entrada de renda")
  }
  return res.json() as Promise<RendaItem>
}

async function deleteRenda(id: string): Promise<void> {
  const res = await fetch(`/api/renda/${id}`, { method: "DELETE" })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail?: string }).detail ?? "Erro ao excluir entrada")
  }
}

export function useRenda(mes: string) {
  return useQuery({
    queryKey: ["renda", mes],
    queryFn: () => fetchRenda(mes),
    staleTime: 60_000,
  })
}

export function useRendaResumo(mes: string) {
  return useQuery({
    queryKey: ["renda-resumo", mes],
    queryFn: () => fetchRendaResumo(mes),
    staleTime: 60_000,
  })
}

export function useCreateRenda() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createRenda,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["renda"] })
    },
  })
}

export function useDeleteRenda() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteRenda,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["renda"] })
    },
  })
}
