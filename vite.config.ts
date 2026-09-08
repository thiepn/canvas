import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { normalizeBasePath } from './app/config/public-config.ts'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    base: normalizeBasePath(env.VITE_BASE_PATH || '/Canvas/'),
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    build: { outDir: env.CANVAS_BUILD_DIR || 'dist', target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1800 },
  }
})
