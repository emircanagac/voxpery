// Fills the <head> lines shared by the HTML entry points (index, landing, compare) and the app's
// schema.org block, so they are written once in src/seo. Used by the Vite plugin and the tests.
export const COMMON_HEAD_MARKER = '<!-- voxpery:common-head -->'
export const APP_SCHEMA_MARKER = '<!-- voxpery:app-schema -->'

type SharedParts = { commonHead: string; appSchema: string }

function indentLines(block: string, indent: string) {
  return block.replace(/\r\n/g, '\n').trim().split('\n').map((line) => indent + line).join('\n')
}

function replaceMarker(html: string, marker: string, block: string) {
  const pattern = new RegExp(`^([ \\t]*)${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm')
  return html.replace(pattern, (_match, indent: string) => indentLines(block, indent))
}

export function applySharedHtml(html: string, { commonHead, appSchema }: SharedParts): string {
  const schema = JSON.stringify(JSON.parse(appSchema))
  return replaceMarker(
    replaceMarker(html, COMMON_HEAD_MARKER, commonHead),
    APP_SCHEMA_MARKER,
    `<script type="application/ld+json">${schema}</script>`,
  )
}
