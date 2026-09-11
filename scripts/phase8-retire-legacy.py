from pathlib import Path
import json, re, shutil

root = Path('.')
if not (root / 'worker' / 'CanvasRoom.ts').exists():
    raise SystemExit('Legacy runtime missing; refusing duplicate migration.')

def write(path, text):
    p = root / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8')

def remove(path):
    p = root / path
    if p.is_dir(): shutil.rmtree(p)
    elif p.exists(): p.unlink()

for path in [
    '.dev.vars.example', 'wrangler.jsonc', 'wrangler.test.jsonc', 'tsconfig.worker.json',
    'worker', 'shared', 'tests/worker',
    'app/canvas/CanvasEditor.tsx', 'app/canvas/Toolbar.tsx', 'app/canvas/clipboard-policy.ts',
    'app/canvas/content.ts', 'app/canvas/editor-ui.tsx', 'app/canvas/test-bridge.ts',
    'app/components/Header.tsx', 'app/storage/export.ts', 'scripts/admin.mjs', 'playwright.config.ts',
    'tests/e2e/collaboration.spec.ts', 'tests/e2e/helpers.ts', 'tests/e2e/interaction.spec.ts', 'tests/e2e/tool-matrix.spec.ts',
    'tests/unit/backup-sqlite.test.ts', 'tests/unit/fixtures.ts', 'tests/unit/policy.test.ts', 'tests/unit/security.test.ts',
    'RESEARCH.md', 'docs/evidence', 'docs/verification.json',
]: remove(path)

write('app/main.tsx', """import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { installCanvasWheelZoom } from './canvas/wheel-zoom.ts'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { createLiveConfig } from './config/public-config.ts'
import { DiagnosticsOverlay } from './diagnostics/DiagnosticsOverlay.tsx'
import { canvasDiagnostics, diagnosticsRequested, exposeDiagnostics } from './diagnostics/metrics.ts'
import { installDiagnosticsRuntime } from './diagnostics/runtime.ts'
import './styles/app.css'
import './styles/diagnostics.css'

const usePerformanceFixture = import.meta.env.MODE === 'performance' && new URLSearchParams(location.search).get('fixture') === '1'
const diagnosticsEnabled = diagnosticsRequested(location.search, import.meta.env.MODE)
if (diagnosticsEnabled) {
  canvasDiagnostics.enable()
  exposeDiagnostics()
  const removeDiagnosticsRuntime = installDiagnosticsRuntime()
  import.meta.hot?.dispose(removeDiagnosticsRuntime)
}
const SupabaseCanvasEditor = lazy(() => import('./canvas/SupabaseCanvasEditor.tsx'))
const PerformanceHarness = usePerformanceFixture ? lazy(() => import('./diagnostics/PerformanceHarness.tsx').then(module => ({ default: module.PerformanceHarness }))) : null
const removeWheelZoom = installCanvasWheelZoom()
import.meta.hot?.dispose(removeWheelZoom)

function Loading() {
  return <main className=\"boot\" role=\"status\"><span>Canvas<span aria-hidden=\"true\">.</span></span><p>Opening the shared canvas…</p></main>
}
function App() {
  if (!globalThis.crypto?.randomUUID || !('WebSocket' in window)) throw new Error('Use a current Chrome, Edge, Firefox, or Safari browser over HTTPS.')
  if (usePerformanceFixture && PerformanceHarness) return <><Suspense fallback={<Loading />}><PerformanceHarness /></Suspense>{diagnosticsEnabled && <DiagnosticsOverlay />}</>
  const config = createLiveConfig(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, import.meta.env.VITE_CANVAS_TABLE)
  return <><Suspense fallback={<Loading />}><SupabaseCanvasEditor config={config} /></Suspense>{diagnosticsEnabled && <DiagnosticsOverlay />}</>
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {}) })
}
""")

config = (root / 'app/config/public-config.ts').read_text()
config = config.replace("export interface PublicConfig { apiUrl: string; websocketUrl: string; licenseKey?: string }\n", '')
config = re.sub(r"\nexport function isLocalHostname[\s\S]*?\nexport function createLiveConfig", "\nexport function createLiveConfig", config, count=1)
if 'createPublicConfig' in config or 'isLocalHostname' in config: raise SystemExit('Public config cleanup failed.')
write('app/config/public-config.ts', config)

write('tests/unit/identity-config.test.ts', """import test from 'node:test'
import assert from 'node:assert/strict'
import { loadIdentity, cleanName, colorForId, IDENTITY_KEY, saveIdentity } from '../../app/presence/identity.ts'
import { loadTheme } from '../../app/storage/preferences.ts'
import { createLiveConfig, DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL, normalizeBasePath } from '../../app/config/public-config.ts'
function memory() { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) } } }
const id = 'ec4145a1-f218-416e-bdb5-a5f79a5f03c0'
test('anonymous identity persists locally and color is deterministic', () => { const storage = memory(), first = loadIdentity(storage, () => id); assert.equal(first.deviceId, id); assert.match(first.displayName, /^Guest \\d{4}$/); assert.deepEqual(loadIdentity(storage, () => { throw new Error('Must reuse ID') }), first); assert.equal(first.color, colorForId(id)) })
test('corrupt local identity safely regenerates, without a login flow', () => { const storage = memory(); storage.setItem(IDENTITY_KEY, '{broken'); assert.equal(loadIdentity(storage, () => id).deviceId, id) })
test('names are bounded and sanitized, not authenticated', () => { assert.equal(cleanName('\\n Jonathan\\u0000 '), 'Jonathan'); assert.equal(cleanName('a'.repeat(100)).length, 32); assert.equal(cleanName('  '), 'Guest') })
test('unavailable browser storage does not prevent use', () => { const storage = { getItem: () => { throw new Error('disabled') }, setItem: () => { throw new Error('disabled') } }; const identity = loadIdentity(storage, () => id); assert.equal(identity.deviceId, id); assert.equal(saveIdentity(storage, identity), false) })
test('theme preference defaults to system and rejects malformed values', () => { const storage = memory(); assert.equal(loadTheme(storage), 'system'); storage.setItem('canvas.theme.v1', 'dark'); assert.equal(loadTheme(storage), 'dark'); storage.setItem('canvas.theme.v1', 'anything'); assert.equal(loadTheme(storage), 'system') })
test('live config uses public Supabase defaults and permits only the CI table override', () => { assert.deepEqual(createLiveConfig(undefined, undefined), { supabaseUrl: DEFAULT_SUPABASE_URL, supabaseKey: DEFAULT_SUPABASE_PUBLISHABLE_KEY, tableName: 'canvas_elements' }); assert.equal(createLiveConfig(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, 'canvas_ci_elements').tableName, 'canvas_ci_elements') })
test('live config rejects unsafe origins, invalid keys and unknown tables', () => { for (const url of ['http://example.com', 'not a URL', 'https://a:b@example.com', 'https://example.com/api', 'https://example.com?key=x']) assert.throws(() => createLiveConfig(url, 'public-key')); assert.throws(() => createLiveConfig('https://example.com', '')); assert.throws(() => createLiveConfig('https://example.com', 'x'.repeat(513))); assert.throws(() => createLiveConfig('https://example.com', 'public-key', 'other')) })
test('Pages base path supports repository and custom-domain roots', () => { assert.equal(normalizeBasePath('/canvas'), '/canvas/'); assert.equal(normalizeBasePath('/'), '/'); for (const path of ['canvas', '/a/../b', '/a?b', '/a#b', '/a\\\\b']) assert.throws(() => normalizeBasePath(path)) })
""")

write('tsconfig.json', json.dumps({'compilerOptions': {'target':'ES2022','lib':['ES2022','DOM','DOM.Iterable'],'module':'ESNext','moduleResolution':'Bundler','allowImportingTsExtensions':True,'resolveJsonModule':True,'verbatimModuleSyntax':True,'isolatedModules':True,'jsx':'react-jsx','strict':True,'noUnusedLocals':True,'noUnusedParameters':True,'noFallthroughCasesInSwitch':True,'skipLibCheck':True,'noEmit':True,'types':['vite/client','node']},'include':['app','vite.config.ts','playwright.live.config.ts','playwright.performance.config.ts','playwright.production.config.ts','tests/unit','tests/live','tests/performance','tests/e2e/production.spec.ts']}, indent=2) + '\n')

pkg = json.loads((root / 'package.json').read_text())
for key in ['legacy:worker:dev','typegen','test:worker','test:e2e','legacy:worker:deploy','check:worker','legacy:worker:admin']: pkg['scripts'].pop(key, None)
pkg['scripts']['typecheck'] = 'tsc -p tsconfig.json'
pkg['scripts']['audit:architecture'] = 'node scripts/audit-architecture.mjs'
pkg['scripts']['check'] = 'npm run audit:architecture && npm run lint && npm run typecheck && npm test && npm run build && npm run test:live && npm run test:production'
for dep in ['@tldraw/assets','@tldraw/sync','@tldraw/sync-core','@tldraw/tlschema','tldraw']: pkg['dependencies'].pop(dep, None)
pkg['devDependencies'].pop('wrangler', None)
pkg.get('overrides', {}).pop('sharp', None)
write('package.json', json.dumps(pkg, indent=2) + '\n')

write('scripts/audit-architecture.mjs', """import { existsSync, readFileSync } from 'node:fs'
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
for (const name of ['tldraw', '@tldraw/assets', '@tldraw/sync', '@tldraw/sync-core', '@tldraw/tlschema', 'wrangler']) if (manifest.dependencies?.[name] || manifest.devDependencies?.[name]) throw new Error(`Retired dependency returned: ${name}`)
for (const path of Object.keys(lock.packages ?? {})) if (path === 'node_modules/tldraw' || path.startsWith('node_modules/@tldraw/') || path === 'node_modules/wrangler' || path === 'node_modules/miniflare') throw new Error(`Retired package remains in lockfile: ${path}`)
for (const path of ['worker', 'wrangler.jsonc', 'wrangler.test.jsonc', 'tsconfig.worker.json', 'app/canvas/CanvasEditor.tsx']) if (existsSync(path)) throw new Error(`Retired runtime file returned: ${path}`)
console.log('Production-only architecture audit passed.')
""")

ci = (root / '.github/workflows/ci.yml').read_text()
ci = ci.replace("env:\n  WRANGLER_SEND_METRICS: 'false'\n", '').replace('      - run: npm run test:worker\n      - run: npm run check:worker\n', '').replace("      - run: npm run test:e2e\n        env:\n          HOME: /root\n", '')
needle = '      - name: Reject high-severity dependency vulnerabilities\n        run: npm audit --audit-level=high\n'
if needle not in ci: raise SystemExit('CI audit anchor changed.')
ci = ci.replace(needle, needle + '      - run: npm run audit:architecture\n')
write('.github/workflows/ci.yml', ci)

env = (root / '.env.example').read_text()
write('.env.example', re.sub(r"\n# Legacy Worker/tldraw values[\s\S]*$", "\n", env))
release = (root / 'scripts/release-verify.mjs').read_text()
write('scripts/release-verify.mjs', re.sub(r"\nif \(process\.env\.VITE_CANVAS_TEST_BACKEND\?\.trim\(\)\) \{[\s\S]*?\n\}\n", "\n", release, count=1))

css = (root / 'app/styles/app.css').read_text().splitlines()
if len(css) < 17 or '.tl-container' not in css[5]: raise SystemExit('Unexpected app.css layout.')
css[5] = '.canvas-workspace{position:relative;flex:1;min-height:0;min-width:0;touch-action:none;overflow:hidden}'
css[7] = css[7].replace('.canvas-workspace .tlui-layout__bottom{padding-bottom:max(5px,env(safe-area-inset-bottom))}', '')
css[8] = '@media(max-width:700px){.canvas-header{gap:4px;padding-left:max(12px,env(safe-area-inset-left));padding-right:max(6px,env(safe-area-inset-right))}.canvas-header h1{font-size:21px;margin-right:7px}.identity-name{display:none}.people-peek{display:none}.identity-trigger{gap:7px}.empty-hint{bottom:160px;white-space:normal;width:max-content;max-width:calc(100% - 36px);font-size:11px}.canvas-notice{bottom:170px}.fit-button,.frame-button{display:none}.connection{font-size:11px;gap:5px}}'
css[9] = '@media(max-height:500px){.canvas-header{flex-basis:46px}.empty-hint{display:none}.canvas-notice{bottom:65px}}'
css[12] = '@media(max-height:500px) and (max-width:520px){.canvas-notice{bottom:115px}}'
css[14] = '.menu-tools-heading{margin-top:20px}.menu-control-row{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:7px}.menu-control-row button{display:flex;align-items:center;justify-content:center;gap:7px;background:transparent;border:1px solid var(--line);border-radius:3px;min-height:44px;min-width:0;padding:7px 5px;font-size:12px}'
css[16] = '/* Production Excalidraw + Supabase surface. */'
write('app/styles/app.css', '\n'.join(css) + '\n')

print('Phase 8 production-only transform complete.')
