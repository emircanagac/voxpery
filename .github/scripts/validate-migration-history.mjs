import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const MIGRATIONS_DIR = 'apps/server/migrations'
const VALIDATOR_PATH = '.github/scripts/validate-migration-history.mjs'
const migrationPattern = /^(\d+)_.*\.sql$/

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
}

function isAllZeroSha(value) {
  return /^0+$/.test(value)
}

function validateMigrationNames() {
  const seenVersions = new Map()
  const failures = []

  for (const fileName of readdirSync(MIGRATIONS_DIR).sort()) {
    const match = fileName.match(migrationPattern)
    if (!match) {
      failures.push(`Unexpected migration filename: ${fileName}`)
      continue
    }

    const version = Number(match[1])
    const existing = seenVersions.get(version)
    if (existing) {
      failures.push(`Duplicate migration version ${version}: ${existing}, ${fileName}`)
    } else {
      seenVersions.set(version, fileName)
    }
  }

  return failures
}

function baseContainsValidator(baseRef) {
  try {
    execFileSync('git', ['cat-file', '-e', `${baseRef}:${VALIDATOR_PATH}`], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function validateHistory(baseRef) {
  if (!baseRef || isAllZeroSha(baseRef) || baseRef === git(['rev-parse', 'HEAD'])) {
    console.log('Migration history comparison skipped: no distinct base revision was provided.')
    return []
  }

  if (!baseContainsValidator(baseRef)) {
    console.log('Migration history guard bootstrap: the base revision predates this validator.')
    return []
  }

  const diff = git([
    'diff',
    '--name-status',
    '--find-renames',
    baseRef,
    'HEAD',
    '--',
    MIGRATIONS_DIR,
  ])

  if (!diff) return []

  const failures = []
  for (const line of diff.split('\n')) {
    const [status, ...paths] = line.split('\t')
    if (status === 'A') continue
    failures.push(
      `Applied migration history is immutable; ${status} is not allowed for ${paths.join(' -> ')}`
    )
  }

  return failures
}

const baseRef = process.env.MIGRATION_BASE_REF?.trim()
const failures = [...validateMigrationNames(), ...validateHistory(baseRef)]

if (failures.length > 0) {
  console.error('Migration history validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Migration history validation passed.')
