import { ROUTES } from './routes'

export function resolvePostAuthRoute(redirectTo?: string): string {
  return redirectTo || ROUTES.servers
}
