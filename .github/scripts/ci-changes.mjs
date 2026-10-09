import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ALL = { backend: true, frontend: true, desktop: true }

// Documentation never affects builds or tests.
const DOCS = /^(docs\/|LICENSE$|\.github\/ISSUE_TEMPLATE\/)|\.md$/
// The CI definition itself can break any job.
const CI_WORKFLOW = /^\.github\/workflows\/ci\.yml$/
const BACKEND = /^apps\/server\//
const DESKTOP = /^(apps\/desktop\/|\.github\/scripts\/validate-linux-launchers|scripts\/dev\/local-qa-config)/
// Files outside apps/web that frontend-job validators and regression scripts read.
const FRONTEND_CROSS_REFERENCES = /^(apps\/server\/src\/services\/privacy\.rs$|apps\/server\/src\/routes\/desktop_registration_captcha\.js$|apps\/desktop\/src-tauri\/(tauri\.conf\.json$|tauri\.dev\.conf\.json$|linux\/))/

/** Decide which checks a set of changed paths needs. Unknown paths run the frontend job. */
export function classify(files) {
  const code = files.filter(file => !DOCS.test(file))
  if (code.some(file => CI_WORKFLOW.test(file))) return { ...ALL }
  return {
    backend: code.some(file => BACKEND.test(file)),
    desktop: code.some(file => DESKTOP.test(file)),
    frontend: code.some(file => FRONTEND_CROSS_REFERENCES.test(file)
      || !(BACKEND.test(file) || /^apps\/desktop\//.test(file))),
  }
}

/** Base commit to diff against, or null when everything must run (tags, manual runs, new branches). */
export function diffBase({ eventName, ref, pullRequestBase, pushBefore }) {
  if (eventName === 'pull_request') return pullRequestBase || null
  if (eventName === 'push' && !ref.startsWith('refs/tags/')) {
    return pushBefore && !/^0+$/.test(pushBefore) ? pushBefore : null
  }
  return null
}

function detect(env) {
  const base = diffBase({
    eventName: env.EVENT_NAME ?? '',
    ref: env.GIT_REF ?? '',
    pullRequestBase: env.PR_BASE ?? '',
    pushBefore: env.PUSH_BEFORE ?? '',
  })
  if (!base) return { ...ALL }
  try {
    const files = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' })
      .split('\n').map(line => line.trim()).filter(Boolean)
    return classify(files)
  } catch {
    // Missing history or an unknown base must never skip a check.
    return { ...ALL }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = detect(process.env)
  const lines = Object.entries(result).map(([name, value]) => `${name}=${value}`)
  console.log(lines.join('\n'))
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
}
