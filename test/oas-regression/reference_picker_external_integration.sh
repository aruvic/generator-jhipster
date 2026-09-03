#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GUI_SMOKE="$SCRIPT_DIR/reference-picker-admin-gui.mjs"

CONFIG_APP_DIR="${CONFIG_APP_DIR:-$WORKSPACE_DIR/test-form-crud-reference-picker-config-api-app}"
CONSUMER_APP_DIR="${CONSUMER_APP_DIR:-$WORKSPACE_DIR/test-oas3v1-simple-app}"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/generator-jhipster-regression/reference-picker-external-integration}"
CONFIG_APP_PORT="${CONFIG_APP_PORT:-8082}"
CONSUMER_APP_PORT="${CONSUMER_APP_PORT:-8081}"
CONFIG_DB_PORT="${CONFIG_DB_PORT:-5432}"
CONSUMER_DB_PORT="${CONSUMER_DB_PORT:-5433}"
CONFIG_DB_USER="${CONFIG_DB_USER:-oda_form}"
CONSUMER_DB_USER="${CONSUMER_DB_USER:-oda_oas3v1}"
CONFIG_DB_NAME="${CONFIG_DB_NAME:-$CONFIG_DB_USER}"
CONSUMER_DB_NAME="${CONSUMER_DB_NAME:-$CONSUMER_DB_USER}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:18.0}"
CONFIG_DB_CONTAINER="${CONFIG_DB_CONTAINER:-jhi-reference-picker-config-db}"
CONSUMER_DB_CONTAINER="${CONSUMER_DB_CONTAINER:-jhi-reference-picker-consumer-db}"
START_TIMEOUT_SECONDS="${START_TIMEOUT_SECONDS:-240}"
GUI_ENABLED="${GUI_ENABLED:-true}"
GUI_PORT="${GUI_PORT:-4201}"
GUI_NPM_INSTALL="${GUI_NPM_INSTALL:-offline}"
GUI_NODE_OPTIONS="${GUI_NODE_OPTIONS:---max-old-space-size=4096}"
FORM_CRUD_GUI_PLAYWRIGHT_ROOT="${FORM_CRUD_GUI_PLAYWRIGHT_ROOT:-/tmp/playwright-tests}"

CONFIG_BASE_URL="http://127.0.0.1:$CONFIG_APP_PORT"
CONSUMER_BASE_URL="http://127.0.0.1:$CONSUMER_APP_PORT"
GUI_BASE_URL="http://127.0.0.1:$GUI_PORT"
CONFIG_ENDPOINT="$CONFIG_BASE_URL/api/form-crud-reference-pickers"
CONSUMER_ENDPOINT="$CONSUMER_BASE_URL/api/form-crud-reference-pickers"
PICKER_ID="external-integration-picker"
UPDATED_LABEL="External integration picker updated in browser"

mkdir -p "$OUTPUT_DIR"

start_epoch="$(date +%s)"
start_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
config_pid=""
consumer_pid=""
gui_pid=""
completed=false

terminate_group() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  sleep 2
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  terminate_group "$gui_pid"
  terminate_group "$consumer_pid"
  terminate_group "$config_pid"
  docker rm -f "$CONSUMER_DB_CONTAINER" "$CONFIG_DB_CONTAINER" >/dev/null 2>&1 || true
  rm -f "$OUTPUT_DIR/config-token" "$OUTPUT_DIR/consumer-token"
  if [[ "$completed" != true && ! -f "$OUTPUT_DIR/status.json" ]]; then
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
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

require_file() {
  [[ -f "$1" ]] || {
    echo "Required file not found: $1" >&2
    exit 2
  }
}

require_file "$CONFIG_APP_DIR/mvnw"
require_file "$CONSUMER_APP_DIR/mvnw"
require_file "$GUI_SMOKE"

wait_for_database() {
  local container="$1"
  local user="$2"
  local deadline=$((SECONDS + START_TIMEOUT_SECONDS))
  until docker exec "$container" pg_isready -U "$user" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for PostgreSQL container $container" >&2
      exit 1
    fi
    sleep 2
  done
}

wait_for_health() {
  local base_url="$1"
  local label="$2"
  local deadline=$((SECONDS + START_TIMEOUT_SECONDS))
  until curl -fsS --max-time 5 "$base_url/management/health" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for $label at $base_url" >&2
      exit 1
    fi
    sleep 2
  done
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local log_file="$3"
  local pid="$4"
  local deadline=$((SECONDS + START_TIMEOUT_SECONDS))
  until curl -fsS --max-time 5 "$url" >/dev/null 2>&1; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "$label stopped before becoming ready" >&2
      tail -80 "$log_file" >&2 || true
      exit 1
    fi
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for $label at $url" >&2
      tail -80 "$log_file" >&2 || true
      exit 1
    fi
    sleep 2
  done
}

ensure_angular_dependencies() {
  [[ "$GUI_ENABLED" == "true" ]] || return 0
  if [[ -d "$CONSUMER_APP_DIR/node_modules/@angular" ]]; then
    return 0
  fi
  case "$GUI_NPM_INSTALL" in
    offline)
      (
        cd "$CONSUMER_APP_DIR"
        env CI=true NG_CLI_ANALYTICS=false NODE_OPTIONS="$GUI_NODE_OPTIONS" NO_UPDATE_NOTIFIER=1 npm install --no-audit --no-fund --offline
      ) > "$OUTPUT_DIR/consumer-npm-install.log" 2>&1
      ;;
    online)
      (
        cd "$CONSUMER_APP_DIR"
        env CI=true NG_CLI_ANALYTICS=false NODE_OPTIONS="$GUI_NODE_OPTIONS" NO_UPDATE_NOTIFIER=1 npm install --no-audit --no-fund
      ) > "$OUTPUT_DIR/consumer-npm-install.log" 2>&1
      ;;
    skip)
      echo "Consumer Angular dependencies are absent and GUI_NPM_INSTALL=skip" >&2
      exit 2
      ;;
    *)
      echo "Unsupported GUI_NPM_INSTALL=$GUI_NPM_INSTALL; use offline, online, or skip." >&2
      exit 2
      ;;
  esac
}

authenticate() {
  local base_url="$1"
  local output_file="$2"
  local deadline=$((SECONDS + START_TIMEOUT_SECONDS))
  local token=""
  while [[ -z "$token" ]]; do
    token="$(
      curl -fsS --max-time 10 \
        -X POST "$base_url/api/authenticate" \
        -H 'Content-Type: application/json' \
        --data '{"username":"admin","password":"admin","rememberMe":false}' 2>/dev/null |
        jq -r '.id_token // empty'
    )" || true
    if [[ -n "$token" ]]; then
      printf '%s' "$token" > "$output_file"
      chmod 600 "$output_file"
      return 0
    fi
    if (( SECONDS >= deadline )); then
      echo "Timed out authenticating to $base_url" >&2
      exit 1
    fi
    sleep 2
  done
}

docker rm -f "$CONSUMER_DB_CONTAINER" "$CONFIG_DB_CONTAINER" >/dev/null 2>&1 || true
docker run \
  --name "$CONFIG_DB_CONTAINER" \
  -e "POSTGRES_USER=$CONFIG_DB_USER" \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -p "127.0.0.1:$CONFIG_DB_PORT:5432" \
  -d "$POSTGRES_IMAGE" > "$OUTPUT_DIR/config-db-container.txt"
docker run \
  --name "$CONSUMER_DB_CONTAINER" \
  -e "POSTGRES_USER=$CONSUMER_DB_USER" \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -p "127.0.0.1:$CONSUMER_DB_PORT:5432" \
  -d "$POSTGRES_IMAGE" > "$OUTPUT_DIR/consumer-db-container.txt"
wait_for_database "$CONFIG_DB_CONTAINER" "$CONFIG_DB_USER"
wait_for_database "$CONSUMER_DB_CONTAINER" "$CONSUMER_DB_USER"

(
  cd "$CONFIG_APP_DIR"
  exec setsid env \
    SPRING_PROFILES_ACTIVE=dev,api-docs \
    SPRING_DOCKER_COMPOSE_ENABLED=false \
    SERVER_PORT="$CONFIG_APP_PORT" \
    SPRING_DATASOURCE_URL="jdbc:postgresql://127.0.0.1:$CONFIG_DB_PORT/$CONFIG_DB_NAME" \
    SPRING_DATASOURCE_USERNAME="$CONFIG_DB_USER" \
    SPRING_DATASOURCE_PASSWORD= \
    LIQUIBASE_ANALYTICS_ENABLED=false \
    ./mvnw -P'!webapp' spring-boot:run -Dskip.npm=true -DskipTests=true -Dmaven.test.skip=true
) > "$OUTPUT_DIR/config-app.log" 2>&1 &
config_pid=$!
wait_for_health "$CONFIG_BASE_URL" "config app"
authenticate "$CONFIG_BASE_URL" "$OUTPUT_DIR/config-token"
config_token="$(<"$OUTPUT_DIR/config-token")"

unauthenticated_status="$(
  curl -sS --max-time 10 -o "$OUTPUT_DIR/config-unauthenticated-response.json" -w '%{http_code}' "$CONFIG_ENDPOINT"
)"
[[ "$unauthenticated_status" == "401" ]] || {
  echo "Protected config API returned HTTP $unauthenticated_status without a token; expected 401" >&2
  exit 1
}

(
  cd "$CONSUMER_APP_DIR"
  exec setsid env \
    SPRING_PROFILES_ACTIVE=dev,api-docs \
    SPRING_DOCKER_COMPOSE_ENABLED=false \
    SERVER_PORT="$CONSUMER_APP_PORT" \
    SPRING_DATASOURCE_URL="jdbc:postgresql://127.0.0.1:$CONSUMER_DB_PORT/$CONSUMER_DB_NAME" \
    SPRING_DATASOURCE_USERNAME="$CONSUMER_DB_USER" \
    SPRING_DATASOURCE_PASSWORD= \
    FORM_CRUD_REFERENCE_PICKER_CONFIG_URL="$CONFIG_ENDPOINT" \
    FORM_CRUD_REFERENCE_PICKER_CONFIG_BEARER_TOKEN="$config_token" \
    FORM_CRUD_REFERENCE_PICKER_FORWARD_AUTHORIZATION=false \
    LIQUIBASE_ANALYTICS_ENABLED=false \
    ./mvnw -P'!webapp' spring-boot:run -Dskip.npm=true -DskipTests=true -Dmaven.test.skip=true
) > "$OUTPUT_DIR/consumer-app.log" 2>&1 &
consumer_pid=$!
wait_for_health "$CONSUMER_BASE_URL" "consumer app"
authenticate "$CONSUMER_BASE_URL" "$OUTPUT_DIR/consumer-token"
consumer_token="$(<"$OUTPUT_DIR/consumer-token")"

[[ "$consumer_token" != "$config_token" ]] || {
  echo "Consumer and config applications unexpectedly issued the same JWT" >&2
  exit 1
}

jq -n \
  --arg id "$PICKER_ID" \
  '[
    {
      id: $id,
      label: "External integration picker",
      formId: "patch-update-resource",
      targetApiId: "get-list-target-resources",
      sourcePath: "references",
      collectionPath: "/target-resources",
      displayFields: ["id", "name", "href"],
      copyFields: [
        {source: "id", target: "id"},
        {source: "name", target: "name"},
        {source: "href", target: "href"}
      ],
      mode: "reference",
      multiple: true
    }
  ]' > "$OUTPUT_DIR/request.json"

save_status="$(
  curl -sS --max-time 30 \
    -o "$OUTPUT_DIR/consumer-save-response.json" \
    -w '%{http_code}' \
    -X PUT "$CONSUMER_ENDPOINT" \
    -H "Authorization: Bearer $consumer_token" \
    -H 'Content-Type: application/json' \
    --data-binary "@$OUTPUT_DIR/request.json"
)"
[[ "$save_status" == "200" ]] || {
  echo "Consumer proxy save returned HTTP $save_status" >&2
  exit 1
}
jq -e --arg id "$PICKER_ID" 'length == 1 and .[0].id == $id and .[0].pickerId == $id' \
  "$OUTPUT_DIR/consumer-save-response.json" >/dev/null

curl -fsS --max-time 30 \
  -H "Authorization: Bearer $consumer_token" \
  "$CONSUMER_ENDPOINT" > "$OUTPUT_DIR/consumer-read-response.json"
jq -e --arg id "$PICKER_ID" 'length == 1 and .[0].id == $id and .[0].pickerId == $id' \
  "$OUTPUT_DIR/consumer-read-response.json" >/dev/null

gui_status="skipped"
if [[ "$GUI_ENABLED" == "true" ]]; then
  ensure_angular_dependencies
  (
    cd "$CONSUMER_APP_DIR"
    exec setsid env \
      CI=true \
      NG_CLI_ANALYTICS=false \
      NODE_OPTIONS="$GUI_NODE_OPTIONS" \
      NO_UPDATE_NOTIFIER=1 \
      npm start -- --host 127.0.0.1 --port "$GUI_PORT"
  ) > "$OUTPUT_DIR/consumer-angular.log" 2>&1 &
  gui_pid=$!
  wait_for_url "$GUI_BASE_URL" "consumer Angular application" "$OUTPUT_DIR/consumer-angular.log" "$gui_pid"
  env \
    FORM_CRUD_GUI_PLAYWRIGHT_ROOT="$FORM_CRUD_GUI_PLAYWRIGHT_ROOT" \
    FORM_CRUD_GUI_HEADLESS="${FORM_CRUD_GUI_HEADLESS:-true}" \
    FORM_CRUD_GUI_TIMEOUT_MS="${FORM_CRUD_GUI_TIMEOUT_MS:-30000}" \
    node "$GUI_SMOKE" "$GUI_BASE_URL" "$OUTPUT_DIR/gui" "$PICKER_ID" "$UPDATED_LABEL" \
    > "$OUTPUT_DIR/gui-run.log"
  gui_status="$(jq -r '.status' "$OUTPUT_DIR/gui/status.json")"
  [[ "$gui_status" == "passed" ]] || {
    cat "$OUTPUT_DIR/gui/status.json" >&2
    exit 1
  }

  curl -fsS --max-time 30 \
    -H "Authorization: Bearer $consumer_token" \
    "$CONSUMER_ENDPOINT" > "$OUTPUT_DIR/consumer-read-after-gui.json"
  jq -e --arg id "$PICKER_ID" --arg label "$UPDATED_LABEL" \
    'length == 1 and .[0].id == $id and .[0].pickerId == $id and .[0].label == $label' \
    "$OUTPUT_DIR/consumer-read-after-gui.json" >/dev/null
fi

curl -fsS --max-time 30 \
  -H "Authorization: Bearer $config_token" \
  "$CONFIG_ENDPOINT" > "$OUTPUT_DIR/config-read-response.json"
jq -e --arg id "$PICKER_ID" --arg label "$UPDATED_LABEL" --arg guiStatus "$gui_status" \
  'length == 1 and .[0].pickerId == $id and ($guiStatus != "passed" or .[0].label == $label)' \
  "$OUTPUT_DIR/config-read-response.json" >/dev/null

database_count="$(
  docker exec "$CONFIG_DB_CONTAINER" \
    psql -U "$CONFIG_DB_USER" -d "$CONFIG_DB_NAME" -Atc \
    "SELECT count(*) FROM form_crud_reference_picker_config WHERE picker_id::text = '$PICKER_ID';"
)"
[[ "$database_count" == "1" ]] || {
  echo "Expected one persisted picker row, found $database_count" >&2
  exit 1
}

if grep -Eq 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' \
  "$OUTPUT_DIR/config-app.log" "$OUTPUT_DIR/consumer-app.log" "$OUTPUT_DIR"/consumer-angular.log "$OUTPUT_DIR"/gui-run.log 2>/dev/null; then
  echo "Generated application logs exposed a JWT value" >&2
  exit 1
fi

end_epoch="$(date +%s)"
end_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -n \
  --arg status "passed" \
  --arg startIso "$start_iso" \
  --arg endIso "$end_iso" \
  --arg pickerId "$PICKER_ID" \
  --arg guiStatus "$gui_status" \
  --argjson durationSeconds "$((end_epoch - start_epoch))" \
  --argjson configUnauthenticatedStatus "$unauthenticated_status" \
  --argjson consumerSaveStatus "$save_status" \
  --argjson databaseRows "$database_count" \
  '{
    status:$status,
    startIso:$startIso,
    endIso:$endIso,
    durationSeconds:$durationSeconds,
    pickerId:$pickerId,
    distinctApplicationTokens:true,
    configUnauthenticatedStatus:$configUnauthenticatedStatus,
    consumerSaveStatus:$consumerSaveStatus,
    consumerReadVerified:true,
    configReadVerified:true,
    databaseRows:$databaseRows,
    guiStatus:$guiStatus,
    guiSaveVerified:($guiStatus == "passed"),
    guiReloadVerified:($guiStatus == "passed"),
    sensitiveLogValuesFound:false
  }' > "$OUTPUT_DIR/status.json"

rm -f "$OUTPUT_DIR/config-token" "$OUTPUT_DIR/consumer-token"
completed=true
cat "$OUTPUT_DIR/status.json"
