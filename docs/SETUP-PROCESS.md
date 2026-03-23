# Full Setup Process Reference

End-to-end record of deploying the tastytrade monitor v2 as a new service with multi-tenant auth and GitHub OAuth. Intended as agent context for reproducing or extending this setup.

## 1. New Repository from Existing Branch

The goal was to take changes on a feature branch and publish them as a clean repo with no prior history.

```bash
# Create orphan branch (no parent commits)
git checkout --orphan tasty-v2-main

# Stage all files, commit
git add -A
git commit -m "Initial commit: tastytrade options monitor v2"

# Create new GitHub repo
gh repo create atomize/tasty-agent-v2 --public --description "tastytrade options monitor v2"

# Add as second remote and push orphan branch as main
git remote add v2 git@github.com:atomize/tasty-agent-v2.git
git push v2 tasty-v2-main:main
```

**Key lesson**: After the initial push, subsequent commits push with the same command: `git push v2 tasty-v2-main:main`.

## 2. Secret Audit Before Publishing

Before creating the public repo, every file was scanned for secrets:

```bash
# Check staged changes
git diff --cached

# Search for hardcoded keys
grep -r "TASTYTRADE_CLIENT" --include="*.ts" --include="*.env*"

# Check git history for leaked secrets
git log -p --all -S "client_secret"
```

**Findings and fixes**:
- `.env.example` had real Tastytrade client ID/secret — replaced with placeholder strings
- `packages/monitor/src/config.ts` had a hardcoded fallback client ID — replaced with empty string
- Added `docs/REWRITE-PROMPT.md` and `docs/REWRITE-PROMPT-2.md` to `.gitignore`
- Deleted stray `packages/monitor/packages/` directory

## 3. Render Blueprint Deployment

### render.yaml structure

```yaml
services:
  - type: web
    name: tasty-v2-monitor
    runtime: docker
    dockerfilePath: docker/Dockerfile
    dockerCommand: /app/docker/entrypoint-monitor.sh
    envVars:
      - key: SERVE_DASHBOARD
        value: "true"
      - key: ENCRYPTION_KEY        # sync: false = set manually
        sync: false
      - key: JWT_SECRET
        sync: false
      - key: PUBLIC_URL
        value: "https://tasty-v2-monitor.onrender.com"
      - key: GITHUB_CLIENT_ID
        sync: false
      - key: GITHUB_CLIENT_SECRET
        sync: false
      - fromGroup: tasty-v2-secrets
    healthCheckPath: /

  - type: worker
    name: tasty-v2-agent
    runtime: docker
    # ...
    envVars:
      - key: AGENT_PROVIDER
        value: claude-sdk
      - fromGroup: tasty-v2-secrets
      - fromGroup: tasty-v2-llm
```

### Deploying the blueprint

```bash
# Validate first
render blueprint validate render.yaml

# Deploy via Render Dashboard (not CLI — CLI cannot create new blueprints)
# Go to: https://dashboard.render.com/select-repo?type=blueprint
# Select the repo, deploy
```

**Edge case**: The Render CLI `render blueprint launch` command does not exist. Blueprint creation must be done via the Dashboard. The CLI is only useful for validation and managing existing services.

### Build order matters (Dockerfile)

The monorepo has interdependent packages. Build order must respect dependency graph:

```dockerfile
RUN pnpm --filter @tastytrade-monitor/shared build \
 && pnpm --filter @tastytrade-monitor/claude-agent build \
 && pnpm --filter @tastytrade-monitor/monitor build \
 && pnpm --filter @tastytrade-monitor/dashboard build
```

**Error encountered**: Building `monitor` before `claude-agent` caused `TS2307: Cannot find module '@tastytrade-monitor/claude-agent'`. Fix: reorder so `claude-agent` builds before `monitor`.

## 4. Setting Environment Variables on Render

### sync: false variables

Blueprint `sync: false` variables are declared but not set. They must be populated after deployment.

### Using the Render API directly

The Render CLI does not have an `env set` command. Use the REST API:

```bash
RENDER_API_KEY=$(grep 'key:' ~/.render/cli.yaml | awk '{print $2}')
SERVICE_ID="srv-xxxx"

# Set a single env var
curl -s -X PUT "https://api.render.com/v1/services/${SERVICE_ID}/env-vars/VARIABLE_NAME" \
  -H "Authorization: Bearer ${RENDER_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"value":"the-value"}'
```

**Edge cases encountered**:
- `PUT /v1/env-groups/{id}/env-vars` (batch) returns 404 — use individual `PUT /v1/env-groups/{id}/env-vars/{key}` instead
- Service-level env vars use `/v1/services/{id}/env-vars/{key}`
- Env group vars use `/v1/env-groups/{id}/env-vars/{key}`
- Shell string interpolation breaks with special characters in tokens — use a script (Node.js/Python) that reads from `.env` directly

### Finding service and env group IDs

```bash
# Service IDs
render services list --output json | python3 -c "
import sys, json
for s in json.load(sys.stdin):
    svc = s.get('service', s)
    print(f\"{svc.get('name')}: {svc.get('id')}\")"

# Env group IDs
curl -s "https://api.render.com/v1/env-groups" \
  -H "Authorization: Bearer ${RENDER_API_KEY}" | python3 -c "
import sys, json
for g in json.load(sys.stdin):
    eg = g.get('envGroup', g)
    print(f\"{eg.get('name')}: {eg.get('id')}\")"
```

### Triggering a redeploy after env var changes

Service-level env var changes do NOT auto-trigger a redeploy:

```bash
render deploys create srv-xxxx --confirm
```

## 5. Multi-Tenant Mode Activation

Multi-tenant mode is gated by the `ENCRYPTION_KEY` env var:

```bash
# Generate a key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Set on Render
curl -s -X PUT ".../env-vars/ENCRYPTION_KEY" ...
curl -s -X PUT ".../env-vars/JWT_SECRET" ...
```

When `ENCRYPTION_KEY` is set:
- Dashboard shows login screen (AuthGate component)
- WebSocket messages are gated by JWT authentication
- Each user gets their own agent config (API keys encrypted at rest)

## 6. GitHub OAuth App Creation

### No API exists for creating OAuth Apps

GitHub has no REST API endpoint to create OAuth Apps (only GitHub Apps via manifest flow). Creation must be done through the web UI.

### Browser automation approach (Cursor MCP)

```
1. browser_navigate to https://github.com/settings/applications/new
2. browser_lock (prevent user interaction during automation)
3. browser_snapshot to get element refs
4. browser_fill each field:
   - Application name: "tasty-v2-monitor"
   - Homepage URL: "https://tasty-v2-monitor.onrender.com"
   - Authorization callback URL: "https://tasty-v2-monitor.onrender.com/auth/github/callback"
5. browser_click "Register application" button
6. Wait for redirect, browser_snapshot to capture Client ID
7. "Generate a new client secret" button is an <input type="submit"> —
   browser_click fails with stale ref. Unlock browser, have user click manually.
8. browser_snapshot to capture the secret from the page
```

**Edge case**: The "Generate a new client secret" button is an `<input type="submit" readonly>` inside a CSRF-protected form. The browser MCP's `browser_click` fails with "stale element reference: expected a button but found (input)". Workaround: unlock the browser and have the user click it manually, then snapshot to capture the secret.

### Setting OAuth credentials on Render

```bash
curl -s -X PUT ".../env-vars/GITHUB_CLIENT_ID" -d '{"value":"Ov23li..."}'
curl -s -X PUT ".../env-vars/GITHUB_CLIENT_SECRET" -d '{"value":"47b87f..."}'
curl -s -X PUT ".../env-vars/PUBLIC_URL" -d '{"value":"https://tasty-v2-monitor.onrender.com"}'

# Trigger redeploy
render deploys create srv-xxxx --confirm
```

### Verifying OAuth works

```bash
# Should return 302 redirect to GitHub with correct params
curl -sI https://tasty-v2-monitor.onrender.com/auth/github
```

Expected: `HTTP/2 302` with `location: https://github.com/login/oauth/authorize?...client_id=...&redirect_uri=...`

## 7. Monitoring Deploys

```bash
# Check latest deploy status
render deploys list srv-xxxx --output json | python3 -c "
import sys, json
data = json.load(sys.stdin)
dep = data[0].get('deploy', data[0])
print(f\"{dep.get('id')}: {dep.get('status')}\")"
```

Status progression: `created` -> `build_in_progress` -> `update_in_progress` -> `live`

If stuck at `update_in_progress`, check logs:

```bash
render logs --service-id srv-xxxx --tail 50
```

## Required Secrets Summary

| Variable | Where | Purpose |
|----------|-------|---------|
| `TASTYTRADE_CLIENT_ID` | Env group: tasty-v2-secrets | Tastytrade API auth |
| `TASTYTRADE_CLIENT_SECRET` | Env group: tasty-v2-secrets | Tastytrade API auth |
| `TASTYTRADE_REFRESH_TOKEN` | Env group: tasty-v2-secrets | Tastytrade session |
| `ANTHROPIC_API_KEY` | Env group: tasty-v2-llm | Claude API |
| `CLAUDE_API_KEY` | Env group: tasty-v2-llm | Claude Agent SDK |
| `ENCRYPTION_KEY` | Service: tasty-v2-monitor | Enables multi-tenant mode |
| `JWT_SECRET` | Service: tasty-v2-monitor | Signs user JWTs |
| `GITHUB_CLIENT_ID` | Service: tasty-v2-monitor | GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | Service: tasty-v2-monitor | GitHub OAuth |
| `PUBLIC_URL` | Service: tasty-v2-monitor | OAuth redirect base URL |
