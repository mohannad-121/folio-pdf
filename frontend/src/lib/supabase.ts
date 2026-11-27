/**
 * Supabase client (Auth only; the browser never talks to the database).
 *
 * The URL and publishable key come from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` at build
 * time, or at runtime from `GET /api/auth/config` (the desktop build and self-hosted servers decide
 * this on the backend). Accounts are enabled only when the backend says so: without a Supabase URL
 * on the server every account UI stays hidden, like the old `billing_enabled=false` behaviour.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js'

const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
const ENV_URL = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').trim()
const ENV_KEY = ((import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? '').trim()

export interface AuthConfig {
  enabled: boolean
  supabase_url: string
  publishable_key: string
}

let client: SupabaseClient | null = null
let clientPromise: Promise<SupabaseClient> | null = null
let configPromise: Promise<AuthConfig> | null = null
let resolvedConfig: AuthConfig | null = null

/** supabase-js is loaded lazily so it stays out of the main bundle. */
async function makeClient(url: string, key: string): Promise<SupabaseClient> {
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'folio.auth',
    },
  })
}

/** Server auth config (cached). Falls back to the build-time env when the endpoint is missing. */
export function loadAuthConfig(): Promise<AuthConfig> {
  if (configPromise) return configPromise
  configPromise = fetch(`${API_BASE}/api/auth/config`, { headers: { Accept: 'application/json' }, credentials: 'include' })
    .then(async (res) => {
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error('no auth config')
      return (await res.json()) as AuthConfig
    })
    .catch(() => ({ enabled: !!(ENV_URL && ENV_KEY), supabase_url: ENV_URL, publishable_key: ENV_KEY }))
    .then((cfg) => {
      resolvedConfig = cfg
      return cfg
    })
  return configPromise
}

/** The Supabase client, or null when accounts are not enabled on this server. */
export async function getSupabase(): Promise<SupabaseClient | null> {
  if (client) return client
  const cfg = await loadAuthConfig()
  if (!cfg.enabled) return null
  const url = ENV_URL || cfg.supabase_url
  const key = ENV_KEY || cfg.publishable_key
  if (!url || !key) return null
  clientPromise ??= makeClient(url, key)
  client = await clientPromise
  return client
}

/** Synchronous access once `getSupabase()` resolved (null before that or when disabled). */
export function supabaseNow(): SupabaseClient | null {
  return client
}

export function accountsConfigured(): boolean | null {
  return resolvedConfig ? resolvedConfig.enabled : null
}

/** Like getSupabase(), but throws a friendly error when accounts are off. */
export async function requireSupabase(): Promise<SupabaseClient> {
  const sb = await getSupabase()
  if (!sb) throw new Error('Accounts are not enabled on this server.')
  return sb
}

// ---------------------------------------------------------------------------
// Token for API calls
// ---------------------------------------------------------------------------

/**
 * True while the session is aal1 but the account has a verified TOTP factor: the user has not
 * finished signing in, so the API sees them as anonymous until they enter their code.
 */
let mfaPending = false

export function setMfaPending(v: boolean) {
  mfaPending = v
}

export function isMfaPending(): boolean {
  return mfaPending
}

/** Current access token for `Authorization: Bearer` (refreshed by supabase-js when needed). */
export async function getAccessToken(): Promise<string | null> {
  const sb = client ?? (await getSupabase())
  if (!sb || mfaPending) return null
  try {
    const { data } = await sb.auth.getSession()
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

/** Force a refresh (after a 401 from the API). Returns the new token or null. */
export async function refreshAccessToken(): Promise<string | null> {
  const sb = client ?? (await getSupabase())
  if (!sb || mfaPending) return null
  try {
    const { data, error } = await sb.auth.refreshSession()
    if (error) return null
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

export type { Session }
