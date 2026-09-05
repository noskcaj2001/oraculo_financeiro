import { useQuery } from "@tanstack/react-query"

async function get<T>(path: string): Promise<T> {
  const resp = await fetch(path)
  if (!resp.ok) throw new Error(await resp.text())
  return resp.json()
}

export interface AtivoFisicoResumo {
  id: string
  tipo: "carro" | "imovel" | "outro"
  descricao: string
  valor_efetivo: number
  valor_aquisicao: number | null
  depreciacao_pct: number | null
  fipe_updated_at: string | null
}

export interface FinanciamentoResumo {
  id: string
  descricao: string
  tipo: "imovel" | "veiculo" | "outro"
  banco: string | null
  valor_total: number
  saldo_devedor: number
  parcela_mensal: number
  taxa_mensal: number
  meses_restantes: number | null
  equity_pct: number
  parcela_sobre_renda_pct: number | null
}

export interface PatrimonioTotalResponse {
  gerado_em: string
  portfolio_b3: number
  total_ativos_fisicos: number
  total_ativos: number
  total_passivos: number
  patrimonio_liquido: number
  comprometimento_financiamento_pct: number | null
  ativos_fisicos: AtivoFisicoResumo[]
  financiamentos: FinanciamentoResumo[]
  renda_media_3m: number
}

export interface AssetHistoryPoint {
  data_consulta: string
  valor: number
  fonte: string
}

export function usePatrimonioTotal() {
  return useQuery<PatrimonioTotalResponse>({
    queryKey: ["patrimonio-total"],
    queryFn: () => get("/api/patrimonio-total/resumo"),
    staleTime: 60_000,
    retry: 1,
  })
}

export function useAssetHistory(assetId: string | null) {
  return useQuery<AssetHistoryPoint[]>({
    queryKey: ["asset-history", assetId],
    queryFn: () => get(`/api/patrimonio-fisico/${assetId}/historico`),
    enabled: assetId !== null,
    staleTime: 300_000,
  })
}
