import { ROUTES } from './routes'

export function resolvePostAuthRoute(redirectTo?: string): string {
  return redirectTo || ROUTES.servers
}

export function googleOAuthErrorMessage(error: string | null): string {
  switch (error) {
    case 'oauth_cancelled':
      return 'Google sign-in was cancelled. Try again when you are ready.'
    case 'oauth_failed_csrf':
      return 'Your Google sign-in session expired or could not be verified. Please try again.'
    case 'oauth_unverified_email':
      return 'Google did not verify your email address. Use a verified Google account or email/password.'
    case 'oauth_failed':
      return 'Sign in with Google failed. Try again or use email/password.'
    default:
      return ''
  }
}
