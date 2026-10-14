import { readdirSync, readFileSync } from 'node:fs'

const failures = []

function read(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    failures.push(`Unable to read ${path}: ${String(error)}`)
    return ''
  }
}

function requireText(label, text, expected) {
  if (!text.includes(expected)) failures.push(`${label} must include: ${expected}`)
}

const ci = read('.github/workflows/ci.yml')
const deploy = read('.github/workflows/deploy.yml')
const releaseSmoke = read('apps/web/scripts/release-deploy-smoke.mjs')

requireText('CI', ci, 'needs: docker_publish')
requireText('CI', ci, 'Verify published stable GitHub Release')
requireText('CI', ci, "jq -r '.prerelease'")
requireText('CI', ci, 'uses: ./.github/workflows/deploy.yml')
requireText('CI', ci, 'image_tag: ${{ github.ref_name }}')
requireText('CI', ci, 'git_ref: ${{ github.ref_name }}')

requireText('production deploy', deploy, 'workflow_call:')
requireText('production deploy', deploy, 'workflow_dispatch:')
requireText('production deploy', deploy, 'group: deploy-production')
requireText('production deploy', deploy, 'cancel-in-progress: false')
requireText('production deploy', deploy, 'voxpery/voxpery-server:${IMAGE_TAG}')
requireText('production deploy', deploy, 'voxpery/voxpery-web:${IMAGE_TAG}')
requireText('production deploy', deploy, 'Release images are not visible yet; retrying in 10 seconds.')
requireText('production deploy', deploy, 'immutable server and web images were not both available')
requireText('production deploy', deploy, 'smoke:release-deploy')
requireText('production deploy', deploy, 'SMOKE_EXPECTED_IMAGE_TAG:')
requireText('production deploy', deploy, "SMOKE_SKIP_API_HEALTH: 'true'")
requireText('production deploy', deploy, 'Checkout current smoke tooling')
requireText('production deploy', deploy, 'ref: main')
requireText('production deploy', deploy, './scripts/ops/stack_healthcheck.sh')
requireText('production deploy', deploy, 'three consecutive health checks')
requireText('release deploy smoke', releaseSmoke, "`${WEB_BASE}/sw.js`")
requireText('release deploy smoke', releaseSmoke, "`${WEB_BASE}/version.json`")
requireText('release deploy smoke', releaseSmoke, 'metadata.imageTag === EXPECTED_IMAGE_TAG')

// Workflow inputs are attacker-influenced text: interpolating them into a `run:` script lets
// them inject shell commands. They must be passed through `env:` instead.
const workflowDir = '.github/workflows'
let workflowFiles = []
try {
  workflowFiles = readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name))
} catch (error) {
  failures.push(`Unable to list ${workflowDir}: ${String(error)}`)
}
for (const name of workflowFiles) {
  const lines = read(`${workflowDir}/${name}`).split(/\r?\n/)
  let runIndent = null
  lines.forEach((line, index) => {
    const indent = line.length - line.trimStart().length
    if (runIndent !== null && line.trim() !== '' && indent <= runIndent) runIndent = null
    const runMatch = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(line)
    if (runMatch) {
      runIndent = runMatch[1].length
      if (/^[|>]/.test(runMatch[2])) return
    } else if (runIndent === null) {
      return
    }
    if (/\$\{\{\s*(github\.event\.)?inputs\./.test(line)) {
      failures.push(`${workflowDir}/${name}:${index + 1} interpolates a workflow input in a run script; pass it through env instead`)
    }
  })
}

if (failures.length > 0) {
  console.error('Deploy workflow validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Deploy workflow validation passed.')
