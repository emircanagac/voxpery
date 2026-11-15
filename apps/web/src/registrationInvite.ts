const INVITE_CODE = /^[A-Za-z0-9_-]{1,32}$/
const INVITE_PATH = /^\/invite\/([A-Za-z0-9_-]{1,32})\/?$/

/** The invite code in an in-app return path such as `/invite/AbC123`. */
export function inviteCodeFromRedirect(path: string | null | undefined): string | null {
  if (!path) return null
  return path.split(/[?#]/)[0].match(INVITE_PATH)?.[1] ?? null
}

/**
 * The invite code a person typed or pasted: a bare code or any invite link. The server decides
 * whether the code is real, so the link's host is not checked here.
 */
export function inviteCodeFromInput(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  if (INVITE_CODE.test(text)) return text
  try {
    return inviteCodeFromRedirect(new URL(text).pathname)
  } catch {
    return inviteCodeFromRedirect(text)
  }
}
