#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/persistence-profile-query.sh"

TEST_ROOT="$(mktemp -d)"
trap '[[ -n "${TEST_ROOT:-}" && -d "$TEST_ROOT" ]] && rm -rf -- "$TEST_ROOT"' EXIT

profiles_file="$TEST_ROOT/persistence.json"
cat > "$profiles_file" <<'EOF'
[
  {"id": "party-interaction", "artifactPattern": "TMF683-Party_Interaction"},
  {"id": "other", "artifactPattern": "Other-API"}
]
EOF

actual="$(
  matching_persistence_profiles \
    "/tmp/artifacts/TMF683-Party_Interaction-v5.0.0.oas.yaml" \
    "$profiles_file" |
    jq -s -c 'map(.id)'
)"

if [[ "$actual" != '["party-interaction"]' ]]; then
  printf 'FAIL: expected only the matching persistence profile, got %s\n' "$actual" >&2
  exit 1
fi

printf 'persistence-profile query test passed\n'
