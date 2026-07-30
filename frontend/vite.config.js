import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/gestor-reportes/',
  build: {
    outDir: '../public/gestor-reportes',
    emptyOutDir: true
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/extraer-rut': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/extraer-camara': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
