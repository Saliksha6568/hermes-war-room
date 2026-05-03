import { spawn } from 'node:child_process'

export interface ToolEntry {
  name: string
  label: string
  enabled: boolean
}

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function runHermes(args: string[]): Promise<RunResult> {
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

// `hermes tools list --platform cli` emits a "Built-in toolsets" section
// followed by an MCP servers section. We parse just the built-in lines:
//   "  ✓ enabled  web  🔍 Web Search & Scraping"
//   "  ✗ disabled  moa  🧠 Mixture of Agents"
// Strip ANSI escapes first since the output may include color codes.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g
const TOOL_LINE_RE = /^\s*(✓|✗)\s+(enabled|disabled)\s+(\S+)\s+(.+?)\s*$/

export async function listTools(profileSlug?: string): Promise<ToolEntry[]> {
  const args: string[] = []
  if (profileSlug) args.push('-p', profileSlug)
  args.push('tools', 'list', '--platform', 'cli')

  const { code, stdout, stderr } = await runHermes(args)
  if (code !== 0) {
    throw new Error(stderr.trim() || `hermes tools list exited ${code}`)
  }

  const out: ToolEntry[] = []
  let inBuiltins = false
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(ANSI_RE, '')
    if (line.startsWith('Built-in toolsets')) {
      inBuiltins = true
      continue
    }
    if (inBuiltins && (line.startsWith('MCP servers') || line.trim() === '')) {
      // Section ends on a blank line or the MCP servers header.
      if (line.startsWith('MCP servers')) break
      // A blank line within the section also ends it (defensive).
      if (out.length > 0) break
      continue
    }
    if (!inBuiltins) continue
    const m = line.match(TOOL_LINE_RE)
    if (m) {
      out.push({
        name: m[3]!,
        label: m[4]!.trim(),
        enabled: m[2] === 'enabled'
      })
    }
  }

  return out
}

export async function applyToolState(
  profileSlug: string,
  toEnable: string[],
  toDisable: string[]
): Promise<void> {
  for (const [verb, names] of [['enable', toEnable], ['disable', toDisable]] as const) {
    if (names.length === 0) continue
    const args = ['-p', profileSlug, 'tools', verb, '--platform', 'cli', ...names]
    const { code, stderr } = await runHermes(args)
    if (code !== 0) {
      throw new Error(stderr.trim() || `hermes tools ${verb} exited ${code}`)
    }
  }
}
