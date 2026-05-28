#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERATOR_ROOT="${GENERATOR_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "$GENERATOR_ROOT/.." && pwd)}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-$WORKSPACE_ROOT/oas-to-jdl/artifacts}"
OAS_TO_JDL_JAR="${OAS_TO_JDL_JAR:-$WORKSPACE_ROOT/oas-to-jdl/target/oas-to-jdl-0.1.0-SNAPSHOT.jar}"
REGRESSION_APP_ROOT="${REGRESSION_APP_ROOT:-$WORKSPACE_ROOT}"

if [[ "${SKIP_OAS_TO_JDL:-false}" != "true" ]]; then
  echo "=== regenerate JDL artifacts from $ARTIFACT_ROOT ==="
  java -jar "$OAS_TO_JDL_JAR" --input="$ARTIFACT_ROOT/" --output="$ARTIFACT_ROOT/" --use-relationships=true
fi

while IFS=$'\t' read -r name app_dir jdl_file _yaml_file _db_user _db_name _base_name; do
  if [[ -z "$name" ]]; then
    continue
  fi
  echo "=== [$name] regenerate from $jdl_file ==="
  rm -Rf "$app_dir"
  mkdir -p "$app_dir"
  (
    cd "$app_dir"
    node "$GENERATOR_ROOT/dist/cli/jhipster.cjs" jdl "$jdl_file" --no-insight --force --skip-install < /dev/null
  )
  echo "=== [$name] compile including test support ==="
  (
    cd "$app_dir"
    ./mvnw clean test-compile -DskipTests=true -P'!webapp' < /dev/null
  )
done < <(
  node "$SCRIPT_DIR/artifact-utils.mjs" list \
    --artifact-root "$ARTIFACT_ROOT" \
    --workspace-root "$WORKSPACE_ROOT" \
    --app-root "$REGRESSION_APP_ROOT" \
    --format tsv
)
