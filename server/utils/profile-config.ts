import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, parseDocument as parseYamlDocument, isMap, isScalar } from 'yaml'

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
  if (!existsSync(path)) {
    throw new Error(`Profile config not found at ${path}`)
  }
  const raw = readFileSync(path, 'utf8')
  const doc = parseYamlDocument(raw)

  if ('model' in patch || 'provider' in patch) {
    if (!doc.has('model')) doc.set('model', {})
    const modelNode = doc.get('model', true)
    if (!isMap(modelNode)) {
      throw new Error('model: section in config.yaml is not a mapping')
    }
    if ('model' in patch) {
      const v = patch.model
      if (v === null || v === undefined || v === '') {
        if (modelNode.has('default')) modelNode.delete('default')
      } else {
        modelNode.set('default', v)
      }
    }
    if ('provider' in patch) {
      const v = patch.provider
      if (v === null || v === undefined || v === '') {
        if (modelNode.has('provider')) modelNode.delete('provider')
      } else {
        modelNode.set('provider', v)
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
