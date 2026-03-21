#!/usr/bin/env bash
# scripts/fly-secrets.sh — Load WORZEL_* secrets from ../.env and push to Fly.io
#
# Usage:
#   bash scripts/fly-secrets.sh            # preview what would be set
#   bash scripts/fly-secrets.sh --apply    # actually set the secrets

set -euo pipefail

ENV_FILE="${ENV_FILE:-../.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: env file not found at $ENV_FILE" >&2
  echo "Set ENV_FILE to override, e.g. ENV_FILE=.env bash $0" >&2
  exit 1
fi

# Secret-worthy keys (API keys, auth tokens, credentials).
# Non-secret config (provider names, ports, models) belongs in fly.toml [env].
SECRET_KEYS=(
  WORZEL_AUTH_SECRET
  WORZEL_OPENAI_API_KEY
  WORZEL_ANTHROPIC_API_KEY
  WORZEL_GROQ_API_KEY
  WORZEL_ELEVENLABS_API_KEY
  WORZEL_TWILIO_ACCOUNT_SID
  WORZEL_TWILIO_AUTH_TOKEN
)

# Parse .env: skip blanks, comments, and export prefixes
declare -A env_vars
while IFS= read -r line || [[ -n "$line" ]]; do
  # Trim whitespace
  line="${line#"${line%%[![:space:]]*}"}"
  # Skip empty lines and comments
  [[ -z "$line" || "$line" == \#* ]] && continue
  # Strip optional "export " prefix
  line="${line#export }"
  # Split on first '='
  key="${line%%=*}"
  value="${line#*=}"
  # Strip surrounding quotes from value
  value="${value#\"}" ; value="${value%\"}"
  value="${value#\'}" ; value="${value%\'}"
  env_vars["$key"]="$value"
done < "$ENV_FILE"

# Collect matching secrets
secrets=()
for key in "${SECRET_KEYS[@]}"; do
  if [[ -n "${env_vars[$key]+x}" && -n "${env_vars[$key]}" ]]; then
    secrets+=("${key}=${env_vars[$key]}")
  fi
done

if [[ ${#secrets[@]} -eq 0 ]]; then
  echo "No matching secrets found in $ENV_FILE"
  exit 0
fi

echo "Found ${#secrets[@]} secret(s) in $ENV_FILE:"
for s in "${secrets[@]}"; do
  key="${s%%=*}"
  echo "  $key=<redacted>"
done

if [[ "${1:-}" == "--apply" ]]; then
  echo ""
  echo "Setting secrets on Fly.io..."
  fly secrets set "${secrets[@]}"
  echo "Done."
else
  echo ""
  echo "Dry run — re-run with --apply to set these on Fly.io:"
  echo "  bash $0 --apply"
fi
