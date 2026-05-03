import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parse as parseYaml } from 'yaml'

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

interface HermesConfig {
  model?: {
    default?: string
    provider?: string
    base_url?: string
  }
  providers?: Record<string, {
    base_url?: string
    models?: unknown
    default?: string
  }>
}

const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')
const CATALOG_PATH = join(HERMES_HOME, 'cache', 'model_catalog.json')
const CONFIG_PATH = join(HERMES_HOME, 'config.yaml')

let cached: { catalogMtimeMs: number, configMtimeMs: number, payload: ModelCatalogResponse } | null = null

function loadCatalog(): Catalog | null {
  if (!existsSync(CATALOG_PATH)) return null
  try {
    return JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as Catalog
  } catch {
    return null
  }
}

function loadHermesConfig(): HermesConfig | null {
  if (!existsSync(CONFIG_PATH)) return null
  try {
    return parseYaml(readFileSync(CONFIG_PATH, 'utf8')) as HermesConfig
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

/* Pulls model ids out of a `providers.<name>.models` value. The Hermes config
   schema accepts either a list of strings or a list of `{ id, ... }` objects,
   plus the occasional plain object keyed by id. Be defensive — this is user
   YAML and we should never crash the picker over a stray shape. */
function extractModelIds(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    const out: string[] = []
    for (const entry of raw) {
      if (typeof entry === 'string') out.push(entry)
      else if (entry && typeof entry === 'object' && 'id' in entry && typeof (entry as { id: unknown }).id === 'string') {
        out.push((entry as { id: string }).id)
      }
    }
    return out
  }
  if (typeof raw === 'object') return Object.keys(raw as Record<string, unknown>)
  return []
}

function build(catalog: Catalog | null, config: HermesConfig | null): ModelCatalogResponse {
  const providers: ModelCatalogResponse['providers'] = []
  const seen = new Set<string>()
  const models: ModelOption[] = []
  const modelKey = (m: { id: string, provider: string }) => `${m.provider}::${m.id}`
  const modelKeys = new Set<string>()

  for (const [pid, body] of Object.entries(catalog?.providers ?? {})) {
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
      const opt: ModelOption = {
        id: m.id,
        provider: pid,
        description: m.description ?? '',
        recommended: desc.includes('recommended'),
        free: desc.includes('free')
      }
      models.push(opt)
      modelKeys.add(modelKey(opt))
    }
  }

  /* Local-config overrides — surface custom/self-hosted models the user has
     declared in `~/.hermes/config.yaml` so they show up in the picker even
     when the upstream catalog knows nothing about them. */
  const configModels: ModelOption[] = []
  const ensureProvider = (id: string, label?: string) => {
    if (!seen.has(id)) {
      providers.push({ id, label: label ?? FALLBACK_PROVIDERS[id] ?? id, count: 0 })
      seen.add(id)
    }
  }

  if (config?.model?.default && config.model.provider) {
    const pid = config.model.provider
    ensureProvider(pid)
    const opt: ModelOption = {
      id: config.model.default,
      provider: pid,
      description: 'configured default',
      recommended: false,
      free: false
    }
    if (!modelKeys.has(modelKey(opt))) {
      configModels.push(opt)
      modelKeys.add(modelKey(opt))
    }
  }

  for (const [pid, body] of Object.entries(config?.providers ?? {})) {
    if (!body || typeof body !== 'object') continue
    ensureProvider(pid)
    const ids = extractModelIds(body.models)
    if (body.default && !ids.includes(body.default)) ids.unshift(body.default)
    for (const id of ids) {
      const opt: ModelOption = {
        id,
        provider: pid,
        description: 'configured',
        recommended: false,
        free: false
      }
      if (!modelKeys.has(modelKey(opt))) {
        configModels.push(opt)
        modelKeys.add(modelKey(opt))
      }
    }
  }

  /* Bump provider counts for everything we just injected from config. */
  for (const m of configModels) {
    const p = providers.find(p => p.id === m.provider)
    if (p) p.count += 1
  }
  models.push(...configModels)

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
    updatedAt: catalog?.updated_at ?? null,
    providers,
    models
  }
}

export default defineEventHandler((): ModelCatalogResponse => {
  const catalogMtimeMs = existsSync(CATALOG_PATH) ? statSync(CATALOG_PATH).mtimeMs : 0
  const configMtimeMs = existsSync(CONFIG_PATH) ? statSync(CONFIG_PATH).mtimeMs : 0

  if (!catalogMtimeMs && !configMtimeMs) {
    return { updatedAt: null, providers: [], models: [] }
  }

  if (cached && cached.catalogMtimeMs === catalogMtimeMs && cached.configMtimeMs === configMtimeMs) {
    return cached.payload
  }

  const catalog = loadCatalog()
  const config = loadHermesConfig()

  const payload = build(catalog, config)
  cached = { catalogMtimeMs, configMtimeMs, payload }
  return payload
})
