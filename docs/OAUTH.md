# OAuth Authentication

GitHub and GitLab OAuth sign-in for the tastytrade Monitor multi-tenant dashboard.

## Architecture

```
Browser (popup)                  Monitor Server                   GitHub/GitLab
     |                               |                                |
     |-- GET /auth/github ---------->|                                |
     |                               |-- create state, HMAC sign ---->|
     |<-- 302 github.com/login/oauth |                                |
     |-- user authorizes ----------->|                                |
     |                               |<-- callback with code+state ---|
     |                               |-- validate state, exchange --->|
     |                               |<-- access_token ---------------|
     |                               |-- fetch /user + /user/emails ->|
     |                               |<-- profile --------------------|
     |                               |-- findOrCreateOAuthUser -------|
     |                               |-- sign JWT --------------------|
     |<-- HTML: postMessage(jwt) ----|                                |
     |                               |                                |
Browser (main)                       |                                |
     |<-- window.message event ------|                                |
     |-- WS: auth_token { jwt } ---->|                                |
     |<-- WS: auth_result + data ----|                                |
```

### Key components

| File | Purpose |
|------|---------|
| `packages/monitor/src/oauth.ts` | HTTP route handlers for `/auth/{github,gitlab}` start + callback |
| `packages/monitor/src/auth.ts` | `signTokenForOAuth()` generates JWT for OAuth-authenticated users |
| `packages/monitor/src/db.ts` | `findOrCreateOAuthUser()` — upserts users by `(oauth_provider, oauth_id)` |
| `packages/monitor/src/broadcaster.ts` | Wires OAuth routes into HTTP server, exposes `oauthProviders` in status |
| `packages/dashboard/src/components/AuthGate.tsx` | OAuth buttons, popup launcher |
| `packages/dashboard/src/hooks/useMonitorSocket.ts` | `postMessage` listener for popup JWT handoff |

### Library

[arctic](https://arctic.js.org/) — lightweight, zero-dependency OAuth 2.0 client library by the author of Lucia auth. Used for GitHub and GitLab authorization URL generation, code exchange, and token handling.

## Setup

### 1. Create a GitHub OAuth App

1. Go to https://github.com/settings/developers
2. Click **New OAuth App**
3. Fill in:
   - **Application name**: `tastytrade Monitor` (or anything)
   - **Homepage URL**: `https://your-domain.com`
   - **Authorization callback URL**: `https://your-domain.com/auth/github/callback`
4. Click **Register application**
5. Copy the **Client ID**
6. Generate a **Client Secret** and copy it

### 2. Create a GitLab Application (optional)

1. Go to https://gitlab.com/-/user_settings/applications
2. Click **Add new application**
3. Fill in:
   - **Name**: `tastytrade Monitor`
   - **Redirect URI**: `https://your-domain.com/auth/gitlab/callback`
   - **Scopes**: check `read_user`
   - Uncheck **Confidential** only if you want public client flow (keep checked for server-side)
4. Click **Save application**
5. Copy the **Application ID** (this is `GITLAB_CLIENT_ID`)
6. Copy the **Secret** (this is `GITLAB_CLIENT_SECRET`)

### 3. Set environment variables

Both providers are optional — configure one or both. OAuth buttons only appear for configured providers.

```bash
# GitHub OAuth
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# GitLab OAuth
GITLAB_CLIENT_ID=...
GITLAB_CLIENT_SECRET=...

# Public URL of the monitor (used to build redirect URIs)
# Required when behind a reverse proxy or on Render
PUBLIC_URL=https://tasty-v2-monitor.onrender.com
```

### 4. Prerequisites

OAuth requires multi-tenant mode to be enabled:

```bash
ENCRYPTION_KEY=<64-hex-char key>
JWT_SECRET=<random-secret>
```

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_CLIENT_ID` | No | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | No | GitHub OAuth App client secret |
| `GITLAB_CLIENT_ID` | No | GitLab Application ID |
| `GITLAB_CLIENT_SECRET` | No | GitLab Application secret |
| `PUBLIC_URL` | For production | Full base URL of the monitor (e.g. `https://tasty-v2-monitor.onrender.com`) |
| `ENCRYPTION_KEY` | Yes (multi-tenant) | 32-byte hex key to enable multi-tenant mode |
| `JWT_SECRET` | Yes (multi-tenant) | Secret for signing JWTs |

## How it works

### Authentication flow

1. User clicks "Sign in with GitHub/GitLab" button
2. Dashboard opens a popup window to `/auth/{provider}`
3. Server generates a random `state`, HMAC-signs it, stores in a cookie, and redirects to the provider
4. User authorizes the app on GitHub/GitLab
5. Provider redirects back to `/auth/{provider}/callback` with `code` and `state`
6. Server verifies the HMAC-signed state cookie matches the callback state (CSRF protection)
7. Server exchanges the authorization code for an access token using `arctic`
8. Server fetches the user's profile (and email for GitHub, since it may be private)
9. Server calls `findOrCreateOAuthUser()`:
   - If a user exists with matching `(oauth_provider, oauth_id)` — return them
   - If a user exists with matching email — link the OAuth identity and return them
   - Otherwise — create a new user (no password needed)
10. Server signs a JWT and returns HTML that posts it back to the parent window via `postMessage`
11. Dashboard's `useMonitorSocket` hook receives the JWT, stores it in localStorage, and sends it over WebSocket

### User linking

When an OAuth user's email matches an existing email/password account, the accounts are linked. The user can then sign in with either method. If a user was created via OAuth (no password), attempting email/password login returns an error guiding them to use the OAuth button.

### Database schema

The `users` table has two new nullable columns:

```sql
oauth_provider TEXT   -- 'github' or 'gitlab'
oauth_id       TEXT   -- provider's unique user ID
```

With a unique partial index: `UNIQUE(oauth_provider, oauth_id) WHERE oauth_provider IS NOT NULL`.

Existing email/password users are unaffected. The migration runs automatically on startup.

## Render deployment

On Render, set these env vars on the `tasty-v2-monitor` service:

```
GITHUB_CLIENT_ID     = <your GitHub client ID>
GITHUB_CLIENT_SECRET = <your GitHub client secret>
GITLAB_CLIENT_ID     = <your GitLab application ID>
GITLAB_CLIENT_SECRET = <your GitLab application secret>
PUBLIC_URL           = https://tasty-v2-monitor.onrender.com
```

The `render.yaml` blueprint already declares these as `sync: false` variables. Set them via the Render dashboard or API after blueprint deployment.

When configuring the OAuth apps on GitHub/GitLab, use the Render service URL as the callback domain:
- GitHub callback: `https://tasty-v2-monitor.onrender.com/auth/github/callback`
- GitLab callback: `https://tasty-v2-monitor.onrender.com/auth/gitlab/callback`

## Local development

For local testing, create a separate OAuth app with callback URLs pointing to localhost:

```
http://localhost:3001/auth/github/callback
http://localhost:3001/auth/gitlab/callback
```

Add the credentials to your `.env` file. You do **not** need to set `PUBLIC_URL` for local development — the server auto-detects `http://localhost:3001` from the request headers.

## Security notes

- **State parameter**: HMAC-signed with `JWT_SECRET` and stored in an HttpOnly cookie. Verified on callback to prevent CSRF.
- **Token storage**: JWTs are stored in the browser's `localStorage`. The 24-hour expiry limits exposure.
- **No provider tokens stored**: GitHub/GitLab access tokens are used only during the callback to fetch the user profile, then discarded. They are never persisted.
- **Email privacy**: For GitHub users with private emails, the server fetches from the `/user/emails` endpoint to find a verified primary email.
