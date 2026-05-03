import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, parseDocument as parseYamlDocument } from 'yaml'

export type McpTransport = 'http' | 'stdio' | 'unknown'

export interface McpServer {
  name: string
  transport: McpTransport
  /** url for http, command line for stdio (truncated for display). */
  endpoint: string
  /** Per-server tool filter (e.g. "all" or a list). */
  tools?: unknown
  /** Connection headers / env vars (count, not values, for the UI). */
  headerCount: number
}

interface RawMcpEntry {
  url?: string
  command?: string
  args?: unknown
  tools?: unknown
  headers?: Record<string, unknown>
  env?: Record<string, unknown>
}

function profileConfigPath(profileDir: string): string {
  return join(profileDir, 'config.yaml')
}

function readMcpMap(profileDir: string): Record<string, RawMcpEntry> | null {
  const cfgPath = profileConfigPath(profileDir)
  if (!existsSync(cfgPath)) return null
  try {
    const raw = readFileSync(cfgPath, 'utf8')
    const cfg = parseYaml(raw) as { mcp_servers?: Record<string, RawMcpEntry> } | null
    return cfg?.mcp_servers ?? {}
  } catch {
    return null
  }
}

export function listMcpServers(profileDir: string): McpServer[] {
  const map = readMcpMap(profileDir)
  if (!map) return []
  const out: McpServer[] = []
  for (const [name, entry] of Object.entries(map)) {
    if (!entry || typeof entry !== 'object') continue
    let transport: McpTransport = 'unknown'
    let endpoint = ''
    if (typeof entry.url === 'string' && entry.url) {
      transport = 'http'
      endpoint = entry.url
    } else if (typeof entry.command === 'string' && entry.command) {
      transport = 'stdio'
      const args = Array.isArray(entry.args) ? entry.args.join(' ') : ''
      endpoint = args ? `${entry.command} ${args}` : entry.command
    }
    out.push({
      name,
      transport,
      endpoint,
      tools: entry.tools,
      headerCount: entry.headers && typeof entry.headers === 'object' ? Object.keys(entry.headers).length : 0
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function removeMcpServer(profileDir: string, name: string): boolean {
  const cfgPath = profileConfigPath(profileDir)
  if (!existsSync(cfgPath)) {
    throw new Error(`Profile config not found at ${cfgPath}`)
  }
  const raw = readFileSync(cfgPath, 'utf8')
  const doc = parseYamlDocument(raw)
  if (!doc.has('mcp_servers')) return false
  const node = doc.getIn(['mcp_servers', name])
  if (node === undefined) return false
  doc.deleteIn(['mcp_servers', name])

  const tmp = `${cfgPath}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, doc.toString(), { mode: 0o600 })
    renameSync(tmp, cfgPath)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch { /* ignore */ }
    throw e
  }
  return true
}
