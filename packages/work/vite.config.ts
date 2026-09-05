import { fileURLToPath } from "url"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({
  plugins: [tailwindcss(), solid()] as any,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3001,
  },
  build: {
    target: "esnext",
  },
})
