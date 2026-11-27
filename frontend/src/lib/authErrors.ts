/** Human messages for Supabase Auth error codes (https://supabase.com/docs/guides/auth/debugging/error-codes). */
import { ApiError } from './api'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface AuthErrorInfo {
  code: string | null
  message: string
}

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'That email and password don’t match. Check them and try again.',
  email_not_confirmed: 'Confirm your email first. We sent you a 6-digit code.',
  otp_expired: 'That code is wrong or has expired. Check it, or ask for a new one.',
  over_email_send_rate_limit: 'We’ve sent a lot of emails just now. Wait a few minutes, then ask for a new code.',
  over_request_rate_limit: 'Too many attempts. Wait a minute, then try again.',
  user_already_exists: 'An account with this email already exists.',
  email_exists: 'An account with this email already exists.',
  weak_password: 'That password is too easy to guess. Use at least 8 characters with a mix of letters, numbers and symbols.',
  email_address_invalid: 'Enter a valid email address.',
  validation_failed: 'Check the email address and try again.',
  email_address_not_authorized: 'We can’t send email to this address yet: the server’s email sender is restricted. Please contact support.',
  signup_disabled: 'New sign-ups are turned off right now.',
  email_provider_disabled: 'Signing in with email is turned off right now.',
  otp_disabled: 'There’s no account with that email yet. Create one instead?',
  user_not_found: 'There’s no account with that email yet. Create one instead?',
  user_banned: 'This account is suspended. Contact support for help.',
  mfa_verification_failed: 'That code isn’t right. Codes change every 30 seconds, so enter the current one.',
  mfa_verification_rejected: 'That code was rejected. Enter a fresh one from your app.',
  mfa_challenge_expired: 'That took a little too long. Enter a fresh code.',
  mfa_factor_not_found: 'That authenticator was removed. Reload the page and try again.',
  mfa_factor_name_conflict: 'You already have an authenticator with that name.',
  too_many_enrolled_mfa_factors: 'You have reached the maximum number of authenticators. Remove one first.',
  mfa_totp_enroll_not_enabled: 'Authenticator apps are not enabled for this project.',
  mfa_totp_verify_not_enabled: 'Authenticator apps are not enabled for this project.',
  insufficient_aal: 'Enter your authenticator code to continue.',
  same_password: 'Choose a password that’s different from your current one.',
  reauthentication_needed: 'For your security, confirm it’s you with the code we email you.',
  reauth_nonce_missing: 'For your security, confirm it’s you with the code we email you.',
  reauthentication_not_valid: 'That confirmation code is wrong or has expired.',
  session_not_found: 'Your session has ended. Please sign in again.',
  session_expired: 'Your session has expired. Please sign in again.',
  refresh_token_not_found: 'Your session has ended. Please sign in again.',
  refresh_token_already_used: 'Your session has ended. Please sign in again.',
  request_timeout: 'The request timed out. Try again.',
  captcha_failed: 'The security check failed. Reload the page and try again.',
}

function codeOf(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') return (e as { code: string }).code
  return null
}

export function authError(e: unknown): AuthErrorInfo {
  const code = codeOf(e)
  if (code && MESSAGES[code]) return { code, message: MESSAGES[code] }
  const status = e && typeof e === 'object' && 'status' in e ? (e as { status: unknown }).status : undefined
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  if (e instanceof ApiError) return { code: e.code ?? null, message: e.message }
  if (status === 0 || /fetch|network/i.test(msg)) return { code: 'network', message: 'We couldn’t reach the sign-in service. Check your connection and try again.' }
  if (status === 429) return { code: code ?? 'rate_limited', message: MESSAGES.over_request_rate_limit }
  if (/token has expired|is invalid/i.test(msg)) return { code: 'otp_expired', message: MESSAGES.otp_expired }
  if (/email not confirmed/i.test(msg)) return { code: 'email_not_confirmed', message: MESSAGES.email_not_confirmed }
  if (/signups not allowed for otp/i.test(msg)) return { code: 'otp_disabled', message: MESSAGES.otp_disabled }
  return { code, message: msg || 'Something went wrong. Please try again.' }
}

export function authErrorMessage(e: unknown): string {
  return authError(e).message
}
