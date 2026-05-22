#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERATOR_ROOT="${GENERATOR_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "$GENERATOR_ROOT/.." && pwd)}"
ARTIFACTS="${ARTIFACT_ROOT:-$WORKSPACE_ROOT/oas-to-jdl/artifacts}"
SMOKE="$SCRIPT_DIR/openapi-smoke.mjs"
DB_VERIFY_SQL="$SCRIPT_DIR/tmf683-db-verify.sql"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/generator-jhipster-regression}"
TMF_PAYLOAD="${TMF_PAYLOAD:-$GENERATOR_ROOT/party-interaction-full.json}"
REGRESSION_APP_ROOT="${REGRESSION_APP_ROOT:-$WORKSPACE_ROOT}"
PORT="${PORT:-8081}"
LIQUIBASE_CONTEXTS="${LIQUIBASE_CONTEXTS:-dev}"
mkdir -p "$OUTPUT_DIR"

cleanup_app() {
  local pid="${1:-}"
  local app_dir="${2:-}"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
  fi
  for _ in $(seq 1 20); do
    if ! ss -tlnp | grep -q ":$PORT "; then
      break
    fi
    sleep 1
  done
  local listener_pids
  listener_pids=$(ss -tlnp | sed -nE "s/.*:${PORT} .*pid=([0-9]+).*/\1/p" | sort -u)
  for listener_pid in $listener_pids; do
    kill "$listener_pid" >/dev/null 2>&1 || true
  done
  if [[ -n "$app_dir" && -f "$app_dir/src/main/docker/postgresql.yml" ]]; then
    (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml down -v --remove-orphans < /dev/null)
  fi
}

wait_for_db() {
  local app_dir="$1"
  local db_user="$2"
  for _ in $(seq 1 60); do
    if (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml exec -T postgresql pg_isready -U "$db_user") >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "PostgreSQL did not become ready for $app_dir" >&2
  return 1
}

wait_for_app() {
  local log_file="$1"
  for _ in $(seq 1 120); do
    if grep -q "Started .*App" "$log_file" 2>/dev/null; then
      local code
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/management/health" || true)
      if [[ "$code" == "200" || "$code" == "401" || "$code" == "403" ]]; then
        return 0
      fi
    fi
    if grep -q "APPLICATION FAILED TO START" "$log_file" 2>/dev/null; then
      tail -n 200 "$log_file" >&2
      return 1
    fi
    sleep 2
  done
  echo "Spring Boot did not become reachable on port $PORT" >&2
  tail -n 200 "$log_file" >&2
  return 1
}

authenticate() {
  local token
  token=$(curl -s -X POST "http://localhost:$PORT/api/authenticate" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin"}' | jq -r '.id_token // empty')
  if [[ -z "$token" || "$token" == "null" ]]; then
    echo "Authentication failed on port $PORT" >&2
    return 1
  fi
  printf '%s\n' "$token"
}

if [[ -f "$TMF_PAYLOAD" ]]; then
  jq . "$TMF_PAYLOAD" >/dev/null
fi

while IFS=$'\t' read -r name app_dir _jdl_file yaml_file db_user db_name _base_name <&3; do
  if [[ -z "$name" ]]; then
    continue
  fi
  artifact_output_dir="$OUTPUT_DIR/$name"
  case "$artifact_output_dir" in
    "$OUTPUT_DIR"/*) rm -rf "$artifact_output_dir" ;;
    *)
      echo "Refusing to clean unexpected output directory: $artifact_output_dir" >&2
      exit 1
      ;;
  esac
  mkdir -p "$artifact_output_dir"
  log_file="$artifact_output_dir/app.log"
  smoke_file="$artifact_output_dir/smoke.json"
  app_pid=""
  trap 'cleanup_app "$app_pid" "$app_dir"' EXIT

  echo "=== [$name] reset PostgreSQL ==="
  (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml down -v --remove-orphans < /dev/null)
  (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml up -d < /dev/null)
  wait_for_db "$app_dir" "$db_user"

  echo "=== [$name] start Spring Boot ==="
  rm -f "$log_file"
  (
    cd "$app_dir"
    SPRING_PROFILES_ACTIVE=dev,api-docs SPRING_DOCKER_COMPOSE_ENABLED=false SPRING_LIQUIBASE_CONTEXTS="$LIQUIBASE_CONTEXTS" ./mvnw -P'!webapp' spring-boot:run -Dskip.npm=true -DskipTests=true -Dmaven.test.skip=true >"$log_file" 2>&1 < /dev/null
  ) &
  app_pid=$!
  wait_for_app "$log_file"

  echo "=== [$name] authenticate ==="
  token=$(authenticate)
  echo "auth=ok"

  echo "=== [$name] YAML smoke ==="
  node "$SMOKE" "$yaml_file" "http://localhost:$PORT/api" "$token" "$name" "$artifact_output_dir" < /dev/null | tee "$smoke_file"

  if [[ "$yaml_file" == *"TMF683-Party_Interaction"* && -f "$TMF_PAYLOAD" ]]; then
    echo "=== [tmf683] exact deep PartyInteraction POST ==="
    TOKEN="$token"
    export TOKEN
    curl -sS -i -X POST "http://localhost:$PORT/api/partyInteraction" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      --data @"$TMF_PAYLOAD" | tee "$OUTPUT_DIR/tmf683-partyinteraction-response.txt"
    status=$(awk 'NR==1 {print $2}' "$OUTPUT_DIR/tmf683-partyinteraction-response.txt")
    if [[ "$status" != "201" ]]; then
      echo "Expected TMF683 PartyInteraction POST to return 201, got $status" >&2
      tail -n 200 "$log_file" >&2
      exit 1
    fi

    echo "=== [tmf683] database verification snapshot ==="
    (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml exec -T postgresql \
      psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1) \
      < "$DB_VERIFY_SQL" | tee "$OUTPUT_DIR/tmf683-db-verification.txt"
  fi

  cleanup_app "$app_pid" "$app_dir"
  app_pid=""
  trap - EXIT
done 3< <(
  node "$SCRIPT_DIR/artifact-utils.mjs" list \
    --artifact-root "$ARTIFACTS" \
    --workspace-root "$WORKSPACE_ROOT" \
    --app-root "$REGRESSION_APP_ROOT" \
    --format tsv
)
