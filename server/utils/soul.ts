import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SOUL_FILENAME = 'SOUL.md'
// 64 KiB cap — SOUL.md is meant to be a short identity doc, not a wiki.
const SOUL_MAX_BYTES = 64 * 1024

function soulPath(profileDir: string): string {
  return join(profileDir, SOUL_FILENAME)
}

export function readSoul(profileDir: string): string {
  const path = soulPath(profileDir)
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8')
}

export function writeSoul(profileDir: string, contents: string): void {
  if (Buffer.byteLength(contents, 'utf8') > SOUL_MAX_BYTES) {
    throw new Error(`SOUL.md too large (max ${SOUL_MAX_BYTES} bytes)`)
  }
  const path = soulPath(profileDir)
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, contents, { mode: 0o600 })
    renameSync(tmp, path)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch { /* ignore */ }
    throw e
  }
}
