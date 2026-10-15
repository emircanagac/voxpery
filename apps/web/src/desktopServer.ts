/**
 * Desktop only: choosing a self-hosted Voxpery server. The desktop shell validates the address,
 * checks the server and stores the choice; the app restarts to apply it.
 */

export type DesktopServer = {
  apiOrigin: string
  voiceOrigin: string | null
  /** True for `http` servers (local and private networks only). */
  insecure: boolean
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error
  if (error instanceof Error && error.message) return error.message
  return fallback
}

/** The self-hosted server this app was started for, or null for voxpery.com. */
export function getDesktopServer(): Promise<DesktopServer | null> {
  return invokeDesktop<DesktopServer | null>('desktop_custom_server')
}

/** Checks that `address` is an allowed Voxpery server; stores nothing. */
export async function checkDesktopServer(address: string): Promise<DesktopServer> {
  try {
    return await invokeDesktop<DesktopServer>('desktop_probe_custom_server', { address })
  } catch (error) {
    throw new Error(errorMessage(error, 'Could not check the server.'), { cause: error })
  }
}

/** Connects to `address` (after the user confirmed trust), or back to voxpery.com with null. Restarts the app. */
export async function switchDesktopServer(address: string | null, trusted: boolean): Promise<void> {
  try {
    await invokeDesktop<void>('desktop_set_custom_server', { address, trusted })
  } catch (error) {
    throw new Error(errorMessage(error, 'Could not change the server.'), { cause: error })
  }
}

export function serverLabel(server: DesktopServer | null): string {
  if (!server) return 'voxpery.com'
  try {
    return new URL(server.apiOrigin).host
  } catch {
    return server.apiOrigin
  }
}
