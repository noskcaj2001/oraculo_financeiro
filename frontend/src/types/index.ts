// ── Faturas ────────────────────────────────────────────────────────────────

export interface Transaction {
  data: string
  descricao: string
  valor: number
  categoria: string
  estabelecimento: string
  parcela_atual: number
  total_parcelas: number
}

export interface CategorySummary {
  categoria: string
  total: number
  quantidade: number
}

export interface UploadResponse {
  invoice_id: string
  filename: string
  total_transactions: number
  transactions: Transaction[]
  resumo_por_categoria: CategorySummary[]
  total_fatura: number | null
  total_extraido: number | null
  validacao_total: boolean | null
}

// ── Portfólio ──────────────────────────────────────────────────────────────

export interface PortfolioSnapshot {
  id: string
  mes: string
  filename: string | null
  total_acoes: number
  total_etf: number
  total_fii: number
  total_tesouro: number
  total_portfolio: number
  total_proventos: number
  uploaded_at: string
}

export interface PortfolioPosition {
  id: string
  snapshot_id: string
  tipo_ativo: string
  ticker: string
  nome: string
  tipo_papel: string
  quantidade: number | null
  preco_fechamento: number | null
  valor_aplicado: number | null
  valor_atualizado: number | null
  vencimento: string | null
}

export interface PortfolioDividend {
  id: string
  snapshot_id: string
  ticker: string
  pagamento: string | null
  tipo_evento: string
  quantidade: number | null
  preco_unit: number | null
  valor_liquido: number | null
}

export interface PortfolioSummary {
  mes: string
  filename: string | null
  total_acoes: number
  total_etf: number
  total_fii: number
  total_tesouro: number
  total_portfolio: number
  total_proventos: number
  uploaded_at: string | null
  posicoes: PortfolioPosition[]
  proventos: PortfolioDividend[]
}

// ── Renda ──────────────────────────────────────────────────────────────────

export interface RendaItem {
  id: string
  mes: string
  tipo: string
  descricao: string
  valor: number
  created_at: string
}

export interface RendaResumo {
  mes: string
  total_renda: number
  total_gastos: number
  saldo: number
  taxa_poupanca: number
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export interface TransactionItem {
  id: string
  data: string
  descricao: string
  estabelecimento: string
  categoria: string
  valor: number
  parcela_atual: number
  total_parcelas: number
  estorno: boolean
  invoice_id: string
}

export interface DashboardSummary {
  mes: string
  total_gasto: number
  total_estornos: number
  total_liquido: number
  total_fixos: number
  total_pontuais: number
  total_saidas: number
  total_transacoes: number
  por_categoria: CategorySummary[]
  transacoes: TransactionItem[]
}
