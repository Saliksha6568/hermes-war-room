import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, parseDocument as parseYamlDocument, isMap, isScalar } from 'yaml'
import type { YAMLMap } from 'yaml'

export interface ProfileConfigSlice {
  /** model.default — the model string Hermes resolves through its model registry. */
  model: string | null
  /** model.provider — the inference provider (anthropic, openai, custom, etc.). */
  provider: string | null
  /** command_allowlist — list of dangerous-pattern descriptions pre-approved without prompting. */
  allowlist: string[]
}

function configPath(profileDir: string): string {
  return join(profileDir, 'config.yaml')
}

export function readProfileConfig(profileDir: string): ProfileConfigSlice {
  const path = configPath(profileDir)
  if (!existsSync(path)) return { model: null, provider: null, allowlist: [] }
  try {
    const raw = readFileSync(path, 'utf8')
    const cfg = parseYaml(raw) as {
      model?: { default?: unknown, provider?: unknown }
      command_allowlist?: unknown
    } | null
    const modelDefault = cfg?.model?.default
    const provider = cfg?.model?.provider
    const list = Array.isArray(cfg?.command_allowlist) ? cfg.command_allowlist : []
    return {
      model: typeof modelDefault === 'string' ? modelDefault : null,
      provider: typeof provider === 'string' ? provider : null,
      allowlist: list.filter((v): v is string => typeof v === 'string')
    }
  } catch {
    return { model: null, provider: null, allowlist: [] }
  }
}

export interface ProfileConfigPatch {
  model?: string | null
  provider?: string | null
  allowlist?: string[]
}

/**
 * Atomically patch select fields of a profile's config.yaml. Uses the YAML
 * Document API so we preserve comments and the rest of the file untouched.
 */
export function writeProfileConfig(profileDir: string, patch: ProfileConfigPatch): void {
  const path = configPath(profileDir)
  /* Fresh hires (hermes profile create without --clone) ship without a
     config.yaml. Start from an empty document so the first patch creates
     the file rather than failing. */
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const doc = parseYamlDocument(raw)

  if ('model' in patch || 'provider' in patch) {
    /* If `model:` exists but is a scalar/sequence (malformed user config),
       refuse to silently overwrite. Otherwise rely on setIn/deleteIn —
       they create the intermediate map for fresh/empty documents and
       leave existing maps intact, which avoids the brittle "create empty
       object then re-fetch as YAMLMap" dance. */
    const existing = doc.get('model', true) as YAMLMap | undefined | null
    if (existing != null && !isMap(existing)) {
      throw new Error('model: section in config.yaml is not a mapping')
    }
    if ('model' in patch) {
      const v = patch.model
      if (v === null || v === undefined || v === '') {
        if (doc.hasIn(['model', 'default'])) doc.deleteIn(['model', 'default'])
      } else {
        doc.setIn(['model', 'default'], v)
      }
    }
    if ('provider' in patch) {
      const v = patch.provider
      if (v === null || v === undefined || v === '') {
        if (doc.hasIn(['model', 'provider'])) doc.deleteIn(['model', 'provider'])
      } else {
        doc.setIn(['model', 'provider'], v)
      }
    }
  }

  if (Array.isArray(patch.allowlist)) {
    const cleaned = [...new Set(patch.allowlist.filter(s => typeof s === 'string' && s.trim() !== ''))]
    doc.set('command_allowlist', cleaned)
  }

  // Defensive: if the resulting `command_allowlist` came out as something
  // other than a sequence (e.g. preserved scalar from an oddly-formatted
  // file), normalise it.
  const al = doc.get('command_allowlist', true)
  if (al && !Array.isArray((al as { items?: unknown[] }).items) && isScalar(al)) {
    doc.set('command_allowlist', [])
  }

  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, doc.toString(), { mode: 0o600 })
    renameSync(tmp, path)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch { /* ignore */ }
    throw e
  }
}
