import { spawn } from 'node:child_process'

interface DispatchResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

function runHermes(args: string[]): Promise<{ code: number, stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('hermes', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: string) => stdout += d)
    child.stderr.on('data', (d: string) => stderr += d)
    child.on('error', reject)
    child.on('close', (code: number | null) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

export default defineEventHandler(async (): Promise<DispatchResult> => {
  const res = await runHermes(['kanban', 'dispatch', '--json']).catch((e: Error) => ({
    code: -1, stdout: '', stderr: e.message
  }))
  return {
    ok: res.code === 0,
    code: res.code,
    stdout: res.stdout,
    stderr: res.stderr
  }
})
