import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CATEGORY_SLUGS, catLabel } from "@/lib/categories"

export interface CategoriaItem {
  slug: string
  label: string
}

async function fetchCategorias(): Promise<CategoriaItem[]> {
  const res = await fetch("/api/categorias")
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<CategoriaItem[]>
}

/** Lista de categorias (slug + label) do backend, com fallback local. */
export function useCategorias() {
  return useQuery({
    queryKey: ["categorias"],
    queryFn: fetchCategorias,
    staleTime: 60 * 60_000,
    placeholderData: CATEGORY_SLUGS.map((slug) => ({ slug, label: catLabel(slug) })),
  })
}

async function patchCategoria(id: string, categoria: string) {
  const res = await fetch(`/api/transactions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ categoria }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? "Erro ao atualizar categoria")
  }
  return res.json()
}

/** Corrige a categoria de uma transação; a regra fica salva para o estabelecimento. */
export function usePatchTransactionCategoria() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, categoria }: { id: string; categoria: string }) =>
      patchCategoria(id, categoria),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] })
      qc.invalidateQueries({ queryKey: ["analise-integrada"] })
    },
  })
}
