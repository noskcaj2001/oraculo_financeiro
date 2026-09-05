import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom"
import "./index.css"
import Dashboard from "@/pages/Dashboard"
import Metas from "@/pages/Metas"
import Simulador from "@/pages/Simulador"
import Planejar from "@/pages/Planejar"
import UploadFatura from "@/pages/UploadFatura"
import VisaoGeral from "@/pages/VisaoGeral"
import PatrimonioTotal from "@/pages/PatrimonioTotal"
import Panorama from "@/pages/Panorama"
import Investimentos from "@/pages/Investimentos"

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

function Nav() {
  const { pathname } = useLocation()
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("theme")
    return saved === null ? true : saved === "dark"
  })
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    localStorage.setItem("theme", dark ? "dark" : "light")
  }, [dark])

  const links = [
    {
      to: "/visao-geral",
      label: "Início",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      ),
    },
    {
      to: "/gastos",
      label: "Gastos",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
        </svg>
      ),
    },
    {
      to: "/investimentos",
      label: "Investimentos",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
        </svg>
      ),
    },
    {
      to: "/patrimonio-total",
      label: "Patrimônio",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
        </svg>
      ),
    },
    {
      to: "/panorama",
      label: "Panorama",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
        </svg>
      ),
    },
    {
      to: "/planejar",
      label: "Planejar",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
        </svg>
      ),
    },
  ]

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4">
        <div className="h-14 flex items-center gap-3">

          {/* Brand */}
          <Link to="/visao-geral" className="flex items-center gap-2 shrink-0 mr-3">
            <div className="w-7 h-7 rounded-lg bg-primary glow-primary flex items-center justify-center">
              <svg className="w-4 h-4 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="font-bold text-sm tracking-tight hidden sm:block">Oráculo</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-0.5 flex-1">
            {links.map((l) => {
              const isActive = pathname === "/" ? l.to === "/visao-geral" : pathname.startsWith(l.to)
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap font-medium ${
                    isActive
                      ? "bg-primary/12 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                >
                  {l.icon}
                  {l.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-t-full bg-primary" />
                  )}
                </Link>
              )
            })}
          </div>

          {/* Right actions */}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setDark((d) => !d)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-pointer"
              title={dark ? "Modo claro" : "Modo escuro"}
            >
              {dark ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
                </svg>
              )}
            </button>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen((o) => !o)}
              className="md:hidden p-2 rounded-lg text-muted-foreground hover:bg-muted/60 cursor-pointer"
            >
              {mobileOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {mobileOpen && (
          <div className="md:hidden border-t border-border py-2 space-y-0.5">
            {links.map((l) => {
              const isActive = pathname === "/" ? l.to === "/visao-geral" : pathname.startsWith(l.to)
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm mx-2 ${
                    isActive
                      ? "text-primary font-medium bg-primary/10 border-l-2 border-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                >
                  {l.icon}
                  {l.label}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </nav>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Nav />
        <Routes>
          <Route path="/" element={<Navigate to="/visao-geral" replace />} />
          {/* Rotas principais (6 itens da nav) */}
          <Route path="/visao-geral" element={<VisaoGeral />} />
          <Route path="/gastos" element={<Dashboard />} />
          <Route path="/investimentos" element={<Investimentos />} />
          <Route path="/patrimonio-total" element={<PatrimonioTotal />} />
          <Route path="/panorama" element={<Panorama />} />
          <Route path="/planejar" element={<Planejar />} />
          {/* Rotas diretas (ainda acessíveis por links internos) */}
          <Route path="/faturas" element={<UploadFatura />} />
          <Route path="/simulador" element={<Simulador />} />
          <Route path="/metas" element={<Metas />} />
          {/* Redireciona rotas antigas */}
          <Route path="/dashboard" element={<Navigate to="/gastos" replace />} />
          <Route path="/analise-integrada" element={<Navigate to="/panorama" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
