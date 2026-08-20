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
requireText('release deploy smoke', releaseSmoke, "pathname.startsWith('/assets/')")
requireText('release deploy smoke', releaseSmoke, 'assertRevalidated(res, `bootstrap asset ${asset}`)')

if (failures.length > 0) {
  console.error('Deploy workflow validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Deploy workflow validation passed.')
