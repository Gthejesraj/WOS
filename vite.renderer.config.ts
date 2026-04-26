import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    // The renderer only owns `src/**`. Ignoring main/preload + Swift build
    // artifacts prevents an infinite HMR reload loop when Swift/Forge re-stamp
    // JSON files inside the repo.
    watch: {
      ignored: [
        '**/electron/**',
        '**/.vite/**',
        '**/.build/**',
        '**/dist/**',
        '**/out/**',
        '**/node_modules/**',
        '**/resources/**',
      ],
    },
  },
})
