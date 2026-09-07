import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // <-- Agregado para que los assets carguen bien en la subcarpeta /gym
  server: {
    host: true,
    allowedHosts: true,
  },
})