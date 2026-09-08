import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'
export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', '.preview-dist/**', '.wrangler/**', 'artifacts/**', 'worker-configuration.d.ts', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      globals: Object.fromEntries(['console','process','Buffer','URL','URLSearchParams','fetch','Request','Response','Headers','WebSocket','WebSocketPair','WebSocketRequestResponsePair','TextEncoder','TextDecoder','crypto','setTimeout','clearTimeout','setInterval','clearInterval','AbortController','AbortSignal','location','innerWidth','innerHeight','scrollY','requestAnimationFrame','structuredClone','Blob','CompressionStream','DecompressionStream','ReadableStream','window','document','navigator','localStorage','matchMedia','performance','Event','CustomEvent','File','atob','btoa','caches','self'].map(k => [k, 'readonly'])),
    },
    rules: { '@typescript-eslint/no-explicit-any': 'error', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  { files: ['app/**/*.{ts,tsx}'], plugins: { 'react-hooks': hooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' } },
)
