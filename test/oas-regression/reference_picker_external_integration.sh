#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERATOR_ROOT="${GENERATOR_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
source "$SCRIPT_DIR/node-runtime.sh"
source "$SCRIPT_DIR/form-crud-gui-dependencies.sh"

TOPOLOGY_READER="$SCRIPT_DIR/reference-picker-topology.mjs"
GUI_SMOKE="$SCRIPT_DIR/reference-picker-admin-gui.mjs"
SECRET_POLICY="$SCRIPT_DIR/reference-picker-secret-policy.mjs"
GENERATOR_NODE_BIN="$(resolve_generator_node_bin "${GENERATOR_NODE_BIN:-}")"
NODE="$GENERATOR_NODE_BIN/node"
VALIDATE_ONLY=false

if [[ "${1:-}" == "--validate-only" ]]; then
  VALIDATE_ONLY=true
  shift
fi

if [[ "${1:-}" == "--config" ]]; then
  shift
fi

TOPOLOGY_FILE="${1:-${REFERENCE_PICKER_TOPOLOGY_FILE:-}}"
if [[ -z "$TOPOLOGY_FILE" ]]; then
  echo "Usage: reference_picker_external_integration.sh [--validate-only] [--config] <topology.json>" >&2
  exit 2
fi

require_file() {
  [[ -f "$1" ]] || {
    echo "Required file not found: $1" >&2
    exit 2
  }
}

require_file "$TOPOLOGY_FILE"
require_file "$TOPOLOGY_READER"
require_file "$GUI_SMOKE"
require_file "$SECRET_POLICY"

normalized_file="$(mktemp "${TMPDIR:-/tmp}/reference-picker-topology.XXXXXX.json")"
"$NODE" "$TOPOLOGY_READER" "$TOPOLOGY_FILE" > "$normalized_file"

if [[ "$VALIDATE_ONLY" == "true" ]]; then
  cat "$normalized_file"
  rm -f "$normalized_file"
  exit 0
fi

OUTPUT_DIR="${OUTPUT_DIR:-$(jq -er '.outputDirectory' "$normalized_file")}"
START_TIMEOUT_SECONDS="$(jq -er '.timeoutSeconds' "$normalized_file")"
FORM_CRUD_GUI_NODE_BIN="$GENERATOR_NODE_BIN"
FORM_CRUD_GUI_PLAYWRIGHT_ROOT="${FORM_CRUD_GUI_PLAYWRIGHT_ROOT:-/tmp/playwright-tests}"
FORM_CRUD_GUI_PLAYWRIGHT_INSTALL="${FORM_CRUD_GUI_PLAYWRIGHT_INSTALL:-offline}"
FORM_CRUD_GUI_PLAYWRIGHT_PACKAGE="${FORM_CRUD_GUI_PLAYWRIGHT_PACKAGE:-@playwright/test}"
FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS="${FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS:-}"
if [[ -z "$FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS" ]]; then
  if [[ "$FORM_CRUD_GUI_PLAYWRIGHT_INSTALL" == "online" ]]; then
    FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS="online"
  else
    FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS="skip"
  fi
fi
FORM_CRUD_GUI_PLAYWRIGHT_BROWSER="${FORM_CRUD_GUI_PLAYWRIGHT_BROWSER:-chromium}"
FORM_CRUD_GUI_SOURCE_COVERAGE_ENABLED=false
FORM_CRUD_GUI_SOURCE_COVERAGE_PACKAGES=""
FORM_CRUD_GUI_SOURCE_COVERAGE_WORKER=""
FORM_CRUD_GUI_SMOKE="$GUI_SMOKE"
FORM_CRUD_GUI_HEADLESS="${FORM_CRUD_GUI_HEADLESS:-true}"
FORM_CRUD_GUI_TIMEOUT_MS="${FORM_CRUD_GUI_TIMEOUT_MS:-30000}"
GUI_NPM_INSTALL="${GUI_NPM_INSTALL:-offline}"
GUI_NODE_OPTIONS="${GUI_NODE_OPTIONS:---max-old-space-size=4096}"

mkdir -p "$OUTPUT_DIR"
FAILURE_FILE="$OUTPUT_DIR/failure.json"
rm -f "$OUTPUT_DIR/status.json" "$OUTPUT_DIR/gui/status.json" "$FAILURE_FILE"
cp "$normalized_file" "$OUTPUT_DIR/topology.json"

start_epoch="$(date +%s)"
start_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
source_pid=""
target_pid=""
gui_pid=""
source_db_started=false
target_db_started=false
failure_stage="preflight"
failure_log="$OUTPUT_DIR/status.json"

record_failure() {
  local exit_code="$1"
  local command="$2"
  local line="$3"
  local failure_tmp="$FAILURE_FILE.tmp.$$"

  printf 'Failed stage=%q command=%q exit_code=%d log=%q\n' \
    "$failure_stage" "$command" "$exit_code" "$failure_log" >&2
  if [[ ! -f "$FAILURE_FILE" ]]; then
    if jq -n \
      --arg stage "$failure_stage" \
      --arg command "$command" \
      --argjson exitCode "$exit_code" \
      --arg logPath "$failure_log" \
      --argjson line "$line" \
      '{stage:$stage,command:$command,exitCode:$exitCode,logPath:$logPath,line:$line}' \
      > "$failure_tmp"; then
      mv "$failure_tmp" "$FAILURE_FILE"
    else
      printf 'Could not write structured failure record to %s\n' "$FAILURE_FILE" >&2
      rm -f "$failure_tmp"
    fi
  fi
}

on_error() {
  local exit_code=$? command=$BASH_COMMAND line=${BASH_LINENO[0]:-0}
  trap - ERR
  record_failure "$exit_code" "$command" "$line"
}

set_failure_context() {
  failure_stage="$1"
  failure_log="$2"
}

now_epoch() {
  date +%s
}

duration_seconds() {
  printf '%s\n' "$(($2 - $1))"
}

timestamped_step() {
  printf '=== [%s] %s at %s ===\n' "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

json_value() {
  local expression="$1"
  jq -er "$expression" "$normalized_file"
}

source_app_dir="$(json_value '.source.directory')"
target_app_dir="$(json_value '.target.directory')"
source_base_url="$(json_value '.source.baseUrl')"
target_base_url="$(json_value '.target.baseUrl')"
ui_base_url="$(json_value '.ui.baseUrl')"
source_app_port="$(json_value '.source.port')"
target_app_port="$(json_value '.target.port')"
ui_port="$(json_value '.ui.port')"
source_db_container="$(json_value '.source.database.container')"
target_db_container="$(json_value '.target.database.container')"
source_db_port="$(json_value '.source.database.port')"
target_db_port="$(json_value '.target.database.port')"
source_db_name="$(json_value '.source.database.name')"
target_db_name="$(json_value '.target.database.name')"
source_db_user="$(json_value '.source.database.user')"
target_db_user="$(json_value '.target.database.user')"

terminate_group() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" >/dev/null 2>&1 || break
      sleep 1
    done
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
    wait "$pid" 2>/dev/null || true
  fi
  ! kill -0 "$pid" >/dev/null 2>&1
}

container_absent() {
  ! docker container inspect "$1" >/dev/null 2>&1
}

cleanup() {
  local exit_code="$1"
  local exit_command="$2"
  local exit_line="$3"
  local applications_stopped=true
  local databases_removed=true
  trap - ERR EXIT INT TERM

  if [[ "$exit_code" != "0" && ! -f "$FAILURE_FILE" ]]; then
    record_failure "$exit_code" "$exit_command" "$exit_line"
  fi

  terminate_group "$gui_pid" || applications_stopped=false
  terminate_group "$target_pid" || applications_stopped=false
  terminate_group "$source_pid" || applications_stopped=false

  if [[ "$target_db_started" == "true" ]]; then
    docker rm -f "$target_db_container" >/dev/null 2>&1 || databases_removed=false
  fi
  if [[ "$source_db_started" == "true" ]]; then
    docker rm -f "$source_db_container" >/dev/null 2>&1 || databases_removed=false
  fi
  container_absent "$target_db_container" || databases_removed=false
  container_absent "$source_db_container" || databases_removed=false
  rm -f "$OUTPUT_DIR/source-token" "$OUTPUT_DIR/target-token" "$normalized_file"

  if [[ ! -f "$OUTPUT_DIR/status.json" ]]; then
    local end_epoch end_iso
    end_epoch="$(date +%s)"
    end_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    jq -n \
      --arg status "failed" \
      --arg startIso "$start_iso" \
      --arg endIso "$end_iso" \
      --argjson durationSeconds "$((end_epoch - start_epoch))" \
      --argjson exitCode "$exit_code" \
      '{status:$status,startIso:$startIso,endIso:$endIso,durationSeconds:$durationSeconds,exitCode:$exitCode}' \
      > "$OUTPUT_DIR/status.json"
  fi

  local updated_status
  local cleanup_ok=false
  local failure_json=null
  if [[ "$applications_stopped" == "true" && "$databases_removed" == "true" ]]; then
    cleanup_ok=true
  fi
  if [[ -f "$FAILURE_FILE" ]]; then
    failure_json="$(<"$FAILURE_FILE")"
  fi
  updated_status="$(mktemp "${TMPDIR:-/tmp}/reference-picker-status.XXXXXX.json")"
  jq \
    --argjson cleanupOk "$cleanup_ok" \
    --argjson applicationsStopped "$applications_stopped" \
    --argjson databasesRemoved "$databases_removed" \
    --arg sourceContainer "$source_db_container" \
    --arg targetContainer "$target_db_container" \
    --argjson failure "$failure_json" \
    '.cleanup = {
        status: (if $cleanupOk then "passed" else "failed" end),
        applicationsStopped: $applicationsStopped,
        databasesRemoved: $databasesRemoved,
        containers: [$sourceContainer, $targetContainer]
      }
      | if $failure == null then . else .failure = $failure end' \
    "$OUTPUT_DIR/status.json" > "$updated_status"
  mv "$updated_status" "$OUTPUT_DIR/status.json"

  if [[ "$cleanup_ok" != "true" && "$exit_code" == "0" ]]; then
    exit_code=1
  fi
  exit "$exit_code"
}
trap on_error ERR
trap 'cleanup "$?" "$BASH_COMMAND" "$LINENO"' EXIT INT TERM

set_failure_context "preflight" "$OUTPUT_DIR/status.json"
for required_path in "$source_app_dir/mvnw" "$target_app_dir/mvnw"; do
  require_file "$required_path"
done

set_failure_context "reference picker GUI dependencies" "$OUTPUT_DIR/status.json"
ensure_form_crud_gui_playwright_dependencies "reference-picker-external" "$source_app_dir"
set_failure_context "preflight" "$OUTPUT_DIR/status.json"

require_port_free() {
  local port="$1"
  local label="$2"
  if ss -ltnH "sport = :$port" | grep -q .; then
    echo "$label port $port is already in use" >&2
    exit 2
  fi
}

require_container_absent() {
  local container="$1"
  if ! container_absent "$container"; then
    echo "Configured PostgreSQL container already exists: $container" >&2
    exit 2
  fi
}

require_port_free "$source_app_port" "Source application"
require_port_free "$target_app_port" "Target application"
require_port_free "$ui_port" "Source UI"
require_port_free "$source_db_port" "Source PostgreSQL"
require_port_free "$target_db_port" "Target PostgreSQL"
require_container_absent "$source_db_container"
require_container_absent "$target_db_container"

wait_for_database() {
  local container="$1"
  local user="$2"
  local database="$3"
  local deadline=$((SECONDS + START_TIMEOUT_SECONDS))
  until docker exec "$container" pg_isready -U "$user" -d "$database" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for PostgreSQL container $container database $database" >&2
      exit 1
    fi
    sleep 2
  done
}

start_database() {
  local role="$1"
  local container image host port user password database
  container="$(json_value ".$role.database.container")"
  image="$(json_value ".$role.database.image")"
  host="$(json_value ".$role.database.host")"
  port="$(json_value ".$role.database.port")"
  user="$(json_value ".$role.database.user")"
  password="$(jq -r ".$role.database.password" "$normalized_file")"
  database="$(json_value ".$role.database.name")"

  local environment=(-e "POSTGRES_USER=$user" -e "POSTGRES_DB=$database")
  if [[ -n "$password" ]]; then
    environment+=(-e "POSTGRES_PASSWORD=$password")
  else
    environment+=(-e POSTGRES_HOST_AUTH_METHOD=trust)
  fi
  docker run \
    --name "$container" \
    "${environment[@]}" \
    -p "$host:$port:5432" \
    -d "$image" > "$OUTPUT_DIR/$role-db-container.txt"
  if [[ "$role" == "source" ]]; then
    source_db_started=true
  else
    target_db_started=true
  fi
  wait_for_database "$container" "$user" "$database"
}

wait_for_health() {
  local role="$1"
  local pid="$2"
  local log_file="$3"
  local base_url health_path health_file deadline
  base_url="$(json_value ".$role.baseUrl")"
  health_path="$(json_value ".$role.healthPath")"
  health_file="$OUTPUT_DIR/$role-health.json"
  deadline=$((SECONDS + START_TIMEOUT_SECONDS))
  until curl -fsS --max-time 5 "$base_url$health_path" > "$health_file" 2>/dev/null; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "$role application stopped before becoming healthy at $base_url$health_path" >&2
      tail -100 "$log_file" >&2 || true
      exit 1
    fi
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for $role application health at $base_url$health_path" >&2
      tail -100 "$log_file" >&2 || true
      exit 1
    fi
    sleep 2
  done
}

LAST_PID=""
start_application() {
  local role="$1"
  local directory app_port db_host db_port db_name db_user db_password log_file
  local command=()
  local custom_environment=()
  directory="$(json_value ".$role.directory")"
  app_port="$(json_value ".$role.port")"
  db_host="$(json_value ".$role.database.host")"
  db_port="$(json_value ".$role.database.port")"
  db_name="$(json_value ".$role.database.name")"
  db_user="$(json_value ".$role.database.user")"
  db_password="$(jq -r ".$role.database.password" "$normalized_file")"
  log_file="$OUTPUT_DIR/$role-app.log"
  mapfile -t command < <(jq -er ".$role.startCommand[]" "$normalized_file")
  mapfile -t custom_environment < <(jq -r ".$role.environment | to_entries[] | \"\\(.key)=\\(.value)\"" "$normalized_file")

  (
    cd "$directory"
    exec setsid env \
      "SERVER_PORT=$app_port" \
      "SPRING_DATASOURCE_URL=jdbc:postgresql://$db_host:$db_port/$db_name" \
      "SPRING_DATASOURCE_USERNAME=$db_user" \
      "SPRING_DATASOURCE_PASSWORD=$db_password" \
      "SPRING_PROFILES_ACTIVE=dev,api-docs" \
      "SPRING_DOCKER_COMPOSE_ENABLED=false" \
      "SPRING_LIQUIBASE_CONTEXTS=dev" \
      "LIQUIBASE_ANALYTICS_ENABLED=false" \
      "${custom_environment[@]}" \
      "${command[@]}"
  ) > "$log_file" 2>&1 < /dev/null &
  LAST_PID=$!
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local log_file="$3"
  local pid="$4"
  local deadline=$((SECONDS + START_TIMEOUT_SECONDS))
  until curl -fsS --max-time 5 "$url" >/dev/null 2>&1; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "$label stopped before becoming ready at $url" >&2
      tail -100 "$log_file" >&2 || true
      exit 1
    fi
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for $label at $url" >&2
      tail -100 "$log_file" >&2 || true
      exit 1
    fi
    sleep 2
  done
}

authenticate() {
  local role="$1"
  local base_url output_file request_file token_field deadline token
  base_url="$(json_value ".$role.baseUrl")"
  output_file="$OUTPUT_DIR/$role-token"
  request_file="$OUTPUT_DIR/$role-auth-request.json"
  token_field="$(json_value '.authentication.tokenField')"
  jq -n \
    --arg username "$(json_value '.authentication.username')" \
    --arg password "$(json_value '.authentication.password')" \
    '{username:$username,password:$password,rememberMe:false}' > "$request_file"
  deadline=$((SECONDS + START_TIMEOUT_SECONDS))
  token=""
  while [[ -z "$token" ]]; do
    token="$(
      curl -fsS --max-time 10 \
        -X POST "$base_url$(json_value '.authentication.path')" \
        -H 'Content-Type: application/json' \
        --data-binary "@$request_file" 2>/dev/null |
        jq -r --arg field "$token_field" '.[$field] // empty'
    )" || true
    if [[ -n "$token" ]]; then
      printf '%s' "$token" > "$output_file"
      chmod 600 "$output_file"
      rm -f "$request_file"
      return 0
    fi
    if (( SECONDS >= deadline )); then
      rm -f "$request_file"
      echo "Timed out authenticating to $role application at $base_url" >&2
      exit 1
    fi
    sleep 2
  done
}

seed_application() {
  local role="$1"
  local base_url method request_path content_type body_file response_file status_file token status
  base_url="$(json_value ".$role.baseUrl")"
  method="$(json_value ".$role.seed.method")"
  request_path="$(json_value ".$role.seed.path")"
  content_type="$(json_value ".$role.seed.contentType")"
  body_file="$OUTPUT_DIR/$role-seed-request.json"
  response_file="$OUTPUT_DIR/$role-seed-response.json"
  status_file="$OUTPUT_DIR/$role-seed-status.txt"
  token="$(<"$OUTPUT_DIR/$role-token")"
  jq ".$role.seed.body" "$normalized_file" > "$body_file"
  status="$(
    curl -sS --max-time 60 \
      -o "$response_file" \
      -w '%{http_code}' \
      -X "$method" "$base_url$request_path" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: $content_type" \
      --data-binary "@$body_file"
  )"
  printf '%s\n' "$status" > "$status_file"
  if ! jq -e --argjson status "$status" ".$role.seed.expectedStatuses | index(\$status) != null" "$normalized_file" >/dev/null; then
    echo "$role seed request returned unexpected HTTP $status" >&2
    cat "$response_file" >&2
    exit 1
  fi
  if ! jq -e --arg identity_path "$(json_value ".$role.identityPath")" '
    getpath($identity_path | split(".")) != null and (getpath($identity_path | split(".")) | tostring | length) > 0
  ' "$response_file" >/dev/null; then
    echo "$role seed response did not contain configured identity path $(json_value ".$role.identityPath")" >&2
    cat "$response_file" >&2
    exit 1
  fi
}

ensure_angular_dependencies() {
  if [[ -d "$source_app_dir/node_modules/@angular" ]]; then
    return 0
  fi
  case "$GUI_NPM_INSTALL" in
    offline)
      (
        cd "$source_app_dir"
        env PATH="$GENERATOR_NODE_BIN:$PATH" CI=true NG_CLI_ANALYTICS=false NODE_OPTIONS="$GUI_NODE_OPTIONS" NO_UPDATE_NOTIFIER=1 \
          npm install --no-audit --no-fund --offline
      ) > "$OUTPUT_DIR/source-npm-install.log" 2>&1
      ;;
    online)
      (
        cd "$source_app_dir"
        env PATH="$GENERATOR_NODE_BIN:$PATH" CI=true NG_CLI_ANALYTICS=false NODE_OPTIONS="$GUI_NODE_OPTIONS" NO_UPDATE_NOTIFIER=1 \
          npm install --no-audit --no-fund
      ) > "$OUTPUT_DIR/source-npm-install.log" 2>&1
      ;;
    skip)
      echo "Source Angular dependencies are absent and GUI_NPM_INSTALL=skip" >&2
      exit 2
      ;;
    *)
      echo "Unsupported GUI_NPM_INSTALL=$GUI_NPM_INSTALL; use offline, online, or skip." >&2
      exit 2
      ;;
  esac
}

set_failure_context "source database startup" "$OUTPUT_DIR/source-db-container.txt"
start_database source
set_failure_context "target database startup" "$OUTPUT_DIR/target-db-container.txt"
start_database target

set_failure_context "source application startup" "$OUTPUT_DIR/source-app.log"
start_application source
source_pid="$LAST_PID"
wait_for_health source "$source_pid" "$OUTPUT_DIR/source-app.log"
authenticate source

set_failure_context "target application startup" "$OUTPUT_DIR/target-app.log"
start_application target
target_pid="$LAST_PID"
wait_for_health target "$target_pid" "$OUTPUT_DIR/target-app.log"
authenticate target

set_failure_context "database preconditions" "$OUTPUT_DIR/preconditions.json"
source_db_actual="$(
  docker exec "$source_db_container" psql -U "$source_db_user" -d "$source_db_name" -Atc 'SELECT current_database();'
)"
target_db_actual="$(
  docker exec "$target_db_container" psql -U "$target_db_user" -d "$target_db_name" -Atc 'SELECT current_database();'
)"
[[ "$source_db_actual" == "$source_db_name" ]] || {
  echo "Source PostgreSQL database mismatch: expected $source_db_name, got $source_db_actual" >&2
  exit 1
}
[[ "$target_db_actual" == "$target_db_name" ]] || {
  echo "Target PostgreSQL database mismatch: expected $target_db_name, got $target_db_actual" >&2
  exit 1
}

jq -n \
  --arg sourceName "$(json_value '.source.name')" \
  --argjson sourcePort "$source_app_port" \
  --arg sourceHealthUrl "$source_base_url$(json_value '.source.healthPath')" \
  --slurpfile sourceHealth "$OUTPUT_DIR/source-health.json" \
  --arg sourceDatabaseContainer "$source_db_container" \
  --arg sourceDatabase "$source_db_actual" \
  --arg targetName "$(json_value '.target.name')" \
  --argjson targetPort "$target_app_port" \
  --arg targetHealthUrl "$target_base_url$(json_value '.target.healthPath')" \
  --slurpfile targetHealth "$OUTPUT_DIR/target-health.json" \
  --arg targetDatabaseContainer "$target_db_container" \
  --arg targetDatabase "$target_db_actual" \
  '{
    source: {
      name:$sourceName,
      port:$sourcePort,
      databaseContainer:$sourceDatabaseContainer,
      database:$sourceDatabase,
      health:{url:$sourceHealthUrl,response:$sourceHealth[0]}
    },
    target: {
      name:$targetName,
      port:$targetPort,
      databaseContainer:$targetDatabaseContainer,
      database:$targetDatabase,
      health:{url:$targetHealthUrl,response:$targetHealth[0]}
    },
    distinctApplicationPorts:($sourcePort != $targetPort),
    distinctDatabaseContainers:($sourceDatabaseContainer != $targetDatabaseContainer),
    distinctDatabases:($sourceDatabase != $targetDatabase)
  }' > "$OUTPUT_DIR/preconditions.json"

cat "$OUTPUT_DIR/preconditions.json"

set_failure_context "target seed" "$OUTPUT_DIR/target-seed-response.json"
seed_application target
set_failure_context "source seed" "$OUTPUT_DIR/source-seed-response.json"
seed_application source
set_failure_context "source Angular dependencies" "$OUTPUT_DIR/source-npm-install.log"
ensure_angular_dependencies

set_failure_context "source Angular startup" "$OUTPUT_DIR/source-angular.log"
jq -n \
  --arg target "$source_base_url" \
  '{"^/(api|management|v3/api-docs)": {target:$target, xfwd:true}}' \
  > "$OUTPUT_DIR/source-proxy.json"

(
  cd "$source_app_dir"
  exec setsid env \
    PATH="$GENERATOR_NODE_BIN:$PATH" \
    CI=true \
    NG_CLI_ANALYTICS=false \
    NODE_OPTIONS="$GUI_NODE_OPTIONS" \
    NO_UPDATE_NOTIFIER=1 \
    npm start -- --host "$(json_value '.ui.host')" --port "$ui_port" --proxy-config "$OUTPUT_DIR/source-proxy.json"
) > "$OUTPUT_DIR/source-angular.log" 2>&1 < /dev/null &
gui_pid=$!
wait_for_url "$ui_base_url" "source Angular application" "$OUTPUT_DIR/source-angular.log" "$gui_pid"

set_failure_context "reference picker GUI smoke" "$OUTPUT_DIR/gui/status.json"
env \
  FORM_CRUD_GUI_PLAYWRIGHT_ROOT="$FORM_CRUD_GUI_PLAYWRIGHT_ROOT" \
  FORM_CRUD_GUI_HEADLESS="$FORM_CRUD_GUI_HEADLESS" \
  FORM_CRUD_GUI_TIMEOUT_MS="$FORM_CRUD_GUI_TIMEOUT_MS" \
  REFERENCE_PICKER_SOURCE_SEED_RESPONSE="$OUTPUT_DIR/source-seed-response.json" \
  REFERENCE_PICKER_TARGET_SEED_RESPONSE="$OUTPUT_DIR/target-seed-response.json" \
  REFERENCE_PICKER_TARGET_TOKEN_FILE="$OUTPUT_DIR/target-token" \
  "$NODE" "$GUI_SMOKE" "$normalized_file" "$OUTPUT_DIR/gui" > "$OUTPUT_DIR/gui-run.log"

set_failure_context "reference picker GUI result" "$OUTPUT_DIR/gui/status.json"
gui_status="$(jq -r '.status' "$OUTPUT_DIR/gui/status.json")"
[[ "$gui_status" == "passed" ]] || {
  cat "$OUTPUT_DIR/gui/status.json" >&2
  exit 1
}

set_failure_context "secret exposure check" "$OUTPUT_DIR/gui-run.log"
secret_scan_status=0
"$NODE" "$SECRET_POLICY" --scan-artifacts \
  "$OUTPUT_DIR/source-app.log" "$OUTPUT_DIR/target-app.log" "$OUTPUT_DIR/source-angular.log" "$OUTPUT_DIR/gui-run.log" \
  || secret_scan_status=$?
if [[ "$secret_scan_status" -eq 0 ]]; then
  echo "Application or harness logs exposed a JWT value" >&2
  exit 1
fi
if [[ "$secret_scan_status" -ne 1 ]]; then
  echo "Application or harness logs could not be scanned for JWT values" >&2
  exit 1
fi

set_failure_context "final status" "$OUTPUT_DIR/status.json"
end_epoch="$(date +%s)"
end_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -n \
  --arg status "passed" \
  --arg startIso "$start_iso" \
  --arg endIso "$end_iso" \
  --argjson durationSeconds "$((end_epoch - start_epoch))" \
  --slurpfile preconditions "$OUTPUT_DIR/preconditions.json" \
  --slurpfile workflow "$OUTPUT_DIR/gui/status.json" \
  '{
    status:$status,
    startIso:$startIso,
    endIso:$endIso,
    durationSeconds:$durationSeconds,
    preconditions:$preconditions[0],
    workflow:$workflow[0]
  }' > "$OUTPUT_DIR/status.json"

cat "$OUTPUT_DIR/status.json"
