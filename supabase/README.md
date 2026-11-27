# Supabase setup for Folio PDF

Folio uses Supabase for two things:

- **Auth**: sign-up confirmed with a 6-digit email code, password or email-code sign-in, password
  reset by code, and TOTP two-factor authentication (Google Authenticator, Microsoft Authenticator,
  Authy, 1Password and similar).
- **Postgres**: the backend's own tables (plans, API keys, usage counters, Paddle webhook log) live
  in a private `folio` schema in the same project.

Project: `https://hbfhsiimxscqdqbgbwag.supabase.co`

The publishable key and the project URL are public and already filled in
(`frontend/.env.example`, `backend/.env.example`). **The database password and the secret key are
not**, and must never be committed. Put them in `backend/.env` only.

## 1. Email templates (codes instead of links)

**Authentication → Emails → Templates.** For each template, paste the subject and the whole HTML
file as the body. Every template shows the 6-digit `{{ .Token }}`; none uses a link.

| Template             | Subject                                          | Body file                              |
| -------------------- | ------------------------------------------------ | -------------------------------------- |
| Confirm signup       | `Your Folio verification code: {{ .Token }}`     | `templates/confirm-signup.html`        |
| Magic link           | `Your Folio sign-in code: {{ .Token }}`          | `templates/magic-link.html`            |
| Reset password       | `Your Folio password reset code: {{ .Token }}`   | `templates/reset-password.html`        |
| Reauthentication     | `Confirm it's you: {{ .Token }}`                 | `templates/reauthentication.html`      |

"Magic link" is the template Supabase uses for the passwordless **email code** sign-in
(`signInWithOtp`). Folio shows a code field, so the email contains only the code.

## 2. Email provider settings

**Authentication → Sign In / Providers → Email**

- **Confirm email**: ON (already on for this project).
- **Email OTP Expiration**: `600` seconds (the templates say "10 minutes").
- **Email OTP Length**: `6`.
- Optional but recommended: **Secure password change** ON (Folio then asks for an emailed
  confirmation code before a password change, using the Reauthentication template).

## 3. Multi-factor authentication

**Authentication → Multi-Factor**: make sure **TOTP (App Authenticator)** is enabled (it is by
default). Nothing else is needed: users enrol from **Account → Security** in Folio.

## 4. URL configuration

**Authentication → URL Configuration**

- **Site URL**: `http://localhost:5173` for development. Change it to your production URL (for
  example `https://folio.example.com`) when you deploy.
- **Redirect URLs**: add `http://localhost:5173/**` and later `https://folio.example.com/**`.

Folio uses codes rather than links, but Supabase still validates these URLs and uses the Site URL in
the email footer (`{{ .SiteURL }}`).

## 5. Custom SMTP (required before real users sign up)

**Authentication → Emails → SMTP Settings**: the built-in email sender is for testing only. It is
heavily rate-limited (a few emails per hour for the whole project) and only reliably delivers to
your own team's addresses, so sign-ups and password resets will fail with
`over_email_send_rate_limit` as soon as you have real traffic.

Use a transactional email provider, for example **Resend**, **Postmark** or **Amazon SES**:

1. Create an account and verify your sending domain (SPF/DKIM records).
2. Enter host, port, username and password (API key) in the SMTP settings, plus a sender such as
   `Folio <no-reply@your-domain.com>`.
3. Afterwards, raise the email rate limit under **Authentication → Rate Limits** if needed.

## 6. Database connection (backend)

**Project Settings → Database → Connect** (or the **Connect** button at the top of the dashboard)
→ **Session pooler** → copy the URI. It looks like:

```
postgresql://postgres.hbfhsiimxscqdqbgbwag:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Replace `[YOUR-PASSWORD]` with your database password (reset it under Project Settings → Database
if you don't have it; URL-encode special characters such as `@`, `#` or `/`) and put it in
`backend/.env`:

```
FOLIO_DATABASE_URL=postgresql://postgres.hbfhsiimxscqdqbgbwag:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Paste it as is: Folio rewrites `postgresql://` to the pure-Python `pg8000` driver and always uses
TLS. The tables are created in the `folio` schema automatically on first start.

Optional, to verify the server certificate as well: **Project Settings → Database → SSL
Configuration → Download certificate**, save it (for example as `backend/supabase-ca.crt`) and set
`FOLIO_DATABASE_SSL_ROOT_CERT=supabase-ca.crt`. Supabase's CA is not in the operating system's trust
store, so without this file the connection is encrypted but the certificate is not verified.

## 7. Secret key (backend)

**Project Settings → API Keys → Secret keys** → create or reveal a key (`sb_secret_...`) and put it
in `backend/.env`:

```
FOLIO_SUPABASE_SECRET_KEY=sb_secret_...
```

The backend uses it for the Auth Admin API: deleting a user's sign-in when they delete their
account, and checking whether a user has two-factor authentication. It must never reach the
frontend or git.

## 8. Optional: create the schema yourself

The backend creates its tables on first start. If you prefer to manage the schema explicitly, open
the **SQL Editor**, paste `migrations/20261127000000_folio_schema.sql` and run it (it is idempotent).
It creates the `folio` schema with RLS enabled on every table and no access for the `anon` and
`authenticated` roles, so the publishable key can never read these tables. Do **not** add `folio`
to the exposed schemas under Project Settings → Data API.

## Complete `backend/.env` for the hosted edition

```
FOLIO_SUPABASE_URL=https://hbfhsiimxscqdqbgbwag.supabase.co
FOLIO_SUPABASE_PUBLISHABLE_KEY=sb_publishable_6seLeHmbPhL1zYrK4AYg_A_yzp1k6uJ
FOLIO_SUPABASE_SECRET_KEY=<sb_secret_... from step 7>
FOLIO_DATABASE_URL=<session pooler URI from step 6>
FOLIO_BILLING_ENABLED=true   # plus the FOLIO_PADDLE_* values, see backend/.env.example
```
