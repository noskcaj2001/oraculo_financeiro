import { useMutation } from "@tanstack/react-query"
import type { UploadResponse } from "@/types"

async function uploadFatura(file: File): Promise<UploadResponse> {
  const form = new FormData()
  form.append("file", file)

  const res = await fetch("/api/faturas/upload", { method: "POST", body: form })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? "Erro ao processar fatura")
  }

  return res.json() as Promise<UploadResponse>
}

export function useUploadFatura() {
  return useMutation({ mutationFn: uploadFatura })
}
