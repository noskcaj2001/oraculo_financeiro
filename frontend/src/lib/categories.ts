// Espelho de backend/modules/personal_finance/categories.py (slugs).
// Fonte de verdade dos slugs é o backend; aqui ficam labels + cores da UI.
// O dropdown de correção usa GET /api/categorias (hook useCategorias), então
// novos slugs aparecem mesmo sem editar este arquivo — mas sem cor/label
// dedicada caem no fallback abaixo.

export const CATEGORY_LABELS: Record<string, string> = {
  supermercado: "Supermercado",
  restaurante_bar: "Restaurante e bar",
  delivery: "Delivery",
  transporte: "Transporte",
  combustivel: "Combustível",
  saude: "Saúde",
  academia_bemestar: "Academia e bem-estar",
  assinaturas: "Assinaturas",
  lazer: "Lazer",
  vestuario: "Vestuário",
  esporte: "Esporte",
  compras: "Compras",
  educacao: "Educação",
  moradia: "Moradia",
  viagem: "Viagem",
  servicos: "Serviços",
  pets: "Pets",
  outros: "Outros",
}

// Hex — usado em <Cell fill> (recharts) e estilos inline.
export const CATEGORY_COLORS: Record<string, string> = {
  supermercado: "#22c55e",
  restaurante_bar: "#f97316",
  delivery: "#f59e0b",
  transporte: "#3b82f6",
  combustivel: "#0ea5e9",
  saude: "#ef4444",
  academia_bemestar: "#84cc16",
  assinaturas: "#a855f7",
  lazer: "#d946ef",
  vestuario: "#ec4899",
  esporte: "#06b6d4",
  compras: "#f43f5e",
  educacao: "#eab308",
  moradia: "#10b981",
  viagem: "#14b8a6",
  servicos: "#64748b",
  pets: "#8b5cf6",
  outros: "#94a3b8",
}

// Classes Tailwind para badges/chips.
export const BADGE_COLORS: Record<string, string> = {
  supermercado: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  restaurante_bar: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  delivery: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  transporte: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  combustivel: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  saude: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  academia_bemestar: "bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300",
  assinaturas: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  lazer: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300",
  vestuario: "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300",
  esporte: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  compras: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  educacao: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  moradia: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  viagem: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  servicos: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  pets: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  outros: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
}

const FALLBACK_COLOR = "#94a3b8"
const FALLBACK_BADGE = "bg-muted text-muted-foreground"

export function catLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? slug
}

export function catColor(slug: string): string {
  return CATEGORY_COLORS[slug] ?? FALLBACK_COLOR
}

export function catBadge(slug: string): string {
  return BADGE_COLORS[slug] ?? FALLBACK_BADGE
}

// Ordem estável para selects quando não há /api/categorias.
export const CATEGORY_SLUGS = Object.keys(CATEGORY_LABELS)
