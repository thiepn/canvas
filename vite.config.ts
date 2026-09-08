import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function normalizeBuildBasePath(value: string): string {
  if (!value.startsWith('/') || /[?#\\]/.test(value) || value.split('/').includes('..')) {
    throw new Error('VITE_BASE_PATH must be an absolute URL path, for example /canvas/ or /.')
  }
  return value.endsWith('/') ? value : `${value}/`
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    base: normalizeBuildBasePath(env.VITE_BASE_PATH || '/canvas/'),
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    build: { outDir: env.CANVAS_BUILD_DIR || 'dist', target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1800 },
  }
})
