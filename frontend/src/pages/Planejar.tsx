import { useState } from "react"
import Simulador from "./Simulador"
import Metas from "./Metas"

type Tab = "simulador" | "metas"

export default function Planejar() {
  const [tab, setTab] = useState<Tab>("simulador")

  return (
    <div>
      {/* Header + tabs */}
      <div className="border-b border-border bg-background sticky top-14 z-10">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex items-center justify-between pt-6 pb-3 gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold">Planejar</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Simule cenários e defina metas</p>
            </div>
          </div>
          <div className="flex gap-0.5">
            {(
              [
                {
                  key: "simulador",
                  label: "Simulador",
                  icon: (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                        d="M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V13.5Zm0 2.25h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V18Zm2.498-6.75h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V13.5Zm0 2.25h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V18Zm2.504-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5Zm0 2.25h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V18Zm2.498-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5ZM8.25 6h7.5v2.25h-7.5V6ZM12 2.25c-1.892 0-3.758.11-5.593.322C5.307 2.7 4.5 3.65 4.5 4.757V19.5a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V4.757c0-1.108-.806-2.057-1.907-2.185A48.507 48.507 0 0 0 12 2.25Z" />
                    </svg>
                  ),
                },
                {
                  key: "metas",
                  label: "Metas",
                  icon: (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                        d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
                    </svg>
                  ),
                },
              ] as { key: Tab; label: string; icon: React.ReactNode }[]
            ).map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                  tab === key
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {icon}
                {label}
                {tab === key && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-primary" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Conteúdo da aba */}
      <div>
        {tab === "simulador" ? <Simulador embedded /> : <Metas embedded />}
      </div>
    </div>
  )
}
