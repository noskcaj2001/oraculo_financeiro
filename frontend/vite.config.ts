import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true, // expõe na rede local (acesso pelo celular no mesmo Wi-Fi)
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
})
