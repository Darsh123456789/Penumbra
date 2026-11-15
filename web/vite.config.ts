import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built site works at any path (GitHub Pages serves it under /<repo>/)
export default defineConfig({ plugins: [react()], base: './' })
