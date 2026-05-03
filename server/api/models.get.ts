import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

interface CatalogModel {
  id: string
  description?: string
}
interface CatalogProvider {
  metadata?: { display_name?: string, note?: string }
  models?: CatalogModel[]
}
interface Catalog {
  version?: number
  updated_at?: string
  providers?: Record<string, CatalogProvider>
}

interface ModelOption {
  id: string
  provider: string
  description: string
  recommended: boolean
  free: boolean
}

interface ModelCatalogResponse {
  updatedAt: string | null
  providers: { id: string, label: string, count: number }[]
  models: ModelOption[]
}

const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')
const CATALOG_PATH = join(HERMES_HOME, 'cache', 'model_catalog.json')

let cached: { mtimeMs: number, payload: ModelCatalogResponse } | null = null

function loadCatalog(): Catalog | null {
  if (!existsSync(CATALOG_PATH)) return null
  try {
    return JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as Catalog
  } catch {
    return null
  }
}

/* Common providers users might want even when not in the dynamic catalog. */
const FALLBACK_PROVIDERS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  custom: 'Custom (base_url)'
}

function build(catalog: Catalog): ModelCatalogResponse {
  const providers: ModelCatalogResponse['providers'] = []
  const seen = new Set<string>()
  const models: ModelOption[] = []

  for (const [pid, body] of Object.entries(catalog.providers ?? {})) {
    const list = Array.isArray(body?.models) ? body.models : []
    providers.push({
      id: pid,
      label: body?.metadata?.display_name ?? pid,
      count: list.length
    })
    seen.add(pid)
    for (const m of list) {
      if (!m?.id) continue
      const desc = (m.description ?? '').toLowerCase()
      models.push({
        id: m.id,
        provider: pid,
        description: m.description ?? '',
        recommended: desc.includes('recommended'),
        free: desc.includes('free')
      })
    }
  }

  for (const [pid, label] of Object.entries(FALLBACK_PROVIDERS)) {
    if (!seen.has(pid)) {
      providers.push({ id: pid, label, count: 0 })
    }
  }

  models.sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
    return a.id.localeCompare(b.id)
  })

  return {
    updatedAt: catalog.updated_at ?? null,
    providers,
    models
  }
}

export default defineEventHandler((): ModelCatalogResponse => {
  if (!existsSync(CATALOG_PATH)) {
    return { updatedAt: null, providers: [], models: [] }
  }
  const mtimeMs = statSync(CATALOG_PATH).mtimeMs
  if (cached && cached.mtimeMs === mtimeMs) return cached.payload

  const catalog = loadCatalog()
  if (!catalog) return { updatedAt: null, providers: [], models: [] }

  const payload = build(catalog)
  cached = { mtimeMs, payload }
  return payload
})
