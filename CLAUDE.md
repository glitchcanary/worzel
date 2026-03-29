# Claude Code Instructions for Worzel

## Security Policy — Non-Negotiable

**Do not weaken security infrastructure without explicit discussion and approval.**

This applies to:
- `src/server/middleware/csp.ts` — Content Security Policy
- Any authentication or authorisation middleware
- Supabase RLS policies (`supabase/migrations/`)
- CORS, rate limiting, input validation, or any other security boundary

### What "weakening" means

Examples that require explicit human approval before proceeding:
- Adding `'unsafe-eval'`, `'unsafe-inline'`, or any wildcard (`*`) to CSP directives
- Broadening `connect-src`, `script-src`, `worker-src`, `img-src` beyond what is strictly needed
- Disabling or loosening authentication checks
- Adding `blob:`, `data:`, or other URI schemes to any CSP directive
- Bypassing hooks with `--no-verify`

### The rule

When a product feature requires a security change:
1. **Stop.** Do not make the change inline with other edits.
2. **Explain** the specific requirement and why the current policy blocks it.
3. **Propose** the narrowest possible change (e.g. `'wasm-unsafe-eval'` not `'unsafe-eval'`).
4. **Wait for explicit approval** before editing any security-related file.

This applies even when the change seems obviously necessary or minor. The cost of a conversation is lower than the cost of a silently weakened security boundary.

## Believe the user's observations

When the user reports a visual or behavioural regression ("it looked better before", "the quality is worse", "it used to work"), **believe them immediately and investigate**. Do not suggest the asset is low quality, the hardware is slow, or that their expectation is wrong. They have ground truth you do not. Wasting their time arguing is the worst possible response.

## General

- Node 22 required — `nvm use 22`
- Build: `npm run build` (TypeScript compile + asset copy)
- `.env` is at `../` (one level above repo root), not in the repo
- All browser JS dependencies are vendored in `fink/client/vendor/` — no CDN imports
- Do not add Co-Authored-By Claude lines to git commits
