import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

// ── Types ──────────────────────────────────────────────────────────────────

export interface FluxoCaixa {
  renda_total: number
  gastos_fixos_total: number
  fatura_cartao: number
  gastos_pontuais_total: number
  saldo_disponivel: number
  taxa_comprometimento: number
  taxa_poupanca: number
}

export interface AlertaSchema {
  tipo: string
  severidade: "info" | "warn" | "danger"
  titulo: string
  descricao: string
  acao_sugerida: string
}

export interface MesHistorico {
  mes: string
  total_renda: number
  total_cartao: number
  total_fixos: number
  total_pontuais: number
  saldo: number
  taxa_poupanca: number
  taxa_comprometimento: number
  portfolio_b3: number
  ativos_fisicos: number
  total_financiamentos: number
  patrimonio_liquido: number
}

export interface PatrimonioLiquido {
  portfolio_b3: number
  ativos_fisicos: number
  total_ativos: number
  total_financiamentos: number
  patrimonio_liquido: number
}

export interface Projecao {
  anos: number
  patrimonio_projetado: number
  aporte_mensal: number
  taxa_retorno_anual: number
}

export interface AIInsight {
  categoria: "fluxo_caixa" | "investimentos" | "patrimonio" | "acao"
  titulo: string
  texto: string
  prioridade: 1 | 2 | 3
}

export interface SinalRelevante {
  ticker: string
  date: string
  signal: "compra" | "neutro" | "venda"
  confidence: number
  model_version: string
  valor_posicao: number | null
}

export interface AnaliseIntegradaResponse {
  mes: string
  fluxo_caixa: FluxoCaixa
  patrimonio: PatrimonioLiquido
  projecoes: Projecao[]
  sinais_relevantes: SinalRelevante[]
  alertas: AlertaSchema[]
  insights_ai: AIInsight[]
  gerado_em: string
  latency_ms: number
}

// Gastos Fixos
export interface GastoFixoItem {
  id: string
  descricao: string
  categoria: string
  valor: number
  ativo: boolean
  created_at: string
}

export interface GastoFixoCreate {
  descricao: string
  categoria: string
  valor: number
  ativo?: boolean
}

// Gastos Pontuais
export interface GastoPontualItem {
  id: string
  mes: string
  descricao: string
  categoria: string
  valor: number
  created_at: string
}

export interface GastoPontualCreate {
  mes: string
  descricao: string
  categoria?: string
  valor: number
}

// Financiamentos
export interface FinanciamentoItem {
  id: string
  descricao: string
  tipo: "imovel" | "veiculo" | "outro"
  banco: string | null
  valor_total: number
  saldo_devedor: number
  taxa_mensal: number
  parcela_mensal: number
  data_inicio: string | null
  vencimento_estimado: string | null
  ativo: boolean
  meses_restantes: number | null
  created_at: string
}

export interface FinanciamentoCreate {
  descricao: string
  tipo: "imovel" | "veiculo" | "outro"
  banco?: string
  valor_total: number
  saldo_devedor: number
  taxa_mensal: number
  parcela_mensal: number
  data_inicio?: string
  vencimento_estimado?: string
  ativo?: boolean
}

// Patrimônios Físicos
export interface PatrimonioFisicoItem {
  id: string
  tipo: "carro" | "imovel" | "outro"
  descricao: string
  marca: string | null
  modelo: string | null
  ano_modelo: number | null
  ano_fabricacao: number | null
  placa: string | null
  fipe_codigo: string | null
  fipe_params: Record<string, unknown> | null
  valor_fipe: number | null
  valor_manual: number | null
  fipe_updated_at: string | null
  valor_efetivo: number
  created_at: string
}

export interface PatrimonioFisicoCreate {
  tipo: "carro" | "imovel" | "outro"
  descricao: string
  marca?: string
  modelo?: string
  ano_modelo?: number
  ano_fabricacao?: number
  placa?: string
  fipe_codigo?: string
  fipe_params?: Record<string, unknown>
  valor_manual?: number
}

// FIPE
export interface FipeMarca {
  Value: number
  Label: string
}

export interface FipeModelo {
  Value: number
  Label: string
}

export interface FipeAno {
  Value: string
  Label: string
}

export interface FipeValor {
  valor_str: string
  valor_float: number
  fipe_codigo: string
  marca: string
  modelo: string
  ano_modelo: number
  combustivel: string
  fipe_params: Record<string, unknown>
}

// ── Fetch helpers ──────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const resp = await fetch(path)
  if (!resp.ok) throw new Error(await resp.text())
  return resp.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(await resp.text())
  return resp.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(await resp.text())
  return resp.json()
}

async function del(path: string): Promise<void> {
  const resp = await fetch(path, { method: "DELETE" })
  if (!resp.ok) throw new Error(await resp.text())
}

async function patch<T>(path: string): Promise<T> {
  const resp = await fetch(path, { method: "PATCH" })
  if (!resp.ok) throw new Error(await resp.text())
  return resp.json()
}

// ── Hooks: Análise Integrada ───────────────────────────────────────────────

export function useAnaliseIntegrada(mes?: string) {
  const params = mes ? `?mes=${mes}` : ""
  return useQuery<AnaliseIntegradaResponse>({
    queryKey: ["analise-integrada", mes ?? "current"],
    queryFn: () => get(`/api/analise-integrada/resumo${params}`),
    staleTime: 120_000,
    gcTime: 300_000,
    retry: 1,
  })
}

export function useHistorico(meses = 12) {
  return useQuery<MesHistorico[]>({
    queryKey: ["analise-historico", meses],
    queryFn: () => get(`/api/analise-integrada/historico?meses=${meses}`),
    staleTime: 300_000,
  })
}

export function useAlertas(mes?: string) {
  const params = mes ? `?mes=${mes}` : ""
  return useQuery<AlertaSchema[]>({
    queryKey: ["analise-alertas", mes ?? "current"],
    queryFn: () => get(`/api/analise-integrada/alertas${params}`),
    staleTime: 60_000,
  })
}

export interface RelatorioResponse {
  mes: string
  relatorio: string
  gerado_em: string
  latency_ms: number
}

export function useRelatorio(mes?: string, enabled = false) {
  const params = mes ? `?mes=${mes}` : ""
  return useQuery<RelatorioResponse>({
    queryKey: ["analise-relatorio", mes ?? "current"],
    queryFn: () => get(`/api/analise-integrada/relatorio${params}`),
    enabled,
    staleTime: 600_000,
    gcTime: 1_200_000,
    retry: 1,
  })
}

export function useMarcarAlertaLido() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (alertId: string) => patch<{ ok: boolean }>(`/api/analise-integrada/alertas/${alertId}/lido`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analise-alertas"] }),
  })
}

// ── Hooks: Gastos Fixos ───────────────────────────────────────────────────

export function useGastosFixos(ativo?: boolean) {
  const params = ativo !== undefined ? `?ativo=${ativo}` : ""
  return useQuery<GastoFixoItem[]>({
    queryKey: ["gastos-fixos", ativo],
    queryFn: () => get(`/api/gastos-fixos${params}`),
    staleTime: 30_000,
  })
}

export function useCreateGastoFixo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: GastoFixoCreate) => post<GastoFixoItem>("/api/gastos-fixos", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gastos-fixos"] })
      qc.invalidateQueries({ queryKey: ["dashboard"] })
    },
  })
}

export function useUpdateGastoFixo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<GastoFixoCreate> & { id: string }) =>
      put<GastoFixoItem>(`/api/gastos-fixos/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gastos-fixos"] })
      qc.invalidateQueries({ queryKey: ["analise-integrada"] })
      qc.invalidateQueries({ queryKey: ["dashboard"] })
    },
  })
}

export function useDeleteGastoFixo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`/api/gastos-fixos/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gastos-fixos"] })
      qc.invalidateQueries({ queryKey: ["analise-integrada"] })
      qc.invalidateQueries({ queryKey: ["dashboard"] })
    },
  })
}

// ── Hooks: Gastos Pontuais ────────────────────────────────────────────────

export function useGastosPontuais(mes?: string) {
  const params = mes ? `?mes=${mes}` : ""
  return useQuery<GastoPontualItem[]>({
    queryKey: ["gastos-pontuais", mes],
    queryFn: () => get(`/api/gastos-pontuais${params}`),
    staleTime: 30_000,
  })
}

export function useCreateGastoPontual() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: GastoPontualCreate) => post<GastoPontualItem>("/api/gastos-pontuais", body),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["gastos-pontuais", data.mes] })
      qc.invalidateQueries({ queryKey: ["analise-integrada"] })
      qc.invalidateQueries({ queryKey: ["dashboard"] })
    },
  })
}

export function useDeleteGastoPontual() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`/api/gastos-pontuais/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gastos-pontuais"] })
      qc.invalidateQueries({ queryKey: ["analise-integrada"] })
      qc.invalidateQueries({ queryKey: ["dashboard"] })
    },
  })
}

// ── Hooks: Financiamentos ─────────────────────────────────────────────────

export function useFinanciamentos(ativo?: boolean) {
  const params = ativo !== undefined ? `?ativo=${ativo}` : ""
  return useQuery<FinanciamentoItem[]>({
    queryKey: ["financiamentos", ativo],
    queryFn: () => get(`/api/financiamentos${params}`),
    staleTime: 60_000,
  })
}

export function useCreateFinanciamento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: FinanciamentoCreate) => post<FinanciamentoItem>("/api/financiamentos", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financiamentos"] })
      qc.invalidateQueries({ queryKey: ["analise-integrada"] })
    },
  })
}

export function useUpdateFinanciamento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<FinanciamentoCreate> & { id: string }) =>
      put<FinanciamentoItem>(`/api/financiamentos/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financiamentos"] })
      qc.invalidateQueries({ queryKey: ["analise-integrada"] })
    },
  })
}

export function useDeleteFinanciamento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`/api/financiamentos/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financiamentos"] })
      qc.invalidateQueries({ queryKey: ["analise-integrada"] })
    },
  })
}

// ── Hooks: Patrimônios Físicos ────────────────────────────────────────────

export function usePatrimoniosFisicos() {
  return useQuery<PatrimonioFisicoItem[]>({
    queryKey: ["patrimonios-fisicos"],
    queryFn: () => get("/api/patrimonio-fisico"),
    staleTime: 60_000,
  })
}

export function useCreatePatrimonioFisico() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PatrimonioFisicoCreate) => post<PatrimonioFisicoItem>("/api/patrimonio-fisico", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patrimonios-fisicos"] })
      qc.invalidateQueries({ queryKey: ["analise-integrada"] })
    },
  })
}

export function useUpdatePatrimonioFisico() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<PatrimonioFisicoCreate> & { id: string }) =>
      put<PatrimonioFisicoItem>(`/api/patrimonio-fisico/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patrimonios-fisicos"] })
      qc.invalidateQueries({ queryKey: ["analise-integrada"] })
    },
  })
}

export function useDeletePatrimonioFisico() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`/api/patrimonio-fisico/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patrimonios-fisicos"] })
      qc.invalidateQueries({ queryKey: ["analise-integrada"] })
    },
  })
}

export function useRefreshFipe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => get<PatrimonioFisicoItem>(`/api/patrimonio-fisico/${id}/refresh-fipe`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patrimonios-fisicos"] })
      qc.invalidateQueries({ queryKey: ["analise-integrada"] })
    },
  })
}

// ── Hooks: FIPE wizard ────────────────────────────────────────────────────

export function useFipeMarcas() {
  return useQuery<FipeMarca[]>({
    queryKey: ["fipe-marcas"],
    queryFn: () => get("/api/patrimonio-fisico/fipe/marcas"),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  })
}

export function useFipeModelos(marcaId: number | null) {
  return useQuery<{ tabela_ref: number; modelos: FipeModelo[] }>({
    queryKey: ["fipe-modelos", marcaId],
    queryFn: () => get(`/api/patrimonio-fisico/fipe/modelos/${marcaId}`),
    enabled: marcaId !== null,
    staleTime: 24 * 60 * 60 * 1000,
  })
}

export function useFipeAnos(marcaId: number | null, modeloId: number | null, tabelaRef?: number) {
  return useQuery<FipeAno[]>({
    queryKey: ["fipe-anos", marcaId, modeloId],
    queryFn: () =>
      get(`/api/patrimonio-fisico/fipe/anos/${marcaId}/${modeloId}${tabelaRef ? `?tabela_ref=${tabelaRef}` : ""}`),
    enabled: marcaId !== null && modeloId !== null,
    staleTime: 24 * 60 * 60 * 1000,
  })
}

export function useFipeValor(
  marcaId: number | null,
  modeloId: number | null,
  anoId: string | null,
  tabelaRef?: number,
) {
  return useQuery<FipeValor>({
    queryKey: ["fipe-valor", marcaId, modeloId, anoId],
    queryFn: () =>
      get(
        `/api/patrimonio-fisico/fipe/valor/${marcaId}/${modeloId}/${anoId}${tabelaRef ? `?tabela_ref=${tabelaRef}` : ""}`,
      ),
    enabled: marcaId !== null && modeloId !== null && anoId !== null,
    staleTime: 24 * 60 * 60 * 1000,
  })
}
