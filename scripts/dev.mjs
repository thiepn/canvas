import { spawn } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const child = spawn(npm, ['run', 'dev:web'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

let stopping = false
function stop(signal) {
  if (stopping) return
  stopping = true
  if (signal && child.exitCode === null) child.kill(signal)
}

child.on('error', error => {
  console.error(error.message)
  process.exitCode = 1
})
child.on('exit', code => {
  process.exitCode = code ?? 1
})
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
