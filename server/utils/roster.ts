import { writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { useDb, type ProfileRow } from './db'
import { readSoul } from './soul'

const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')
const ROSTER_FILE = join(HERMES_HOME, 'team-roster.md')
const ROSTER_SKILL_DIR = join(HERMES_HOME, 'skills', 'team-roster')
const ROSTER_SKILL_FILE = join(ROSTER_SKILL_DIR, 'SKILL.md')

const ROLE_FIELDS = ['Role', 'Creature', 'Vibe', 'Mission']
const ROLE_LINE_RE = new RegExp(`^[*\\-]?\\s*\\*\\*(${ROLE_FIELDS.join('|')}):\\*\\*\\s*(.+?)\\s*$`, 'i')

const ROLE_MAX_CHARS = 240

export function extractRole(soul: string): string | null {
  if (!soul) return null

  const lines = soul.split(/\r?\n/)

  // First pass: look for a known field (Role / Creature / Vibe / Mission).
  for (const raw of lines) {
    const m = raw.match(ROLE_LINE_RE)
    if (m && m[2]) {
      return m[2].replace(/\*\*/g, '').trim().slice(0, ROLE_MAX_CHARS)
    }
  }

  // Fallback: first non-trivial line that isn't a heading or italic-only callout.
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) continue
    if (/^[_*].*[_*]$/.test(line) && !/[a-z0-9].*[a-z0-9]/i.test(line.replace(/[_*]/g, ''))) continue
    if (line.startsWith('---')) continue
    // Skip "Who Am I?" type prompt lines
    if (/^who am i\??$/i.test(line)) continue
    return line.replace(/^\*\*|\*\*$/g, '').replace(/\*\*/g, '').slice(0, ROLE_MAX_CHARS)
  }

  return null
}

const ROSTER_SKILL_BODY = `---
name: team-roster
description: Mission-control orchestration playbook for an interactive Hermes profile (running via 'hermes chat' or ACP, NOT as a kanban worker). Tells you who's on the team and how to delegate work via 'hermes kanban create' instead of doing it yourself.
version: 3.0.0
metadata:
  hermes:
    tags: [orchestration, kanban, multi-profile, routing, mission-control]
---

# Mission Control — Team Roster + Delegation Playbook

You are the orchestrator profile in the Hermes Orchestration War Room. You decompose the user's mission and delegate work to specialists via the Kanban board. **You do not execute the work yourself.**

## CRITICAL: action vs. talk

Talking about creating a task is **not** creating a task. The user gets a status banner from the war-room when the dispatcher is missing — you do not need to write that message yourself. The dispatcher is the war-room's responsibility, not yours.

To actually delegate, you **must invoke the \`terminal\` tool with a real \`hermes kanban create\` command**. If you reply to the user with prose like "I have created the task" without having called the tool, you are lying. Don't do that.

If the \`terminal\` tool is unavailable in this turn for any reason, say so explicitly (e.g. "terminal toolset is disabled, I can't delegate"). Don't pretend a delegation happened.

## Procedure (every mission, in order)

### 1. Read the roster

\`\`\`
~/.hermes/team-roster.md
\`\`\`

Use the slug between backticks as the \`assignee\` value. If no profile fits, stop and ask the user — do not invent a slug.

### 2. Sketch the task graph for the user

Show your decomposition as a short list before creating anything:

> I'll split this into 3 tasks:
> - **T1** \`investigador\` — search the corpus for normas matching X
> - **T2** \`legal\` — analyse compliance, parents: T1
> - **T3** \`writer\` — draft the memo, parents: T2

Wait for the user's go-ahead unless the mission is unambiguous.

### 3. Create the tasks (this is a tool call, not prose)

For each task in the plan, invoke the \`terminal\` tool with **a single-line shell command**. The CLI signature is:

\`\`\`
hermes kanban create [-h] [--body BODY] [--assignee ASSIGNEE] [--parent PARENT]
                     [--workspace WORKSPACE] [--priority PRIORITY] [--json]
                     title
\`\`\`

\`title\` is **positional** (no \`--title\` flag — that is wrong and will be rejected). Always pass \`--json\` so you can parse the task id reliably.

**You MUST prefix every \`hermes kanban\` call with \`HERMES_HOME=<ABSOLUTE_PATH>\`** where the absolute path is the global Hermes home (typically \`/home/<user>/.hermes\` or \`/root/.hermes\`). Without it, your invocation inherits \`HERMES_HOME\` from your own profile directory and writes to a per-profile \`kanban.db\` that the dispatcher never reads. Tasks created without that prefix are silently lost.

**Do NOT use \`$HOME\` or \`~\`** — shell variable expansion is unreliable in the terminal tool sandbox and gets stripped, producing a relative path that writes to a phantom \`kanban.db\` inside the profile directory.

To find the absolute path, the dashboard exposes the global Hermes home in the war-room preamble. Use that exact string verbatim.

Single-task example (one line, no backslash continuations, absolute path):

\`\`\`
HERMES_HOME=/home/<user>/.hermes hermes kanban create "research: Postgres cost vs current" --assignee investigador --body "Compare estimated infrastructure costs over 3 years. Sources: AWS pricing, peer reports." --json
\`\`\`

With dependencies, repeat \`--parent <task_id>\` per parent:

\`\`\`
HERMES_HOME=/home/<user>/.hermes hermes kanban create "synthesize recommendation" --assignee analyst --body "Read T1 and T2 results; produce 1-page memo." --parent <T1_id> --parent <T2_id> --json
\`\`\`

The \`--json\` output is a single JSON object; the new task id is in its \`id\` field (or \`task_id\`). Use it for downstream \`--parent\` flags. **Read it from the actual tool output, not from your imagination.**

If a \`hermes kanban create\` invocation fails, surface the real stderr to the user and stop. Don't continue as if it succeeded.

### 4. Report the real ids

After creating tasks, list to the user the **real task ids** you got back from the terminal output, one per task. The war-room will show live progress on each agent's workstation. Don't include placeholder ids like "T1"; use what \`hermes kanban create\` actually returned.

## Anti-temptation rules

- **Don't search the corpus yourself.** Even if you have \`file\` access, the answer is "create a research task".
- **Don't draft prose yourself.** Create a writer task.
- **Don't shortcut "small" tasks.** Small tasks are cheap to delegate.
- **Don't claim a delegation happened without a tool call.** If \`hermes kanban create\` did not run, no delegation happened.
- **Don't tell the user to start the dispatcher.** That's the war-room's banner, not yours. Just create the task.

## Useful read-only commands

The user (and you, if needed) can monitor progress with:

\`\`\`bash
hermes kanban list --json
hermes kanban show <task_id>
hermes kanban tail <task_id>          # live event stream
\`\`\`

These are safe read-only checks; you may use them to confirm that a task you created is actually present.
`

function atomicWrite(path: string, contents: string, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, contents, { mode })
    renameSync(tmp, path)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch { /* ignore */ }
    throw e
  }
}

function writeSkillIfDrifted(file: string): void {
  if (existsSync(file)) {
    try {
      const current = readFileSync(file, 'utf8')
      if (current === ROSTER_SKILL_BODY) return
    } catch { /* fall through to write */ }
  }
  atomicWrite(file, ROSTER_SKILL_BODY)
}

/**
 * Install the team-roster SKILL.md at the global hub AND inside every
 * known profile's `skills/` directory. Hermes scans skills per-profile
 * (`~/.hermes/profiles/<slug>/skills/`), so the global copy alone is
 * insufficient — `hermes -p <slug> skills list` won't see it. Writing
 * the file in each profile makes it available via the standard
 * `skill_view` machinery.
 *
 * Idempotent: only rewrites files whose content differs from the bundled body.
 */
export function ensureTeamRosterSkill(): void {
  writeSkillIfDrifted(ROSTER_SKILL_FILE)

  const db = useDb()
  const rows = db
    .prepare('SELECT hermes_dir FROM profiles WHERE present = 1')
    .all() as unknown as { hermes_dir: string }[]
  for (const row of rows) {
    const target = join(row.hermes_dir, 'skills', 'team-roster', 'SKILL.md')
    try {
      writeSkillIfDrifted(target)
    } catch (e) {
      console.error(`[roster] failed to install skill in ${row.hermes_dir}:`, (e as Error).message)
    }
  }
}

export function regenerateRoster(): void {
  const db = useDb()
  const rows = db
    .prepare('SELECT * FROM profiles WHERE present = 1 AND active = 1 ORDER BY is_default DESC, slug ASC')
    .all() as unknown as ProfileRow[]

  const lines: string[] = []
  lines.push('# Team roster')
  lines.push('')
  lines.push('Active Hermes profiles available for Kanban task assignment.')
  lines.push('Use the **slug** verbatim as the `assignee` value when calling `kanban_create`.')
  lines.push('')

  if (rows.length === 0) {
    lines.push('_No active profiles. Hire one in the war-room or activate an existing profile._')
  } else {
    for (const r of rows) {
      const callsign = r.given_name?.trim() || r.display_name
      const soul = readSoul(r.hermes_dir)
      const role = extractRole(soul) ?? '(no description — edit SOUL.md to describe what this agent does)'
      const callsignSuffix = callsign && callsign !== r.slug ? ` (${callsign})` : ''
      lines.push(`- **\`${r.slug}\`**${callsignSuffix} — ${role}`)
    }
  }

  lines.push('')
  lines.push('---')
  lines.push(`_Last updated: ${new Date().toISOString()}_`)
  lines.push('_Source: Hermes Orchestration War Room dashboard. Do not edit by hand — changes will be overwritten._')
  lines.push('')

  atomicWrite(ROSTER_FILE, lines.join('\n'))
}

/** Idempotently install the skill, refresh the roster file, and make sure
 *  per-profile kanban.db files are symlinks to the global board. Safe to
 *  call on every write. */
export function syncRoster(): void {
  ensureTeamRosterSkill()
  regenerateRoster()
  // Lazy import to avoid circular dep — kanban-symlinks reads from db.ts
  // which is also loaded here.
  void (async () => {
    const { ensureKanbanSymlinks } = await import('./kanban-symlinks')
    try {
      const { updated } = ensureKanbanSymlinks()
      if (updated.length > 0) {
        console.log(`[kanban-symlinks] refreshed for: ${updated.join(', ')}`)
      }
    } catch (e) {
      console.error('[kanban-symlinks] sync failed:', (e as Error).message)
    }
  })()
}
