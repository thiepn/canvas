import { spawn } from 'node:child_process'
const children = []
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
let stopping = false
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code }
for (const script of ['dev:worker', 'dev:web']) {
  const child = spawn(npm, ['run', script], { stdio: 'inherit', shell: process.platform === 'win32' })
  children.push(child)
  child.on('error', error => { console.error(error.message); stop(1) })
  child.on('exit', code => stop(code || 0))
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop())
