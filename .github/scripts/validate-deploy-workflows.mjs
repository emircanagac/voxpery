import { readFileSync } from 'node:fs'

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
requireText('production deploy', deploy, 'smoke:release-deploy')
requireText('production deploy', deploy, 'SMOKE_EXPECTED_IMAGE_TAG:')
requireText('production deploy', deploy, 'DEPLOY_PUBLIC_API_URL:')
requireText('production deploy', deploy, 'Public API edge health OK:')
requireText('production deploy', deploy, "SMOKE_SKIP_API_HEALTH: 'true'")

if (failures.length > 0) {
  console.error('Deploy workflow validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Deploy workflow validation passed.')
