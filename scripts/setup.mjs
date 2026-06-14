#!/usr/bin/env node
// One-command setup for new clones: creates a git-ignored .env, prompts for
// secrets WITHOUT echoing them, and activates the secret-guard git hook.
// Cross-platform (pure Node, no bash) so forkers on any OS can run it.
import { readFile, writeFile, chmod, access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import readline from 'node:readline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV = join(root, '.env')
const EXAMPLE = join(root, '.env.example')

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

const exists = (p) => access(p, constants.F_OK).then(() => true, () => false)

// Prompt that suppresses terminal echo for secret values.
function prompt(question, { secret = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl._writeToOutput = (str) => {
      // After the question is printed, mute everything the user types.
      if (rl.muted) return
      rl.output.write(str)
    }
    rl.question(question, (answer) => {
      if (secret) rl.output.write('\n')
      rl.close()
      resolve(answer.trim())
    })
    if (secret) rl.muted = true
  })
}

async function loadProviders() {
  const raw = await readFile(join(root, 'providers.json'), 'utf8')
  return JSON.parse(raw).providers
}

// Replace `KEY=` lines in the .env body, preserving comments/formatting.
function setEnvValue(body, key, value) {
  if (!value) return body
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(body) ? body.replace(re, line) : `${body}\n${line}`
}

async function main() {
  console.log(c.bold('\n  Steam Dashboard — setup\n'))

  // 1) Create .env from the template if it doesn't already exist.
  let body
  if (await exists(ENV)) {
    console.log(c.yellow('  • .env already exists — leaving it untouched.'))
    body = await readFile(ENV, 'utf8')
  } else {
    body = await readFile(EXAMPLE, 'utf8')
    console.log(c.green('  • created .env from .env.example'))
  }

  // 2) Prompt for each provider's secrets (silently for secret keys).
  const providers = await loadProviders()
  const interactive = process.stdin.isTTY && !process.argv.includes('--no-prompt')
  if (interactive) {
    console.log(c.dim('\n  Enter your credentials. Press Enter to skip and fill them in later.'))
    console.log(c.dim('  Secret values are NOT shown as you type.\n'))
    for (const p of providers) {
      for (const e of p.env) {
        const label = `  ${c.cyan(e.key)} ${c.dim('(' + e.hint + ')')}\n  > `
        const value = await prompt(label, { secret: e.secret })
        body = setEnvValue(body, e.key, value)
      }
    }
  } else {
    console.log(c.dim('\n  Non-interactive shell — skipping prompts. Edit .env manually.'))
  }

  // 3) Write .env with owner-only permissions (best effort on POSIX).
  await writeFile(ENV, body, { mode: 0o600 })
  try { await chmod(ENV, 0o600) } catch { /* non-POSIX */ }
  const mode = (await stat(ENV)).mode & 0o777
  console.log(c.green(`\n  • wrote .env (${mode.toString(8)})`))

  // 4) Activate the secret-guard hook — only if THIS folder is the git root,
  //    so we never hijack a parent repo's hook configuration.
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root })
      .toString().trim()
    const sameRepo = top === root
    if (sameRepo) {
      execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root })
      await chmod(join(root, '.githooks', 'pre-commit'), 0o755).catch(() => {})
      console.log(c.green('  • activated secret-guard pre-commit hook'))
    } else {
      console.log(c.yellow('  • skipped git hook: this folder is not its own git repo.'))
      console.log(c.dim(`    (git root is ${top})`))
      console.log(c.dim('    Run `git init` here when you split it into its own repo, then re-run setup.'))
    }
  } catch {
    console.log(c.yellow('  • skipped git hook: not a git repository yet.'))
    console.log(c.dim('    Run `git init` then re-run `npm run setup` to enable the secret guard.'))
  }

  console.log(c.bold('\n  Done. ') + c.dim('Next: ') + 'npm run dev' + c.dim('  ·  verify config safely with ') + 'npm run doctor\n')
}

main().catch((err) => {
  console.error('\nSetup failed:', err.message)
  process.exit(1)
})
