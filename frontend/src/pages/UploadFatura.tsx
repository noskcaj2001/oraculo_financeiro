import { useCallback, useState } from "react"
import { Link } from "react-router-dom"
import { useUploadFatura } from "@/api/faturas"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { UploadResponse } from "@/types"
import { catLabel, catBadge } from "@/lib/categories"

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function formatDate(iso: string) {
  if (!iso) return "—"
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

function DropZone({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file?.type === "application/pdf") onFile(file)
    },
    [onFile],
  )

  return (
    <label
      className={`flex flex-col items-center justify-center w-full min-h-52 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 ${
        dragging
          ? "border-primary bg-primary/5 ring-4 ring-primary/20 scale-[1.01]"
          : "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/30"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
      <div className="flex flex-col items-center gap-3 text-muted-foreground px-6 py-8 text-center">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
          dragging ? "bg-primary/10" : "bg-muted"
        }`}>
          <svg className={`w-7 h-7 transition-colors ${dragging ? "text-primary" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Arraste o PDF da fatura aqui</p>
          <p className="text-xs mt-1">ou clique para selecionar</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs bg-muted px-2 py-0.5 rounded-full font-medium">PDF</span>
          <span className="text-xs text-muted-foreground">Tamanho máximo: 10 MB</span>
        </div>
      </div>
    </label>
  )
}

function ResumoCards({ data }: { data: UploadResponse }) {
  const total = data.resumo_por_categoria.reduce((s, c) => s + c.total, 0)

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {data.resumo_por_categoria.map((cat) => (
        <Card key={cat.categoria} className="p-3">
          <p className={`text-xs font-semibold px-2 py-0.5 rounded-full inline-block mb-2 ${catBadge(cat.categoria)}`}>
            {catLabel(cat.categoria)}
          </p>
          <p className="text-lg font-bold tabular-nums">{formatBRL(cat.total)}</p>
          <Progress value={(cat.total / total) * 100} className="h-1 mt-1.5" />
          <p className="text-xs text-muted-foreground mt-1">{cat.quantidade} transações</p>
        </Card>
      ))}
    </div>
  )
}

function TransactionSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <svg className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar estabelecimento…"
        className="pl-8 pr-7 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring w-52"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

export default function UploadFatura() {
  const { mutate, isPending, data, error, reset } = useUploadFatura()
  const [txSearch, setTxSearch] = useState("")

  function handleFile(file: File) {
    reset()
    setTxSearch("")
    mutate(file)
  }

  const filteredTransactions = data
    ? txSearch.trim()
      ? data.transactions.filter((t) =>
          (t.estabelecimento || t.descricao).toLowerCase().includes(txSearch.toLowerCase()),
        )
      : data.transactions
    : []

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Upload de Fatura</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Envie o PDF da sua fatura de cartão para extrair e categorizar as transações.
        </p>
      </div>

      <DropZone onFile={handleFile} />

      {isPending && (
        <div className="flex items-center gap-3 text-muted-foreground text-sm animate-pulse">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v8z" />
          </svg>
          Extraindo transações com IA…
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Success banner */}
          <div className="rounded-xl bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/50 px-5 py-4">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                    Fatura processada com sucesso
                  </p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-green-700 dark:text-green-400">
                      <span className="font-medium">{data.filename}</span>
                    </span>
                    <span className="text-xs text-green-600 dark:text-green-500">·</span>
                    <span className="text-xs text-green-700 dark:text-green-400">
                      Total: <span className="font-semibold tabular-nums">{formatBRL(data.total_extraido ?? 0)}</span>
                    </span>
                    <span className="text-xs text-green-600 dark:text-green-500">·</span>
                    <span className="text-xs text-green-700 dark:text-green-400">
                      {data.total_transactions} transações
                    </span>
                  </div>
                </div>
              </div>
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-1.5 text-sm text-primary font-medium hover:underline shrink-0"
              >
                Analisar no Dashboard
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </div>
          </div>

          {/* Validation banners */}
          {data.validacao_total === true && (
            <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 px-4 py-3 text-sm text-green-800 dark:text-green-300 flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <span>
                Validação OK — total extraído{" "}
                <strong>{formatBRL(data.total_extraido!)}</strong> bate com o total da fatura{" "}
                <strong>{formatBRL(data.total_fatura!)}</strong>
              </span>
            </div>
          )}

          {data.validacao_total === false && (
            <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800/40 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300 flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
              <span>
                Divergência detectada — total extraído{" "}
                <strong>{formatBRL(data.total_extraido!)}</strong> vs total da fatura{" "}
                <strong>{formatBRL(data.total_fatura!)}</strong>
                {" "}(diferença:{" "}
                {formatBRL(Math.abs(data.total_extraido! - data.total_fatura!))})
              </span>
            </div>
          )}

          {/* Category summary */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Resumo por categoria
            </h2>
            <ResumoCards data={data} />
          </div>

          {/* Transactions table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base">Transações</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {filteredTransactions.length === data.transactions.length
                      ? `${data.transactions.length} transações`
                      : `${filteredTransactions.length} de ${data.transactions.length} transações`}
                  </p>
                </div>
                <TransactionSearch value={txSearch} onChange={setTxSearch} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Estabelecimento</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Parcela</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-10">
                        Nenhuma transação encontrada
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTransactions.map((t, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(t.data)}
                        </TableCell>
                        <TableCell className="font-medium">{t.estabelecimento || t.descricao}</TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catBadge(t.categoria)}`}>
                            {catLabel(t.categoria)}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {t.total_parcelas > 1 ? `${t.parcela_atual}/${t.total_parcelas}` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatBRL(t.valor)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
