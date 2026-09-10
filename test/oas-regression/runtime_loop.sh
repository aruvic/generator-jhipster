#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/node-runtime.sh"
source "$SCRIPT_DIR/form-crud-gui-dependencies.sh"
source "$SCRIPT_DIR/persistence-profile-query.sh"
GENERATOR_ROOT="${GENERATOR_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "$GENERATOR_ROOT/.." && pwd)}"
ARTIFACTS="${ARTIFACT_ROOT:-$WORKSPACE_ROOT/oas-to-jdl/artifacts}"
SMOKE="$SCRIPT_DIR/openapi-smoke.mjs"
FORM_CRUD_GUI_SMOKE="$SCRIPT_DIR/form-crud-gui-smoke.mjs"
FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE="$SCRIPT_DIR/form-crud-reference-picker-config-service.mjs"
PERSISTENCE_PROFILES_FILE="${PERSISTENCE_PROFILES_FILE:-$SCRIPT_DIR/profiles/persistence.json}"
EVOMASTER_SEED_BUILDER="$SCRIPT_DIR/evomaster-postman-seed.mjs"
EVOMASTER_OPENAPI_EXAMPLE_BUILDER="$SCRIPT_DIR/evomaster-openapi-smoke-examples.mjs"
EVOMASTER_FOCUS_PATH_RESOLVER="$SCRIPT_DIR/evomaster-focus-path.mjs"
EVOMASTER_SEED_FILTER="$SCRIPT_DIR/evomaster-filter-postman-seed.mjs"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/generator-jhipster-regression}"
REGRESSION_APP_ROOT="${REGRESSION_APP_ROOT:-$WORKSPACE_ROOT}"
PORT="${PORT:-8081}"
LIQUIBASE_CONTEXTS="${LIQUIBASE_CONTEXTS:-dev}"
LIQUIBASE_ASYNC_START="${LIQUIBASE_ASYNC_START:-false}"
AUTHENTICATION_TIMEOUT_SECONDS="${AUTHENTICATION_TIMEOUT_SECONDS:-120}"
AUTHENTICATION_RETRY_SLEEP_SECONDS="${AUTHENTICATION_RETRY_SLEEP_SECONDS:-2}"
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

total_memory_mb() {
  awk '
    /MemTotal:/ { mem=$2 }
    /SwapTotal:/ { swap=$2 }
    END { print int((mem + swap) / 1024) }
  ' /proc/meminfo
}

artifact_matches_name_filter() {
  local name="$1"
  local regex="${ARTIFACT_NAME_REGEX,,}"

  [[ -z "$regex" || "${name,,}" =~ $regex ]]
}

default_generator_node_heap_mb() {
  local total_mb
  total_mb="$(total_memory_mb)"
  if [[ "$total_mb" -ge 24576 ]]; then
    echo 8192
  elif [[ "$total_mb" -ge 12288 ]]; then
    echo 6144
  else
    echo 4096
  fi
}

GENERATOR_NODE_OPTIONS="${GENERATOR_NODE_OPTIONS:---max-old-space-size=$(default_generator_node_heap_mb)}"
ANGULAR_NODE_OPTIONS="${ANGULAR_NODE_OPTIONS:-$GENERATOR_NODE_OPTIONS}"
EVOMASTER_ENABLED="${EVOMASTER_ENABLED:-true}"
FORM_CRUD_GUI_ENABLED="${FORM_CRUD_GUI_ENABLED:-true}"
ARTIFACT_NAME_REGEX="${ARTIFACT_NAME_REGEX:-}"
FORM_CRUD_GUI_PORT="${FORM_CRUD_GUI_PORT:-4201}"
FORM_CRUD_GUI_HOST="${FORM_CRUD_GUI_HOST:-0.0.0.0}"
FORM_CRUD_GUI_PUBLIC_HOST="${FORM_CRUD_GUI_PUBLIC_HOST:-localhost}"
FORM_CRUD_GUI_USERNAME="${FORM_CRUD_GUI_USERNAME:-admin}"
FORM_CRUD_GUI_PASSWORD="${FORM_CRUD_GUI_PASSWORD:-admin}"
FORM_CRUD_GUI_TIMEOUT_MS="${FORM_CRUD_GUI_TIMEOUT_MS:-30000}"
FORM_CRUD_GUI_HEADLESS="${FORM_CRUD_GUI_HEADLESS:-true}"
FORM_CRUD_GUI_NPM_INSTALL="${FORM_CRUD_GUI_NPM_INSTALL:-offline}"
FORM_CRUD_GUI_NPM_INSTALL_COMMAND="${FORM_CRUD_GUI_NPM_INSTALL_COMMAND:-npm install --no-audit --no-fund}"
FORM_CRUD_GUI_START_COMMAND="${FORM_CRUD_GUI_START_COMMAND:-npm start -- --host $FORM_CRUD_GUI_HOST --port $FORM_CRUD_GUI_PORT}"
FORM_CRUD_GUI_JEST_ENABLED="${FORM_CRUD_GUI_JEST_ENABLED:-true}"
FORM_CRUD_GUI_JEST_COMMAND="${FORM_CRUD_GUI_JEST_COMMAND:-npx ng test --coverage}"
FORM_CRUD_GUI_JEST_NODE_OPTIONS="${FORM_CRUD_GUI_JEST_NODE_OPTIONS:-${NODE_OPTIONS:-$ANGULAR_NODE_OPTIONS}}"
FORM_CRUD_GUI_JEST_TIMEOUT_SECONDS="${FORM_CRUD_GUI_JEST_TIMEOUT_SECONDS:-900}"
FORM_CRUD_GUI_JEST_TIMEOUT_KILL_AFTER_SECONDS="${FORM_CRUD_GUI_JEST_TIMEOUT_KILL_AFTER_SECONDS:-30}"
FORM_CRUD_GUI_NODE_OPTIONS="${FORM_CRUD_GUI_NODE_OPTIONS:-${NODE_OPTIONS:-$ANGULAR_NODE_OPTIONS}}"
FORM_CRUD_GUI_NODE_BIN="$(resolve_node_bin "${FORM_CRUD_GUI_NODE_BIN:-}")"
FORM_CRUD_GUI_RUN_TIMEOUT_SECONDS="${FORM_CRUD_GUI_RUN_TIMEOUT_SECONDS:-2400}"
FORM_CRUD_GUI_RUN_TIMEOUT_KILL_AFTER_SECONDS="${FORM_CRUD_GUI_RUN_TIMEOUT_KILL_AFTER_SECONDS:-30}"
FORM_CRUD_GUI_PLAYWRIGHT_ROOT="${FORM_CRUD_GUI_PLAYWRIGHT_ROOT:-/tmp/playwright-tests}"
FORM_CRUD_GUI_PLAYWRIGHT_INSTALL="${FORM_CRUD_GUI_PLAYWRIGHT_INSTALL:-offline}"
FORM_CRUD_GUI_PLAYWRIGHT_PACKAGE="${FORM_CRUD_GUI_PLAYWRIGHT_PACKAGE:-@playwright/test}"
FORM_CRUD_GUI_SOURCE_COVERAGE_PACKAGES="${FORM_CRUD_GUI_SOURCE_COVERAGE_PACKAGES:-@bcoe/v8-coverage v8-to-istanbul istanbul-lib-coverage istanbul-lib-report istanbul-reports}"
FORM_CRUD_GUI_SOURCE_COVERAGE_WORKER="$SCRIPT_DIR/form-crud-source-coverage.mjs"
FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS="${FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS:-}"
if [[ -z "$FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS" ]]; then
  if [[ "$FORM_CRUD_GUI_PLAYWRIGHT_INSTALL" == "online" ]]; then
    FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS="online"
  else
    FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS="skip"
  fi
fi
FORM_CRUD_GUI_PLAYWRIGHT_BROWSER="${FORM_CRUD_GUI_PLAYWRIGHT_BROWSER:-chromium}"
FORM_CRUD_GUI_FAIL_ON_CONSOLE_ERROR="${FORM_CRUD_GUI_FAIL_ON_CONSOLE_ERROR:-true}"
FORM_CRUD_GUI_FAIL_ON_HTTP_4XX="${FORM_CRUD_GUI_FAIL_ON_HTTP_4XX:-false}"
FORM_CRUD_GUI_FAIL_ON_INVALID_CREATE_FORM="${FORM_CRUD_GUI_FAIL_ON_INVALID_CREATE_FORM:-true}"
FORM_CRUD_GUI_FAIL_ON_CREATE_HTTP_ERROR="${FORM_CRUD_GUI_FAIL_ON_CREATE_HTTP_ERROR:-true}"
FORM_CRUD_GUI_MAX_LIST_RESOURCES="${FORM_CRUD_GUI_MAX_LIST_RESOURCES:-all}"
FORM_CRUD_GUI_MAX_CREATE_RESOURCES="${FORM_CRUD_GUI_MAX_CREATE_RESOURCES:-all}"
FORM_CRUD_GUI_MAX_REFERENCE_PICKER_SCENARIOS="${FORM_CRUD_GUI_MAX_REFERENCE_PICKER_SCENARIOS:-all}"
FORM_CRUD_GUI_REFERENCE_PICKER_SOURCE_OPERATION_ID="${FORM_CRUD_GUI_REFERENCE_PICKER_SOURCE_OPERATION_ID:-}"
FORM_CRUD_GUI_REFERENCE_PICKER_SOURCE_PATH="${FORM_CRUD_GUI_REFERENCE_PICKER_SOURCE_PATH:-}"
FORM_CRUD_GUI_EXERCISE_CREATE="${FORM_CRUD_GUI_EXERCISE_CREATE:-true}"
FORM_CRUD_GUI_EXERCISE_UPDATE="${FORM_CRUD_GUI_EXERCISE_UPDATE:-true}"
FORM_CRUD_GUI_EXERCISE_DELETE="${FORM_CRUD_GUI_EXERCISE_DELETE:-true}"
FORM_CRUD_GUI_API_OPERATIONS_EXECUTION_ENABLED="${FORM_CRUD_GUI_API_OPERATIONS_EXECUTION_ENABLED:-true}"
FORM_CRUD_GUI_API_OPERATIONS_REQUIRE_ALL_2XX="${FORM_CRUD_GUI_API_OPERATIONS_REQUIRE_ALL_2XX:-false}"
FORM_CRUD_GUI_API_OPERATIONS_REQUIRE_ALL_ACCOUNTED="${FORM_CRUD_GUI_API_OPERATIONS_REQUIRE_ALL_ACCOUNTED:-true}"
FORM_CRUD_GUI_REQUIRE_ALL_AVAILABLE_RESOURCE_WORKFLOWS="${FORM_CRUD_GUI_REQUIRE_ALL_AVAILABLE_RESOURCE_WORKFLOWS:-true}"
FORM_CRUD_GUI_OPTIONAL_FIELD_COVERAGE_MINIMUM="${FORM_CRUD_GUI_OPTIONAL_FIELD_COVERAGE_MINIMUM:-0.5}"
FORM_CRUD_GUI_PERSISTENCE_POLL_ATTEMPTS="${FORM_CRUD_GUI_PERSISTENCE_POLL_ATTEMPTS:-5}"
FORM_CRUD_GUI_PERSISTENCE_POLL_INTERVAL_MS="${FORM_CRUD_GUI_PERSISTENCE_POLL_INTERVAL_MS:-500}"
FORM_CRUD_GUI_FULL_PAGE_SCREENSHOTS="${FORM_CRUD_GUI_FULL_PAGE_SCREENSHOTS:-true}"
FORM_CRUD_GUI_SOURCE_COVERAGE_ENABLED="${FORM_CRUD_GUI_SOURCE_COVERAGE_ENABLED:-true}"
FORM_CRUD_GUI_SOURCE_COVERAGE_NAVIGATIONS_PER_SEGMENT="${FORM_CRUD_GUI_SOURCE_COVERAGE_NAVIGATIONS_PER_SEGMENT:-1}"
FORM_CRUD_GUI_SOURCE_COVERAGE_MAX_SCRIPT_BYTES="${FORM_CRUD_GUI_SOURCE_COVERAGE_MAX_SCRIPT_BYTES:-67108864}"
FORM_CRUD_GUI_SOURCE_COVERAGE_MAX_UNKNOWN_SCRIPT_BYTES="${FORM_CRUD_GUI_SOURCE_COVERAGE_MAX_UNKNOWN_SCRIPT_BYTES:-2097152}"
FORM_CRUD_GUI_SOURCE_COVERAGE_WORKER_HEAP_MB="${FORM_CRUD_GUI_SOURCE_COVERAGE_WORKER_HEAP_MB:-1024}"
FORM_CRUD_GUI_SOURCE_COVERAGE_MERGE_JEST="${FORM_CRUD_GUI_SOURCE_COVERAGE_MERGE_JEST:-$FORM_CRUD_GUI_JEST_ENABLED}"
FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_LINES="${FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_LINES:-70}"
FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_STATEMENTS="${FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_STATEMENTS:-70}"
FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_FUNCTIONS="${FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_FUNCTIONS:-60}"
FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_BRANCHES="${FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_BRANCHES:-55}"
FORM_CRUD_REFERENCE_PICKER_CONFIG_URL="${FORM_CRUD_REFERENCE_PICKER_CONFIG_URL:-}"
FORM_CRUD_REFERENCE_PICKER_CONFIG_BEARER_TOKEN="${FORM_CRUD_REFERENCE_PICKER_CONFIG_BEARER_TOKEN:-}"
FORM_CRUD_REFERENCE_PICKER_FORWARD_AUTHORIZATION="${FORM_CRUD_REFERENCE_PICKER_FORWARD_AUTHORIZATION:-false}"
FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_ENABLED="${FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_ENABLED:-auto}"
FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_HOST="${FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_HOST:-127.0.0.1}"
FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_PUBLIC_HOST="${FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_PUBLIC_HOST:-localhost}"
FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_PORT="${FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_PORT:-8085}"
FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_STORAGE="${FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_STORAGE:-$OUTPUT_DIR/form-crud-reference-pickers.json}"
EVOMASTER_JAR="${EVOMASTER_JAR:-$WORKSPACE_ROOT/tools/evomaster/evomaster-6.0.0.jar}"
EVOMASTER_MODE="${EVOMASTER_MODE:-coverage}"
EVOMASTER_SECONDS_PER_API="${EVOMASTER_SECONDS_PER_API:-600}"
EVOMASTER_CONTROLLER_PORT="${EVOMASTER_CONTROLLER_PORT:-40100}"
EVOMASTER_OUTPUT_FORMAT="${EVOMASTER_OUTPUT_FORMAT:-JAVA_JUNIT_5}"
if [[ "$EVOMASTER_MODE" == "coverage" ]]; then
  EVOMASTER_MINIMIZE_TIMEOUT_MINUTES="${EVOMASTER_MINIMIZE_TIMEOUT_MINUTES:-0}"
  EVOMASTER_SECURITY="${EVOMASTER_SECURITY:-false}"
  EVOMASTER_XSS="${EVOMASTER_XSS:-false}"
  EVOMASTER_EXTRA_HEADER="${EVOMASTER_EXTRA_HEADER:-false}"
  EVOMASTER_EXTRA_QUERY_PARAM="${EVOMASTER_EXTRA_QUERY_PARAM:-false}"
  EVOMASTER_ACCEPT_HEADER="${EVOMASTER_ACCEPT_HEADER:-application/json}"
  EVOMASTER_SEED_FROM_SMOKE="${EVOMASTER_SEED_FROM_SMOKE:-false}"
  EVOMASTER_OPENAPI_EXAMPLES_FROM_SMOKE="${EVOMASTER_OPENAPI_EXAMPLES_FROM_SMOKE:-true}"
  EVOMASTER_POSTMAN_SEEDS_WITH_OPENAPI_EXAMPLES="${EVOMASTER_POSTMAN_SEEDS_WITH_OPENAPI_EXAMPLES:-false}"
  EVOMASTER_PREMATURE_STOP="${EVOMASTER_PREMATURE_STOP:-120s}"
  EVOMASTER_SEED_BODY_MODE="${EVOMASTER_SEED_BODY_MODE:-safe}"
  EVOMASTER_REUSE_SMOKE_DB_STATE="${EVOMASTER_REUSE_SMOKE_DB_STATE:-true}"
  EVOMASTER_PREPARE_LIVE_DB_STATE="${EVOMASTER_PREPARE_LIVE_DB_STATE:-true}"
  EVOMASTER_EXTRA_TIMEOUT_SECONDS="${EVOMASTER_EXTRA_TIMEOUT_SECONDS:-90}"
  EVOMASTER_GENERATE_SQL_DATA_WITH_SEARCH="${EVOMASTER_GENERATE_SQL_DATA_WITH_SEARCH:-false}"
  EVOMASTER_ALLOW_INVALID_DATA="${EVOMASTER_ALLOW_INVALID_DATA:-false}"
  EVOMASTER_RESOURCE_SAMPLE_STRATEGY="${EVOMASTER_RESOURCE_SAMPLE_STRATEGY:-ConArchive}"
  EVOMASTER_PROB_OF_SMART_SAMPLING="${EVOMASTER_PROB_OF_SMART_SAMPLING:-0.95}"
  EVOMASTER_PROB_OF_ENABLING_RESOURCE_DEPENDENCY_HEURISTICS="${EVOMASTER_PROB_OF_ENABLING_RESOURCE_DEPENDENCY_HEURISTICS:-0.95}"
  EVOMASTER_PROB_USE_REST_LINKS="${EVOMASTER_PROB_USE_REST_LINKS:-0.8}"
  EVOMASTER_MAX_TEST_SIZE="${EVOMASTER_MAX_TEST_SIZE:-20}"
  EVOMASTER_EXPAND_REST_INDIVIDUALS="${EVOMASTER_EXPAND_REST_INDIVIDUALS:-true}"
  EVOMASTER_TAINT_ON_SAMPLING="${EVOMASTER_TAINT_ON_SAMPLING:-true}"
  EVOMASTER_USE_RESPONSE_DATA_POOL="${EVOMASTER_USE_RESPONSE_DATA_POOL:-true}"
  EVOMASTER_COVERAGE_SWEEP_ENABLED="${EVOMASTER_COVERAGE_SWEEP_ENABLED:-auto}"
  EVOMASTER_COVERAGE_SWEEP_SECONDS_PER_ENDPOINT="${EVOMASTER_COVERAGE_SWEEP_SECONDS_PER_ENDPOINT:-30}"
  EVOMASTER_COVERAGE_SWEEP_MAX_ENDPOINTS="${EVOMASTER_COVERAGE_SWEEP_MAX_ENDPOINTS:-6}"
  EVOMASTER_COVERAGE_SWEEP_MINIMIZE_TIMEOUT_MINUTES="${EVOMASTER_COVERAGE_SWEEP_MINIMIZE_TIMEOUT_MINUTES:-0}"
  EVOMASTER_COVERAGE_SWEEP_EXTRA_TIMEOUT_SECONDS="${EVOMASTER_COVERAGE_SWEEP_EXTRA_TIMEOUT_SECONDS:-90}"
  EVOMASTER_COVERAGE_SWEEP_MAX_WALL_SECONDS="${EVOMASTER_COVERAGE_SWEEP_MAX_WALL_SECONDS:-420}"
  EVOMASTER_COVERAGE_SWEEP_STOP_AFTER_NO_GAIN="${EVOMASTER_COVERAGE_SWEEP_STOP_AFTER_NO_GAIN:-3}"
  EVOMASTER_COVERAGE_SWEEP_TIMEOUTS_FATAL="${EVOMASTER_COVERAGE_SWEEP_TIMEOUTS_FATAL:-false}"
  EVOMASTER_COVERAGE_SWEEP_SECURITY="${EVOMASTER_COVERAGE_SWEEP_SECURITY:-false}"
  EVOMASTER_COVERAGE_SWEEP_ALLOW_INVALID_DATA="${EVOMASTER_COVERAGE_SWEEP_ALLOW_INVALID_DATA:-false}"
  EVOMASTER_COVERAGE_SWEEP_PROB_NAMED_EXAMPLES="${EVOMASTER_COVERAGE_SWEEP_PROB_NAMED_EXAMPLES:-1.0}"
  EVOMASTER_COVERAGE_SWEEP_PROB_REST_EXAMPLES="${EVOMASTER_COVERAGE_SWEEP_PROB_REST_EXAMPLES:-1.0}"
  EVOMASTER_COVERAGE_SWEEP_PROB_REST_DEFAULT="${EVOMASTER_COVERAGE_SWEEP_PROB_REST_DEFAULT:-0.0}"
  EVOMASTER_COVERAGE_SWEEP_ACCEPT_HEADER="${EVOMASTER_COVERAGE_SWEEP_ACCEPT_HEADER:-$EVOMASTER_ACCEPT_HEADER}"
  EVOMASTER_COVERAGE_SWEEP_AUTO_MAX_DECLARED_ENDPOINTS="${EVOMASTER_COVERAGE_SWEEP_AUTO_MAX_DECLARED_ENDPOINTS:-10}"
  EVOMASTER_COVERAGE_SWEEP_AUTO_SMALL_APIS="${EVOMASTER_COVERAGE_SWEEP_AUTO_SMALL_APIS:-false}"
  EVOMASTER_COVERAGE_SWEEP_AUTO_SEEDED_APIS="${EVOMASTER_COVERAGE_SWEEP_AUTO_SEEDED_APIS:-true}"
  EVOMASTER_COVERAGE_SWEEP_WITH_SEEDS="${EVOMASTER_COVERAGE_SWEEP_WITH_SEEDS:-false}"
  EVOMASTER_COVERAGE_SWEEP_RETRY_PATH_ONLY_SEEDS="${EVOMASTER_COVERAGE_SWEEP_RETRY_PATH_ONLY_SEEDS:-false}"
  EVOMASTER_COVERAGE_SWEEP_EXTRA_HEADER="${EVOMASTER_COVERAGE_SWEEP_EXTRA_HEADER:-false}"
  EVOMASTER_COVERAGE_SWEEP_EXTRA_QUERY_PARAM="${EVOMASTER_COVERAGE_SWEEP_EXTRA_QUERY_PARAM:-false}"
else
  EVOMASTER_MINIMIZE_TIMEOUT_MINUTES="${EVOMASTER_MINIMIZE_TIMEOUT_MINUTES:-5}"
  EVOMASTER_SECURITY="${EVOMASTER_SECURITY:-true}"
  EVOMASTER_XSS="${EVOMASTER_XSS:-false}"
  EVOMASTER_EXTRA_HEADER="${EVOMASTER_EXTRA_HEADER:-true}"
  EVOMASTER_EXTRA_QUERY_PARAM="${EVOMASTER_EXTRA_QUERY_PARAM:-true}"
  EVOMASTER_ACCEPT_HEADER="${EVOMASTER_ACCEPT_HEADER:-}"
  EVOMASTER_SEED_FROM_SMOKE="${EVOMASTER_SEED_FROM_SMOKE:-false}"
  EVOMASTER_OPENAPI_EXAMPLES_FROM_SMOKE="${EVOMASTER_OPENAPI_EXAMPLES_FROM_SMOKE:-true}"
  EVOMASTER_POSTMAN_SEEDS_WITH_OPENAPI_EXAMPLES="${EVOMASTER_POSTMAN_SEEDS_WITH_OPENAPI_EXAMPLES:-false}"
  EVOMASTER_PREMATURE_STOP="${EVOMASTER_PREMATURE_STOP:-10m}"
  EVOMASTER_SEED_BODY_MODE="${EVOMASTER_SEED_BODY_MODE:-safe}"
  EVOMASTER_REUSE_SMOKE_DB_STATE="${EVOMASTER_REUSE_SMOKE_DB_STATE:-false}"
  EVOMASTER_PREPARE_LIVE_DB_STATE="${EVOMASTER_PREPARE_LIVE_DB_STATE:-true}"
  EVOMASTER_EXTRA_TIMEOUT_SECONDS="${EVOMASTER_EXTRA_TIMEOUT_SECONDS:-900}"
  EVOMASTER_GENERATE_SQL_DATA_WITH_SEARCH="${EVOMASTER_GENERATE_SQL_DATA_WITH_SEARCH:-true}"
  EVOMASTER_ALLOW_INVALID_DATA="${EVOMASTER_ALLOW_INVALID_DATA:-true}"
  EVOMASTER_RESOURCE_SAMPLE_STRATEGY="${EVOMASTER_RESOURCE_SAMPLE_STRATEGY:-ConArchive}"
  EVOMASTER_PROB_OF_SMART_SAMPLING="${EVOMASTER_PROB_OF_SMART_SAMPLING:-0.95}"
  EVOMASTER_PROB_OF_ENABLING_RESOURCE_DEPENDENCY_HEURISTICS="${EVOMASTER_PROB_OF_ENABLING_RESOURCE_DEPENDENCY_HEURISTICS:-0.95}"
  EVOMASTER_PROB_USE_REST_LINKS="${EVOMASTER_PROB_USE_REST_LINKS:-0.5}"
  EVOMASTER_MAX_TEST_SIZE="${EVOMASTER_MAX_TEST_SIZE:-30}"
  EVOMASTER_EXPAND_REST_INDIVIDUALS="${EVOMASTER_EXPAND_REST_INDIVIDUALS:-true}"
  EVOMASTER_TAINT_ON_SAMPLING="${EVOMASTER_TAINT_ON_SAMPLING:-true}"
  EVOMASTER_USE_RESPONSE_DATA_POOL="${EVOMASTER_USE_RESPONSE_DATA_POOL:-true}"
  EVOMASTER_COVERAGE_SWEEP_ENABLED="${EVOMASTER_COVERAGE_SWEEP_ENABLED:-true}"
  EVOMASTER_COVERAGE_SWEEP_SECONDS_PER_ENDPOINT="${EVOMASTER_COVERAGE_SWEEP_SECONDS_PER_ENDPOINT:-60}"
  EVOMASTER_COVERAGE_SWEEP_MAX_ENDPOINTS="${EVOMASTER_COVERAGE_SWEEP_MAX_ENDPOINTS:-5}"
  EVOMASTER_COVERAGE_SWEEP_MINIMIZE_TIMEOUT_MINUTES="${EVOMASTER_COVERAGE_SWEEP_MINIMIZE_TIMEOUT_MINUTES:-1}"
  EVOMASTER_COVERAGE_SWEEP_EXTRA_TIMEOUT_SECONDS="${EVOMASTER_COVERAGE_SWEEP_EXTRA_TIMEOUT_SECONDS:-180}"
  EVOMASTER_COVERAGE_SWEEP_MAX_WALL_SECONDS="${EVOMASTER_COVERAGE_SWEEP_MAX_WALL_SECONDS:-300}"
  EVOMASTER_COVERAGE_SWEEP_STOP_AFTER_NO_GAIN="${EVOMASTER_COVERAGE_SWEEP_STOP_AFTER_NO_GAIN:-2}"
  EVOMASTER_COVERAGE_SWEEP_TIMEOUTS_FATAL="${EVOMASTER_COVERAGE_SWEEP_TIMEOUTS_FATAL:-false}"
  EVOMASTER_COVERAGE_SWEEP_ALLOW_INVALID_DATA="${EVOMASTER_COVERAGE_SWEEP_ALLOW_INVALID_DATA:-false}"
  EVOMASTER_COVERAGE_SWEEP_PROB_NAMED_EXAMPLES="${EVOMASTER_COVERAGE_SWEEP_PROB_NAMED_EXAMPLES:-1.0}"
  EVOMASTER_COVERAGE_SWEEP_PROB_REST_EXAMPLES="${EVOMASTER_COVERAGE_SWEEP_PROB_REST_EXAMPLES:-1.0}"
  EVOMASTER_COVERAGE_SWEEP_PROB_REST_DEFAULT="${EVOMASTER_COVERAGE_SWEEP_PROB_REST_DEFAULT:-0.0}"
  EVOMASTER_COVERAGE_SWEEP_ACCEPT_HEADER="${EVOMASTER_COVERAGE_SWEEP_ACCEPT_HEADER:-$EVOMASTER_ACCEPT_HEADER}"
  EVOMASTER_COVERAGE_SWEEP_AUTO_MAX_DECLARED_ENDPOINTS="${EVOMASTER_COVERAGE_SWEEP_AUTO_MAX_DECLARED_ENDPOINTS:-10}"
  EVOMASTER_COVERAGE_SWEEP_AUTO_SMALL_APIS="${EVOMASTER_COVERAGE_SWEEP_AUTO_SMALL_APIS:-true}"
  EVOMASTER_COVERAGE_SWEEP_AUTO_SEEDED_APIS="${EVOMASTER_COVERAGE_SWEEP_AUTO_SEEDED_APIS:-true}"
  EVOMASTER_COVERAGE_SWEEP_WITH_SEEDS="${EVOMASTER_COVERAGE_SWEEP_WITH_SEEDS:-false}"
  EVOMASTER_COVERAGE_SWEEP_RETRY_PATH_ONLY_SEEDS="${EVOMASTER_COVERAGE_SWEEP_RETRY_PATH_ONLY_SEEDS:-false}"
  EVOMASTER_COVERAGE_SWEEP_SECURITY="${EVOMASTER_COVERAGE_SWEEP_SECURITY:-true}"
  EVOMASTER_COVERAGE_SWEEP_EXTRA_HEADER="${EVOMASTER_COVERAGE_SWEEP_EXTRA_HEADER:-false}"
  EVOMASTER_COVERAGE_SWEEP_EXTRA_QUERY_PARAM="${EVOMASTER_COVERAGE_SWEEP_EXTRA_QUERY_PARAM:-false}"
fi
EVOMASTER_TCP_TIMEOUT_MS="${EVOMASTER_TCP_TIMEOUT_MS:-10000}"
EVOMASTER_TEST_TIMEOUT="${EVOMASTER_TEST_TIMEOUT:-30}"
EVOMASTER_ALGORITHM="${EVOMASTER_ALGORITHM:-MIO}"
EVOMASTER_FAIL_ON_FAULTS="${EVOMASTER_FAIL_ON_FAULTS:-true}"
EVOMASTER_FAIL_ON_WRITER_WARNINGS="${EVOMASTER_FAIL_ON_WRITER_WARNINGS:-false}"
EVOMASTER_SKIP_FAILURE_SQL_IN_TEST_FILE="${EVOMASTER_SKIP_FAILURE_SQL_IN_TEST_FILE:-true}"
EVOMASTER_AUTH_FROM_SMOKE_TOKEN="${EVOMASTER_AUTH_FROM_SMOKE_TOKEN:-true}"
EVOMASTER_ACCEPT_HEADER="${EVOMASTER_ACCEPT_HEADER:-}"
EVOMASTER_SEED_FROM_SMOKE="${EVOMASTER_SEED_FROM_SMOKE:-false}"
EVOMASTER_OPENAPI_EXAMPLES_FROM_SMOKE="${EVOMASTER_OPENAPI_EXAMPLES_FROM_SMOKE:-true}"
EVOMASTER_POSTMAN_SEEDS_WITH_OPENAPI_EXAMPLES="${EVOMASTER_POSTMAN_SEEDS_WITH_OPENAPI_EXAMPLES:-false}"
EVOMASTER_POSTMAN_SEEDS_ENABLED="${EVOMASTER_POSTMAN_SEEDS_ENABLED:-false}"
EVOMASTER_PREMATURE_STOP="${EVOMASTER_PREMATURE_STOP:-}"
EVOMASTER_SEED_BODY_MODE="${EVOMASTER_SEED_BODY_MODE:-safe}"
EVOMASTER_REUSE_SMOKE_DB_STATE="${EVOMASTER_REUSE_SMOKE_DB_STATE:-false}"
EVOMASTER_PREPARE_LIVE_DB_STATE="${EVOMASTER_PREPARE_LIVE_DB_STATE:-true}"
EVOMASTER_RETRY_WITHOUT_SEEDS_ON_SEED_FAILURE="${EVOMASTER_RETRY_WITHOUT_SEEDS_ON_SEED_FAILURE:-true}"
EVOMASTER_RETRY_WITHOUT_SECURITY_ON_SECURITY_FAILURE="${EVOMASTER_RETRY_WITHOUT_SECURITY_ON_SECURITY_FAILURE:-true}"
EVOMASTER_EXPORT_TEST_CASES_DURING_SEEDING="${EVOMASTER_EXPORT_TEST_CASES_DURING_SEEDING:-true}"
EVOMASTER_SEED_BASE_PATH="${EVOMASTER_SEED_BASE_PATH:-/api}"
EVOMASTER_DO_COLLECT_IMPACT="${EVOMASTER_DO_COLLECT_IMPACT:-false}"
EVOMASTER_ADAPTIVE_GENE_SELECTION_METHOD="${EVOMASTER_ADAPTIVE_GENE_SELECTION_METHOD:-NONE}"
EVOMASTER_ARCHIVE_GENE_MUTATION="${EVOMASTER_ARCHIVE_GENE_MUTATION:-NONE}"
EVOMASTER_PROB_NAMED_EXAMPLES="${EVOMASTER_PROB_NAMED_EXAMPLES:-1.0}"
EVOMASTER_PROB_REST_EXAMPLES="${EVOMASTER_PROB_REST_EXAMPLES:-0.7}"
EVOMASTER_PROB_REST_DEFAULT="${EVOMASTER_PROB_REST_DEFAULT:-0.3}"
EVOMASTER_GENERATE_SQL_DATA_WITH_SEARCH="${EVOMASTER_GENERATE_SQL_DATA_WITH_SEARCH:-true}"
EVOMASTER_ALLOW_INVALID_DATA="${EVOMASTER_ALLOW_INVALID_DATA:-true}"
EVOMASTER_RESOURCE_SAMPLE_STRATEGY="${EVOMASTER_RESOURCE_SAMPLE_STRATEGY:-ConArchive}"
EVOMASTER_PROB_OF_SMART_SAMPLING="${EVOMASTER_PROB_OF_SMART_SAMPLING:-0.95}"
EVOMASTER_PROB_OF_ENABLING_RESOURCE_DEPENDENCY_HEURISTICS="${EVOMASTER_PROB_OF_ENABLING_RESOURCE_DEPENDENCY_HEURISTICS:-0.95}"
EVOMASTER_PROB_USE_REST_LINKS="${EVOMASTER_PROB_USE_REST_LINKS:-0.5}"
EVOMASTER_MAX_TEST_SIZE="${EVOMASTER_MAX_TEST_SIZE:-20}"
EVOMASTER_EXPAND_REST_INDIVIDUALS="${EVOMASTER_EXPAND_REST_INDIVIDUALS:-true}"
EVOMASTER_TAINT_ON_SAMPLING="${EVOMASTER_TAINT_ON_SAMPLING:-true}"
EVOMASTER_USE_RESPONSE_DATA_POOL="${EVOMASTER_USE_RESPONSE_DATA_POOL:-true}"
EVOMASTER_EXTRA_PHASE_BUDGET_PERCENTAGE="${EVOMASTER_EXTRA_PHASE_BUDGET_PERCENTAGE:-}"
EVOMASTER_EXTRA_ARGS="${EVOMASTER_EXTRA_ARGS:-}"

total_memory_mb() {
  awk '
    /MemTotal:/ { mem=$2 }
    /SwapTotal:/ { swap=$2 }
    END { print int((mem + swap) / 1024) }
  ' /proc/meminfo
}

default_evomaster_java_opts() {
  local total_mb
  total_mb="$(total_memory_mb)"
  if [[ "$total_mb" -ge 24576 ]]; then
    echo "-Xms512m -Xmx8g"
  elif [[ "$total_mb" -ge 12288 ]]; then
    echo "-Xms512m -Xmx6g"
  else
    echo "-Xms256m -Xmx4g"
  fi
}

EVOMASTER_JAVA_OPTS="${EVOMASTER_JAVA_OPTS:-$(default_evomaster_java_opts)}"
EVOMASTER_TIMEOUT_SECONDS="${EVOMASTER_TIMEOUT_SECONDS:-}"
if [[ "$EVOMASTER_MODE" == "coverage" ]]; then
  EVOMASTER_TIMEOUT_KILL_AFTER_SECONDS="${EVOMASTER_TIMEOUT_KILL_AFTER_SECONDS:-5}"
  EVOMASTER_COMPLETION_GRACE_SECONDS="${EVOMASTER_COMPLETION_GRACE_SECONDS:-2}"
  EVOMASTER_POST_SEARCH_TIMEOUT_PERCENT="${EVOMASTER_POST_SEARCH_TIMEOUT_PERCENT:-100}"
else
  EVOMASTER_TIMEOUT_KILL_AFTER_SECONDS="${EVOMASTER_TIMEOUT_KILL_AFTER_SECONDS:-30}"
  EVOMASTER_COMPLETION_GRACE_SECONDS="${EVOMASTER_COMPLETION_GRACE_SECONDS:-5}"
  EVOMASTER_POST_SEARCH_TIMEOUT_PERCENT="${EVOMASTER_POST_SEARCH_TIMEOUT_PERCENT:-0}"
fi
EVOMASTER_DRIVER_JVM_ARGS="${EVOMASTER_DRIVER_JVM_ARGS:--Djdk.attach.allowAttachSelf=true --add-opens java.base/java.util=ALL-UNNAMED --add-opens java.base/java.util.regex=ALL-UNNAMED --add-opens java.base/java.net=ALL-UNNAMED --add-opens java.base/java.lang=ALL-UNNAMED -XX:+EnableDynamicAgentLoading}"
RUNTIME_FAIL_FAST="${RUNTIME_FAIL_FAST:-false}"
MAVEN_OFFLINE="${MAVEN_OFFLINE:-false}"
MAVEN_CLI_OPTS="${MAVEN_CLI_OPTS:-}"
DOCKER_COMPOSE_UP_ARGS="${DOCKER_COMPOSE_UP_ARGS:-}"
mkdir -p "$OUTPUT_DIR"

MAVEN_ARGS=()
if [[ "$MAVEN_OFFLINE" == "true" ]]; then
  MAVEN_ARGS+=("-o")
fi
if [[ -n "$MAVEN_CLI_OPTS" ]]; then
  read -r -a MAVEN_CLI_OPTS_ARRAY <<< "$MAVEN_CLI_OPTS"
  MAVEN_ARGS+=("${MAVEN_CLI_OPTS_ARRAY[@]}")
fi

DOCKER_COMPOSE_UP_ARGS_ARRAY=()
if [[ -n "$DOCKER_COMPOSE_UP_ARGS" ]]; then
  read -r -a DOCKER_COMPOSE_UP_ARGS_ARRAY <<< "$DOCKER_COMPOSE_UP_ARGS"
fi

now_epoch() {
  date +%s
}

iso_from_epoch() {
  local epoch="$1"
  if [[ -z "$epoch" ]]; then
    printf ''
  else
    date -u -d "@$epoch" +%Y-%m-%dT%H:%M:%SZ
  fi
}

duration_seconds() {
  local start="$1"
  local end="$2"
  if [[ -z "$start" || -z "$end" ]]; then
    printf '0\n'
  else
    printf '%s\n' "$((end - start))"
  fi
}

timestamped_step() {
  local name="$1"
  local step="$2"
  local epoch
  epoch="$(now_epoch)"
  printf '=== [%s] %s at %s ===\n' "$name" "$step" "$(iso_from_epoch "$epoch")"
}

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

cleanup_driver() {
  local pid="${1:-}"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    kill -- "-$pid" >/dev/null 2>&1 || true
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
  fi
}

cleanup_process() {
  local pid="${1:-}"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    kill -- "-$pid" >/dev/null 2>&1 || true
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
  fi
}

cleanup_reference_picker_config_service() {
  local pid="${1:-}"
  cleanup_process "$pid"
}

should_start_reference_picker_config_service() {
  case "$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_ENABLED" in
    true)
      [[ -z "$FORM_CRUD_REFERENCE_PICKER_CONFIG_URL" ]]
      ;;
    false|skip)
      return 1
      ;;
    auto)
      [[ "$FORM_CRUD_GUI_ENABLED" == "true" && -z "$FORM_CRUD_REFERENCE_PICKER_CONFIG_URL" ]]
      ;;
    *)
      echo "Unsupported FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_ENABLED=$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_ENABLED; use auto, true, false, or skip." >&2
      return 2
      ;;
  esac
}

start_reference_picker_config_service() {
  local log_file="$OUTPUT_DIR/form-crud-reference-picker-config-service.log"
  local pid
  timestamped_step "harness" "Form CRUD reference picker config service start"
  rm -f "$log_file"
  mkdir -p "$(dirname "$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_STORAGE")"
  (
    exec setsid env \
      OUTPUT_DIR="$OUTPUT_DIR" \
      FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_HOST="$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_HOST" \
      FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_PORT="$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_PORT" \
      FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_STORAGE="$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_STORAGE" \
      node "$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE" \
        --host "$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_HOST" \
        --port "$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_PORT" \
        --storage "$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_STORAGE" >"$log_file" 2>&1 < /dev/null
  ) &
  pid=$!
  wait_for_http \
    "http://$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_PUBLIC_HOST:$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_PORT/management/health" \
    "$log_file" \
    "Form CRUD reference picker config service" \
    "$pid"
  reference_picker_config_service_pid="$pid"
  FORM_CRUD_REFERENCE_PICKER_CONFIG_URL="http://$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_PUBLIC_HOST:$FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_PORT/api/form-crud-reference-pickers"
  echo "FORM_CRUD_REFERENCE_PICKER_CONFIG_URL=$FORM_CRUD_REFERENCE_PICKER_CONFIG_URL"
}

cleanup_form_crud_gui_port() {
  local port="$FORM_CRUD_GUI_PORT"
  local listener_pids
  listener_pids=$(ss -tlnp | sed -nE "s/.*:${port} .*pid=([0-9]+).*/\1/p" | sort -u)
  for listener_pid in $listener_pids; do
    kill "$listener_pid" >/dev/null 2>&1 || true
  done
  for _ in $(seq 1 20); do
    if ! ss -tlnp | grep -q ":$port "; then
      return 0
    fi
    sleep 1
  done
  echo "Form CRUD GUI port $port is still in use after cleanup" >&2
  ss -tlnp | grep ":$port " >&2 || true
  return 1
}

wait_for_http() {
  local url="$1"
  local log_file="$2"
  local label="$3"
  local pid="${4:-}"
  for _ in $(seq 1 120); do
    if [[ -n "$pid" ]] && ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "$label process exited before becoming reachable at $url" >&2
      tail -n 200 "$log_file" >&2 || true
      return 1
    fi
    if [[ -f "$log_file" ]] && grep -Eiq 'port .*already in use|address already in use|EADDRINUSE|unhandled exception occurred' "$log_file"; then
      echo "$label failed to start cleanly at $url" >&2
      tail -n 200 "$log_file" >&2 || true
      return 1
    fi
    if curl -s -o /dev/null -w '%{http_code}' "$url" | grep -Eq '^(200|301|302|401|403)$'; then
      return 0
    fi
    sleep 1
  done
  echo "$label did not become reachable at $url" >&2
  tail -n 200 "$log_file" >&2 || true
  return 1
}

ensure_form_crud_gui_dependencies() {
  local name="$1"
  local app_dir="$2"
  local install_start install_end

  if [[ "$FORM_CRUD_GUI_NPM_INSTALL" == "skip" || -d "$app_dir/node_modules" ]]; then
    return 0
  fi

  install_start="$(now_epoch)"
  timestamped_step "$name" "Form CRUD GUI npm install start ($FORM_CRUD_GUI_NPM_INSTALL)"
  (
    cd "$app_dir"
    case "$FORM_CRUD_GUI_NPM_INSTALL" in
      offline)
        env CI=true NG_CLI_ANALYTICS=false NO_UPDATE_NOTIFIER=1 $FORM_CRUD_GUI_NPM_INSTALL_COMMAND --offline < /dev/null
        ;;
      online)
        env CI=true NG_CLI_ANALYTICS=false NO_UPDATE_NOTIFIER=1 $FORM_CRUD_GUI_NPM_INSTALL_COMMAND < /dev/null
        ;;
      *)
        echo "Unsupported FORM_CRUD_GUI_NPM_INSTALL=$FORM_CRUD_GUI_NPM_INSTALL; use offline, online, or skip." >&2
        exit 2
        ;;
    esac
  )
  install_end="$(now_epoch)"
  timestamped_step "$name" "Form CRUD GUI npm install finished in $(duration_seconds "$install_start" "$install_end")s"
}

run_form_crud_gui_jest() {
  local name="$1"
  local app_dir="$2"
  local artifact_output_dir="$3"
  local gui_dir="$artifact_output_dir/form-crud-gui"
  local jest_log="$gui_dir/angular-jest.log"
  local jest_status_file="$gui_dir/angular-jest.json"
  local jest_start jest_end jest_status

  mkdir -p "$gui_dir"
  if [[ "$FORM_CRUD_GUI_JEST_ENABLED" != "true" ]]; then
    jq -n \
      --arg artifact "$name" \
      --arg status "skipped" \
      --arg command "$FORM_CRUD_GUI_JEST_COMMAND" \
      --arg nodeOptions "$FORM_CRUD_GUI_JEST_NODE_OPTIONS" \
      '{artifact: $artifact, status: $status, command: $command, nodeOptions: $nodeOptions, durationMs: 0, exitCode: 0}' \
      > "$jest_status_file"
    return 0
  fi

  jest_start="$(now_epoch)"
  timestamped_step "$name" "Form CRUD GUI Angular Vitest start"
  set +e
  (
    cd "$app_dir"
    timeout --kill-after="${FORM_CRUD_GUI_JEST_TIMEOUT_KILL_AFTER_SECONDS}s" "${FORM_CRUD_GUI_JEST_TIMEOUT_SECONDS}s" \
      env PATH="$FORM_CRUD_GUI_NODE_BIN:$PATH" CI=true NG_CLI_ANALYTICS=false NODE_OPTIONS="$FORM_CRUD_GUI_JEST_NODE_OPTIONS" NO_UPDATE_NOTIFIER=1 bash -c "$FORM_CRUD_GUI_JEST_COMMAND" >"$jest_log" 2>&1 < /dev/null
  )
  jest_status=$?
  set -e
  jest_end="$(now_epoch)"
  timestamped_step "$name" "Form CRUD GUI Angular Vitest finished in $(duration_seconds "$jest_start" "$jest_end")s"

  jq -n \
    --arg artifact "$name" \
    --arg status "$(if [[ "$jest_status" == "0" ]]; then printf passed; else printf failed; fi)" \
    --arg command "$FORM_CRUD_GUI_JEST_COMMAND" \
    --arg nodeOptions "$FORM_CRUD_GUI_JEST_NODE_OPTIONS" \
    --arg log "$jest_log" \
    --arg startEpoch "$jest_start" \
    --arg startIso "$(iso_from_epoch "$jest_start")" \
    --arg endEpoch "$jest_end" \
    --arg endIso "$(iso_from_epoch "$jest_end")" \
    --arg durationMs "$(( (jest_end - jest_start) * 1000 ))" \
    --arg exitCode "$jest_status" \
    '{
      artifact: $artifact,
      status: $status,
      command: $command,
      nodeOptions: $nodeOptions,
      log: $log,
      startEpoch: ($startEpoch | tonumber),
      startIso: $startIso,
      endEpoch: ($endEpoch | tonumber),
      endIso: $endIso,
      durationMs: ($durationMs | tonumber),
      exitCode: ($exitCode | tonumber)
    }' \
    > "$jest_status_file"
  return "$jest_status"
}

write_form_crud_gui_combined_summary() {
  local name="$1"
  local artifact_output_dir="$2"
  local gui_dir="$artifact_output_dir/form-crud-gui"
  local summary_file="$gui_dir/form-crud-gui-summary.json"
  local smoke_file="$gui_dir/form-crud-gui-smoke.json"
  local jest_file="$gui_dir/angular-jest.json"
  local default_smoke_file="$gui_dir/form-crud-gui-smoke-default.json"
  local default_jest_file="$gui_dir/angular-jest-default.json"

  mkdir -p "$gui_dir"
  if [[ ! -f "$smoke_file" ]]; then
    jq -n --arg artifact "$name" '{artifact: $artifact, status: "not-run", durationMs: 0}' > "$default_smoke_file"
    smoke_file="$default_smoke_file"
  fi
  if [[ ! -f "$jest_file" ]]; then
    jq -n --arg artifact "$name" '{artifact: $artifact, status: "not-run", durationMs: 0, exitCode: 0}' > "$default_jest_file"
    jest_file="$default_jest_file"
  fi

  jq -n \
    --slurpfile browser "$smoke_file" \
    --slurpfile jest "$jest_file" \
    '
      ($browser[0] // {}) as $b |
      ($jest[0] // {}) as $j |
      {
        artifact: ($b.artifact // $j.artifact),
        status: (if ($b.status == "passed" and ($j.status == "passed" or $j.status == "skipped")) then "passed" else "failed" end),
        durationMs: (($b.durationMs // 0) + ($j.durationMs // 0)),
        workflow: ($b.workflow // {
          status: "incomplete",
          complete: false,
          thresholdEvaluationEligible: false,
          reasons: [{reasonCode: "browser-workflow-report-unavailable"}]
        }),
        coverage: ($b.coverage // {}),
        sourceCoverage: ($b.sourceCoverage // {}),
        resourceCount: ($b.resourceCount // $b.coverage.discoveredResources // 0),
        screenshots: ($b.screenshots // []),
        failedResponses: ($b.failedResponses // []),
        pageErrors: ($b.pageErrors // []),
        console: ($b.console // []),
        browser: $b,
        unitTest: $j,
        jest: $j,
        error: (if ($b.status != "passed") then ($b.error // {message: "Form CRUD browser smoke failed or did not run"})
                elif ($j.status != "passed" and $j.status != "skipped") then {message: "Generated Angular Vitest suite failed", log: $j.log}
                else null end)
      }
    ' > "$summary_file"
}

run_form_crud_gui_smoke() {
  local name="$1"
  local app_dir="$2"
  local artifact_output_dir="$3"
  local gui_dir="$artifact_output_dir/form-crud-gui"
  local gui_log="$gui_dir/angular.log"
  local gui_status=0
  local jest_status=0
  local angular_pid=""
  local gui_start gui_end

  mkdir -p "$gui_dir"
  ensure_form_crud_gui_dependencies "$name" "$app_dir"
  run_form_crud_gui_jest "$name" "$app_dir" "$artifact_output_dir" || jest_status=$?
  ensure_form_crud_gui_playwright_dependencies "$name" "$app_dir"
  cleanup_form_crud_gui_port

  gui_start="$(now_epoch)"
  timestamped_step "$name" "Form CRUD GUI browser smoke start"
  (
    cd "$app_dir"
    exec setsid env PATH="$FORM_CRUD_GUI_NODE_BIN:$PATH" CI=true NG_CLI_ANALYTICS=false NO_UPDATE_NOTIFIER=1 bash -c "$FORM_CRUD_GUI_START_COMMAND" >"$gui_log" 2>&1 < /dev/null
  ) &
  angular_pid=$!

  if ! wait_for_http "http://$FORM_CRUD_GUI_PUBLIC_HOST:$FORM_CRUD_GUI_PORT/" "$gui_log" "Angular dev server" "$angular_pid"; then
    cleanup_process "$angular_pid"
    write_form_crud_gui_combined_summary "$name" "$artifact_output_dir"
    return 1
  fi

  NODE_OPTIONS="$FORM_CRUD_GUI_NODE_OPTIONS" \
  FORM_CRUD_GUI_USERNAME="$FORM_CRUD_GUI_USERNAME" \
  FORM_CRUD_GUI_PASSWORD="$FORM_CRUD_GUI_PASSWORD" \
  FORM_CRUD_GUI_APP_DIR="$app_dir" \
  FORM_CRUD_GUI_TIMEOUT_MS="$FORM_CRUD_GUI_TIMEOUT_MS" \
  FORM_CRUD_GUI_HEADLESS="$FORM_CRUD_GUI_HEADLESS" \
  FORM_CRUD_GUI_PLAYWRIGHT_ROOT="$FORM_CRUD_GUI_PLAYWRIGHT_ROOT" \
  FORM_CRUD_GUI_FAIL_ON_CONSOLE_ERROR="$FORM_CRUD_GUI_FAIL_ON_CONSOLE_ERROR" \
  FORM_CRUD_GUI_FAIL_ON_HTTP_4XX="$FORM_CRUD_GUI_FAIL_ON_HTTP_4XX" \
  FORM_CRUD_GUI_FAIL_ON_INVALID_CREATE_FORM="$FORM_CRUD_GUI_FAIL_ON_INVALID_CREATE_FORM" \
  FORM_CRUD_GUI_FAIL_ON_CREATE_HTTP_ERROR="$FORM_CRUD_GUI_FAIL_ON_CREATE_HTTP_ERROR" \
  FORM_CRUD_GUI_MAX_LIST_RESOURCES="$FORM_CRUD_GUI_MAX_LIST_RESOURCES" \
  FORM_CRUD_GUI_MAX_CREATE_RESOURCES="$FORM_CRUD_GUI_MAX_CREATE_RESOURCES" \
  FORM_CRUD_GUI_MAX_REFERENCE_PICKER_SCENARIOS="$FORM_CRUD_GUI_MAX_REFERENCE_PICKER_SCENARIOS" \
  FORM_CRUD_GUI_REFERENCE_PICKER_SOURCE_OPERATION_ID="$FORM_CRUD_GUI_REFERENCE_PICKER_SOURCE_OPERATION_ID" \
  FORM_CRUD_GUI_REFERENCE_PICKER_SOURCE_PATH="$FORM_CRUD_GUI_REFERENCE_PICKER_SOURCE_PATH" \
  FORM_CRUD_GUI_EXERCISE_CREATE="$FORM_CRUD_GUI_EXERCISE_CREATE" \
  FORM_CRUD_GUI_EXERCISE_UPDATE="$FORM_CRUD_GUI_EXERCISE_UPDATE" \
  FORM_CRUD_GUI_EXERCISE_DELETE="$FORM_CRUD_GUI_EXERCISE_DELETE" \
  FORM_CRUD_GUI_API_OPERATIONS_EXECUTION_ENABLED="$FORM_CRUD_GUI_API_OPERATIONS_EXECUTION_ENABLED" \
  FORM_CRUD_GUI_API_OPERATIONS_REQUIRE_ALL_2XX="$FORM_CRUD_GUI_API_OPERATIONS_REQUIRE_ALL_2XX" \
  FORM_CRUD_GUI_API_OPERATIONS_REQUIRE_ALL_ACCOUNTED="$FORM_CRUD_GUI_API_OPERATIONS_REQUIRE_ALL_ACCOUNTED" \
  FORM_CRUD_GUI_REQUIRE_ALL_AVAILABLE_RESOURCE_WORKFLOWS="$FORM_CRUD_GUI_REQUIRE_ALL_AVAILABLE_RESOURCE_WORKFLOWS" \
  FORM_CRUD_GUI_OPTIONAL_FIELD_COVERAGE_MINIMUM="$FORM_CRUD_GUI_OPTIONAL_FIELD_COVERAGE_MINIMUM" \
  FORM_CRUD_GUI_PERSISTENCE_POLL_ATTEMPTS="$FORM_CRUD_GUI_PERSISTENCE_POLL_ATTEMPTS" \
  FORM_CRUD_GUI_PERSISTENCE_POLL_INTERVAL_MS="$FORM_CRUD_GUI_PERSISTENCE_POLL_INTERVAL_MS" \
  FORM_CRUD_GUI_FULL_PAGE_SCREENSHOTS="$FORM_CRUD_GUI_FULL_PAGE_SCREENSHOTS" \
  FORM_CRUD_GUI_SOURCE_COVERAGE_ENABLED="$FORM_CRUD_GUI_SOURCE_COVERAGE_ENABLED" \
  FORM_CRUD_GUI_SOURCE_COVERAGE_NAVIGATIONS_PER_SEGMENT="$FORM_CRUD_GUI_SOURCE_COVERAGE_NAVIGATIONS_PER_SEGMENT" \
  FORM_CRUD_GUI_SOURCE_COVERAGE_MAX_SCRIPT_BYTES="$FORM_CRUD_GUI_SOURCE_COVERAGE_MAX_SCRIPT_BYTES" \
  FORM_CRUD_GUI_SOURCE_COVERAGE_MAX_UNKNOWN_SCRIPT_BYTES="$FORM_CRUD_GUI_SOURCE_COVERAGE_MAX_UNKNOWN_SCRIPT_BYTES" \
  FORM_CRUD_GUI_SOURCE_COVERAGE_WORKER_HEAP_MB="$FORM_CRUD_GUI_SOURCE_COVERAGE_WORKER_HEAP_MB" \
  FORM_CRUD_GUI_SOURCE_COVERAGE_MERGE_JEST="$FORM_CRUD_GUI_SOURCE_COVERAGE_MERGE_JEST" \
  FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_LINES="$FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_LINES" \
  FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_STATEMENTS="$FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_STATEMENTS" \
  FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_FUNCTIONS="$FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_FUNCTIONS" \
  FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_BRANCHES="$FORM_CRUD_GUI_SOURCE_COVERAGE_MIN_BRANCHES" \
    timeout --kill-after="${FORM_CRUD_GUI_RUN_TIMEOUT_KILL_AFTER_SECONDS}s" "${FORM_CRUD_GUI_RUN_TIMEOUT_SECONDS}s" \
      "$FORM_CRUD_GUI_NODE_BIN/node" "$FORM_CRUD_GUI_SMOKE" "$name" "http://$FORM_CRUD_GUI_PUBLIC_HOST:$FORM_CRUD_GUI_PORT" "$gui_dir" < /dev/null || gui_status=$?

  cleanup_process "$angular_pid"
  gui_end="$(now_epoch)"
  if [[ "$gui_status" != "0" && ! -f "$gui_dir/form-crud-gui-smoke.json" ]]; then
    jq -n \
      --arg artifact "$name" \
      --arg startIso "$(iso_from_epoch "$gui_start")" \
      --arg endIso "$(iso_from_epoch "$gui_end")" \
      --arg durationMs "$(( (gui_end - gui_start) * 1000 ))" \
      --arg exitCode "$gui_status" \
      --arg nodeOptions "$FORM_CRUD_GUI_NODE_OPTIONS" \
      --arg timeoutSeconds "$FORM_CRUD_GUI_RUN_TIMEOUT_SECONDS" \
      '{
        artifact: $artifact,
        status: "failed",
        startIso: $startIso,
        endIso: $endIso,
        durationMs: ($durationMs | tonumber),
        exitCode: ($exitCode | tonumber),
        nodeOptions: $nodeOptions,
        timeoutSeconds: ($timeoutSeconds | tonumber),
        error: {
          message: (if ($exitCode | tonumber) == 124 then "Form CRUD browser smoke exceeded its configured timeout" else "Form CRUD browser smoke exited before writing its report" end)
        }
      }' > "$gui_dir/form-crud-gui-smoke.json"
  fi
  timestamped_step "$name" "Form CRUD GUI browser smoke finished in $(duration_seconds "$gui_start" "$gui_end")s"
  write_form_crud_gui_combined_summary "$name" "$artifact_output_dir"
  if [[ "$jest_status" != "0" ]]; then
    return "$jest_status"
  fi
  return "$gui_status"
}

wait_for_db() {
  local app_dir="$1"
  local _db_user="$2"
  for _ in $(seq 1 60); do
    # A local TCP connect is enough for Spring's JDBC pool to begin its own
    # authenticated startup. It avoids docker compose exec hangs observed on
    # layered Docker/WSL transports after the container is already healthy.
    if timeout 2s bash -c ': >"/dev/tcp/$1/$2"' -- "$POSTGRES_HOST" "$POSTGRES_PORT" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "PostgreSQL did not become ready for $app_dir" >&2
  return 1
}

wait_for_app() {
  local log_file="$1"
  local pid="${2:-}"
  for _ in $(seq 1 120); do
    if grep -q "Started .*App" "$log_file" 2>/dev/null; then
      local code
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/management/health" || true)
      if [[ "$code" == "200" || "$code" == "401" || "$code" == "403" ]]; then
        return 0
      fi
    fi
    if grep -Eq "APPLICATION FAILED TO START|Application run failed|Liquibase could not start correctly, your database is NOT ready" "$log_file" 2>/dev/null; then
      tail -n 200 "$log_file" >&2
      return 1
    fi
    if [[ -n "$pid" ]] && ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "Spring Boot process exited before port $PORT became reachable" >&2
      tail -n 200 "$log_file" >&2
      return 1
    fi
    sleep 2
  done
  echo "Spring Boot did not become reachable on port $PORT" >&2
  tail -n 200 "$log_file" >&2
  return 1
}

wait_for_controller() {
  local port="$1"
  local log_file="$2"
  local pid="$3"
  for _ in $(seq 1 120); do
    if ss -tlnp | grep -q ":$port "; then
      return 0
    fi
    if [[ -n "$pid" ]] && ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "EvoMaster driver process exited before controller port $port became reachable" >&2
      tail -n 200 "$log_file" >&2
      return 1
    fi
    if grep -q "APPLICATION FAILED TO START" "$log_file" 2>/dev/null; then
      tail -n 200 "$log_file" >&2
      return 1
    fi
    sleep 2
  done
  echo "EvoMaster driver did not become reachable on controller port $port" >&2
  tail -n 200 "$log_file" >&2
  return 1
}

authenticate() {
  local token
  local start_epoch
  local now_epoch
  local response_file
  response_file="$(mktemp)"
  start_epoch="$(date +%s)"
  while true; do
    if curl -s -X POST "http://localhost:$PORT/api/authenticate" \
      -H "Content-Type: application/json" \
      -d '{"username":"admin","password":"admin"}' >"$response_file"; then
      token="$(jq -r '.id_token // empty' "$response_file" 2>/dev/null || true)"
      if [[ -n "$token" && "$token" != "null" ]]; then
        rm -f "$response_file"
        printf '%s\n' "$token"
        return 0
      fi
    fi
    now_epoch="$(date +%s)"
    if (( now_epoch - start_epoch >= AUTHENTICATION_TIMEOUT_SECONDS )); then
      echo "Authentication failed on port $PORT after ${AUTHENTICATION_TIMEOUT_SECONDS}s" >&2
      if [[ -s "$response_file" ]]; then
        cat "$response_file" >&2
        echo >&2
      fi
      rm -f "$response_file"
      return 1
    fi
    sleep "$AUTHENTICATION_RETRY_SLEEP_SECONDS"
  done
}

package_name() {
  local app_dir="$1"
  jq -r '."generator-jhipster".packageName // empty' "$app_dir/.yo-rc.json"
}

evomaster_seed_parser_failed() {
  local log_file="$1"
  grep -Eq '(^[[:space:]]*at org\.evomaster\.core\.problem\.rest\.seeding\.|^[[:space:]]*at .*PostmanParser\.|initSeededTests)' "$log_file"
}

evomaster_security_phase_failed() {
  local log_file="$1"
  grep -Eq '(RestSecurityBuilder|phaseSecurity|Global validity failure: invalid gene named)' "$log_file"
}

evomaster_completed_successfully() {
  local log_file="$1"
  local report_file="$2"
  [[ -f "$report_file" ]] && grep -q 'EvoMaster process has completed successfully' "$log_file"
}

evomaster_report_has_zero_faults() {
  local report_file="$1"
  [[ -f "$report_file" ]] && jq -e '(.faults.totalNumber // 1) == 0' "$report_file" >/dev/null 2>&1
}

normalize_evomaster_exit_status() {
  local status="$1"
  local log_file="$2"
  local report_file="$3"
  if [[ "$status" == "124" ]] && {
    evomaster_completed_successfully "$log_file" "$report_file" || evomaster_report_has_zero_faults "$report_file"
  }; then
    printf '0\n'
  else
    printf '%s\n' "$status"
  fi
}

normalize_evomaster_sweep_exit_status() {
  local status="$1"
  local log_file="$2"
  local report_file="$3"
  local faults
  status="$(normalize_evomaster_exit_status "$status" "$log_file" "$report_file")"
  if [[ "$status" == "124" && "$EVOMASTER_COVERAGE_SWEEP_TIMEOUTS_FATAL" != "true" ]]; then
    printf '0\n'
    return
  fi
  if [[ "$status" == "124" && -f "$report_file" ]]; then
    faults="$(jq -r '.faults.totalNumber // 0' "$report_file" 2>/dev/null || printf '1\n')"
    if [[ "$faults" == "0" ]]; then
      printf '0\n'
      return
    fi
  fi
  printf '%s\n' "$status"
}

run_evomaster_core() {
  local log_file="$1"
  local report_file="$2"
  local timeout_seconds="$3"
  shift 3
  local start_epoch
  local now
  local completion_epoch=0
  local status=0
  : > "$log_file"
  "$@" >"$log_file" 2>&1 &
  local pid=$!
  start_epoch="$(now_epoch)"
  while kill -0 "$pid" >/dev/null 2>&1; do
    now="$(now_epoch)"
    if evomaster_completed_successfully "$log_file" "$report_file"; then
      if [[ "$completion_epoch" == "0" ]]; then
        completion_epoch="$now"
      fi
      if [[ "$((now - completion_epoch))" -ge "$EVOMASTER_COMPLETION_GRACE_SECONDS" ]]; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" >/dev/null 2>&1; then
          kill -9 "$pid" >/dev/null 2>&1 || true
        fi
        wait "$pid" >/dev/null 2>&1 || true
        return 0
      fi
    fi
    if [[ "$timeout_seconds" -gt 0 && "$((now - start_epoch))" -ge "$timeout_seconds" ]]; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep "$EVOMASTER_TIMEOUT_KILL_AFTER_SECONDS"
      if kill -0 "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" >/dev/null 2>&1 || true
      fi
      wait "$pid" >/dev/null 2>&1 || true
      if evomaster_report_has_zero_faults "$report_file"; then
        return 0
      fi
      return 124
    fi
    sleep 1
  done
  wait "$pid" || status=$?
  return "$status"
}

evomaster_args_with_security_disabled() {
  local args=("$@")

  # Disable security.
  readarray -t args < <(evomaster_args_with_option_value "security" "false" "${args[@]}")

  # EvoMaster treats explicit --xss as invalid when security=false.
  # Remove it completely instead of setting it to false.
  readarray -t args < <(evomaster_args_without_option "xss" "${args[@]}")

  printf '%s\n' "${args[@]}"
}

evomaster_args_with_option_value() {
  local option="$1"
  local value="$2"
  shift 2
  local args=("$@")
  local rewritten=()
  local i=0
  local replaced=false
  while [[ "$i" -lt "${#args[@]}" ]]; do
    if [[ "${args[$i]}" == "--$option" ]]; then
      rewritten+=("--$option" "$value")
      i=$((i + 2))
      replaced=true
    else
      rewritten+=("${args[$i]}")
      i=$((i + 1))
    fi
  done
  if [[ "$replaced" != "true" ]]; then
    rewritten+=("--$option" "$value")
  fi
  printf '%s\n' "${rewritten[@]}"
}

evomaster_args_without_option() {
  local option="$1"
  shift
  local args=("$@")
  local rewritten=()
  local i=0
  while [[ "$i" -lt "${#args[@]}" ]]; do
    if [[ "${args[$i]}" == "--$option" ]]; then
      i=$((i + 2))
    else
      rewritten+=("${args[$i]}")
      i=$((i + 1))
    fi
  done
  printf '%s\n' "${rewritten[@]}"
}

evomaster_args_without_header_name() {
  local header_name="$1"
  shift
  local args=("$@")
  local rewritten=()
  local i=0
  local option
  local value
  local lower_value
  local lower_header
  lower_header="$(printf '%s' "$header_name" | tr '[:upper:]' '[:lower:]')"
  while [[ "$i" -lt "${#args[@]}" ]]; do
    option="${args[$i]}"
    value="${args[$((i + 1))]:-}"
    if [[ "$option" =~ ^--header[0-2]$ ]]; then
      lower_value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
      if [[ "$lower_value" == "$lower_header:"* ]]; then
        i=$((i + 2))
        continue
      fi
      rewritten+=("$option" "$value")
      i=$((i + 2))
    else
      rewritten+=("$option")
      i=$((i + 1))
    fi
  done
  printf '%s\n' "${rewritten[@]}"
}

evomaster_next_header_option() {
  local args=("$@")
  local index=0
  local used
  local arg
  while [[ "$index" -le 2 ]]; do
    used=false
    for arg in "${args[@]}"; do
      if [[ "$arg" == "--header$index" ]]; then
        used=true
        break
      fi
    done
    if [[ "$used" != "true" ]]; then
      printf -- '--header%s\n' "$index"
      return 0
    fi
    index=$((index + 1))
  done
  return 1
}

count_log_pattern() {
  local log_file="$1"
  local pattern="$2"
  if [[ ! -f "$log_file" ]]; then
    printf '0\n'
    return
  fi
  grep -E -c "$pattern" "$log_file" || true
}

count_log_pattern_in_files() {
  local pattern="$1"
  shift
  local total=0
  local count
  for log_file in "$@"; do
    count="$(count_log_pattern "$log_file" "$pattern")"
    total=$((total + count))
  done
  printf '%s\n' "$total"
}

csv_stat_value() {
  local csv_file="$1"
  local column_name="$2"
  if [[ ! -f "$csv_file" ]]; then
    printf '0\n'
    return
  fi
  awk -F, -v column="$column_name" '
    NR == 1 {
      for (i = 1; i <= NF; i++) {
        if ($i == column) {
          idx = i
          break
        }
      }
      next
    }
    NR == 2 && idx {
      print $idx
      found = 1
      exit
    }
    END {
      if (!found) {
        print 0
      }
    }
  ' "$csv_file"
}

log_stat_value() {
  local log_file="$1"
  local label="$2"
  if [[ ! -f "$log_file" ]]; then
    printf '0\n'
    return
  fi
  grep -E "\\* ${label}: [0-9]+" "$log_file" | tail -n 1 | sed -E "s/.*${label}: ([0-9]+).*/\\1/" || true
}

stat_value() {
  local csv_file="$1"
  local column_name="$2"
  local log_file="$3"
  local log_label="$4"
  local value
  value="$(csv_stat_value "$csv_file" "$column_name")"
  if [[ "$value" == "0" && -n "$log_label" ]]; then
    value="$(log_stat_value "$log_file" "$log_label")"
    if [[ -z "$value" ]]; then
      value="0"
    fi
  fi
  printf '%s\n' "$value"
}

evomaster_timeout_seconds() {
  local seconds="$1"
  local minimize_minutes="$2"
  local extra_seconds="$3"
  local timeout_override="$4"
  if [[ -n "$timeout_override" ]]; then
    printf '%s\n' "$timeout_override"
    return
  fi
  local post_search_seconds="$extra_seconds"
  if [[ "$EVOMASTER_POST_SEARCH_TIMEOUT_PERCENT" -gt 0 ]]; then
    local proportional_post_search_seconds="$(((seconds * EVOMASTER_POST_SEARCH_TIMEOUT_PERCENT + 99) / 100))"
    if [[ "$proportional_post_search_seconds" -gt "$post_search_seconds" ]]; then
      post_search_seconds="$proportional_post_search_seconds"
    fi
  fi
  printf '%s\n' "$((seconds + (minimize_minutes * 60) + post_search_seconds))"
}

write_unique_json_array_from_lines() {
  local lines_file="$1"
  local output_file="$2"
  if [[ -e "$lines_file" || -r "$lines_file" ]]; then
    sort -u "$lines_file" | jq -R -s 'split("\n") | map(select(length > 0))' > "$output_file"
  else
    printf '[]\n' > "$output_file"
  fi
}

write_evomaster_endpoint_coverage() {
  local report_file="$1"
  local exercised_file="$2"
  local successful_file="$3"
  if [[ -f "$report_file" ]]; then
    jq '[.problemDetails.rest.coveredHttpStatus[]? | select(.endpointId | startswith("OPTIONS:") | not) | .endpointId] | unique' "$report_file" > "$exercised_file"
    jq '[.problemDetails.rest.coveredHttpStatus[]? | select((.endpointId | startswith("OPTIONS:") | not) and (.httpStatus | any(. >= 200 and . < 300))) | .endpointId] | unique' "$report_file" > "$successful_file"
  else
    printf '[]\n' > "$exercised_file"
    printf '[]\n' > "$successful_file"
  fi
}

write_missing_2xx_endpoints() {
  local report_file="$1"
  local successful_file="$2"
  local missing_file="$3"
  if [[ -f "$report_file" ]]; then
    jq -n --slurpfile declared <(jq '.problemDetails.rest.endpointIds // []' "$report_file") --slurpfile covered "$successful_file" \
      '($declared[0] // []) - ($covered[0] // [])' > "$missing_file"
  else
    printf '[]\n' > "$missing_file"
  fi
}

endpoint_slug() {
  local endpoint_id="$1"
  local slug
  slug="$(printf '%s' "$endpoint_id" | tr -cs 'A-Za-z0-9._-' '_' | sed -E 's/^_+//; s/_+$//')"
  if [[ -z "$slug" ]]; then
    slug="endpoint"
  fi
  printf '%s\n' "$slug"
}

coverage_sweep_candidate_endpoint_ids() {
  local missing_file="$1"
  jq -r '.[]' "$missing_file" | while IFS= read -r endpoint_id; do
    local rank=9
    case "$endpoint_id" in
      PATCH:*|PUT:*) rank=0 ;;
      POST:*/api/listener/*|POST:*/listener/*) rank=1 ;;
      POST:*) rank=2 ;;
      GET:*"{"*"}"*) rank=3 ;;
      GET:*) rank=4 ;;
      DELETE:*) rank=5 ;;
    esac
    printf '%s\t%s\n' "$rank" "$endpoint_id"
  done | sort -n -k1,1 | cut -f2-
}

evomaster_endpoint_focus_path() {
  local schema_file="$1"
  local endpoint_id="$2"
  if [[ -f "$schema_file" ]]; then
    node "$EVOMASTER_FOCUS_PATH_RESOLVER" "$schema_file" "$endpoint_id"
  elif [[ "$endpoint_id" =~ ^[A-Z]+:(/.*)$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  else
    printf '%s\n' "$endpoint_id"
  fi
}

run_evomaster_whitebox() {
  local name="$1"
  local app_dir="$2"
  local db_user="$3"
  local db_name="$4"
  local artifact_output_dir="$5"
  local seed_file="${6:-}"
  local auth_token="${7:-}"
  local controller_port="${8:-$EVOMASTER_CONTROLLER_PORT}"
  local openapi_schema_file="${9:-$app_dir/src/main/resources/swagger/api.yml}"
  local seed_summary_file="${10:-}"
  local openapi_examples_file="${11:-}"
  local openapi_examples_summary_file="${12:-}"
  local evomaster_effective_openapi_file="$openapi_schema_file"
  local em_dir="$artifact_output_dir/evomaster"
  local driver_log="$em_dir/driver.log"
  local em_log="$em_dir/evomaster.log"
  local stats_file="$em_dir/statistics.csv"
  local snapshot_file="$em_dir/snapshot-statistics.csv"
  local config_file="$em_dir/evomaster-config.yaml"
  local seed_summary_status_file="$em_dir/seed-summary.json"
  local openapi_examples_summary_status_file="$em_dir/openapi-examples-summary.json"
  local generated_tests_dir="$em_dir/generated-tests"
  local em_report="$generated_tests_dir/report.json"
  local faults_summary="$em_dir/faults-summary.json"
  local common_em_args=()
  local em_args=()
  local em_java_opts=()
  local seed_args=()
  local active_seed_args=()
  local run_args=()
  local security_disabled_args=()
  local extra_args=()
  local em_timeout="$EVOMASTER_TIMEOUT_SECONDS"
  local em_faults=0
  local em_report_present=false
  local declared_endpoint_count=0
  local exercised_endpoint_count=0
  local successful_endpoint_count=0
  local seed_count=0
  local writer_warning_count=0
  local writer_missing_primary_key_count=0
  local seed_parser_warning_count=0
  local seed_missing_required_parameter_warning_count=0
  local seed_experimental_warning_count=0
  local driver_sql_insertion_failure_count=0
  local driver_sql_check_violation_count=0
  local driver_sql_foreign_key_violation_count=0
  local driver_sql_temporal_failure_count=0
  local driver_instrumentation_error_count=0
  local generated_test_file_count=0
  local evomaster_elapsed_seconds=0
  local evomaster_evaluated_tests=0
  local evomaster_evaluated_actions=0
  local evomaster_generated_tests=0
  local evomaster_generated_test_total_size=0
  local evomaster_covered_targets=0
  local evomaster_number_of_lines=0
  local evomaster_covered_lines=0
  local evomaster_number_of_branches=0
  local evomaster_covered_branches=0
  local evomaster_number_of_units=0
  local seed_retry=false
  local seeded_failure_log=""
  local security_retry=false
  local security_failure_log=""
  local successful_endpoints_file="$em_dir/successful-endpoints.json"
  local exercised_endpoints_file="$em_dir/exercised-endpoints.json"
  local missing_2xx_endpoints_file="$em_dir/missing-2xx-endpoints.json"
  local coverage_sweep_dir="$em_dir/coverage-sweep"
  local coverage_sweep_reports_file="$em_dir/coverage-sweep-reports.json"
  local coverage_sweep_reports_lines_file="$em_dir/coverage-sweep-reports.jsonl"
  local coverage_sweep_attempted_file="$em_dir/coverage-sweep-attempted-endpoints.json"
  local coverage_sweep_attempted_lines_file="$em_dir/coverage-sweep-attempted-endpoints.txt"
  local coverage_sweep_focus_resolution_log="$em_dir/coverage-sweep-focus-resolution.log"
  local covered2xx_lines_file="$em_dir/covered2xx-endpoints.txt"
  local exercised_lines_file="$em_dir/exercised-endpoints.txt"
  local coverage_sweep_run_count=0
  local coverage_sweep_failure_log=""
  local coverage_sweep_logs=()
  local coverage_sweep_attempted=()
  local endpoint_id
  local focus_path
  local focus_option
  local evomaster_start_epoch
  local evomaster_end_epoch
  local main_start_epoch
  local main_end_epoch
  local main_duration_seconds=0
  local coverage_sweep_start_epoch=""
  local coverage_sweep_end_epoch=""
  local coverage_sweep_total_duration_seconds=0
  local coverage_sweep_gain_count=0
  local coverage_sweep_no_gain_streak=0
  local coverage_sweep_stop_reason=""
  local coverage_sweep_average_duration_seconds=0
  local coverage_sweep_effective_enabled=false
  local pkg
  pkg="$(package_name "$app_dir")"
  if [[ -z "$pkg" ]]; then
    echo "Could not determine packageName for $app_dir" >&2
    return 1
  fi
  if [[ ! -f "$EVOMASTER_JAR" ]]; then
    echo "EvoMaster JAR not found: $EVOMASTER_JAR" >&2
    return 1
  fi

  rm -rf "$em_dir"
  mkdir -p "$generated_tests_dir"
  printf 'configs: {}\n' > "$config_file"
  if [[ -n "$seed_summary_file" && -f "$seed_summary_file" ]]; then
    jq . "$seed_summary_file" > "$seed_summary_status_file"
  else
    printf '{}\n' > "$seed_summary_status_file"
  fi
  if [[ -n "$openapi_examples_summary_file" && -f "$openapi_examples_summary_file" ]]; then
    jq . "$openapi_examples_summary_file" > "$openapi_examples_summary_status_file"
  else
    printf '{}\n' > "$openapi_examples_summary_status_file"
  fi
  evomaster_start_epoch="$(now_epoch)"

  timestamped_step "$name" "start EvoMaster white-box driver"
  setsid env \
    MAVEN_OPTS="$EVOMASTER_DRIVER_JVM_ARGS ${MAVEN_OPTS:-}" \
    LIQUIBASE_ANALYTICS_ENABLED=false \
    EVOMASTER_CONTROLLER_PORT="$controller_port" \
    EVOMASTER_DB_URL="jdbc:postgresql://localhost:5432/$db_name" \
    EVOMASTER_DB_USERNAME="$db_user" \
    EVOMASTER_SPRING_PROFILES="dev,api-docs" \
    EVOMASTER_LIQUIBASE_CONTEXTS="$LIQUIBASE_CONTEXTS" \
    bash -c '
      cd "$1"
      ./mvnw "${@:4}" -P'!webapp' -Dskip.npm=true -DskipTests=true \
      -Dexec.executable=java \
      -Dexec.classpathScope=test \
      -Dexec.longClasspath=true \
      -Dexec.args="$2 -cp %classpath $3.evomaster.EvoMasterController" \
      test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:exec
    ' bash "$app_dir" "$EVOMASTER_DRIVER_JVM_ARGS" "$pkg" "${MAVEN_ARGS[@]}" >"$driver_log" 2>&1 < /dev/null &
  driver_pid=$!
  wait_for_controller "$controller_port" "$driver_log" "$driver_pid"

  main_start_epoch="$(now_epoch)"
  timestamped_step "$name" "EvoMaster white-box fuzzing start (${EVOMASTER_SECONDS_PER_API}s budget)"
  common_em_args=(
    --configPath "$config_file"
    --blackBox false
    --sutControllerPort "$controller_port"
    --minimizeTimeout "$EVOMASTER_MINIMIZE_TIMEOUT_MINUTES"
    --tcpTimeoutMs "$EVOMASTER_TCP_TIMEOUT_MS"
    --testTimeout "$EVOMASTER_TEST_TIMEOUT"
    --algorithm "$EVOMASTER_ALGORITHM"
    --security "$EVOMASTER_SECURITY"
    --xss "$EVOMASTER_XSS"
    --extraHeader "$EVOMASTER_EXTRA_HEADER"
    --extraQueryParam "$EVOMASTER_EXTRA_QUERY_PARAM"
    --doCollectImpact "$EVOMASTER_DO_COLLECT_IMPACT"
    --adaptiveGeneSelectionMethod "$EVOMASTER_ADAPTIVE_GENE_SELECTION_METHOD"
    --archiveGeneMutation "$EVOMASTER_ARCHIVE_GENE_MUTATION"
    --generateSqlDataWithSearch "$EVOMASTER_GENERATE_SQL_DATA_WITH_SEARCH"
    --allowInvalidData "$EVOMASTER_ALLOW_INVALID_DATA"
    --resourceSampleStrategy "$EVOMASTER_RESOURCE_SAMPLE_STRATEGY"
    --probOfSmartSampling "$EVOMASTER_PROB_OF_SMART_SAMPLING"
    --probOfEnablingResourceDependencyHeuristics "$EVOMASTER_PROB_OF_ENABLING_RESOURCE_DEPENDENCY_HEURISTICS"
    --probUseRestLinks "$EVOMASTER_PROB_USE_REST_LINKS"
    --maxTestSize "$EVOMASTER_MAX_TEST_SIZE"
    --expandRestIndividuals "$EVOMASTER_EXPAND_REST_INDIVIDUALS"
    --taintOnSampling "$EVOMASTER_TAINT_ON_SAMPLING"
    --useResponseDataPool "$EVOMASTER_USE_RESPONSE_DATA_POOL"
    --probNamedExamples "$EVOMASTER_PROB_NAMED_EXAMPLES"
    --probRestExamples "$EVOMASTER_PROB_REST_EXAMPLES"
    --probRestDefault "$EVOMASTER_PROB_REST_DEFAULT"
    --outputFormat "$EVOMASTER_OUTPUT_FORMAT"
    --skipFailureSQLInTestFile "$EVOMASTER_SKIP_FAILURE_SQL_IN_TEST_FILE"
    --writeStatistics true
    --showProgress false
    --avoidNonDeterministicLogs true
  )
  if [[ -n "$EVOMASTER_EXTRA_PHASE_BUDGET_PERCENTAGE" ]]; then
    common_em_args+=(
      --extraPhaseBudgetPercentage "$EVOMASTER_EXTRA_PHASE_BUDGET_PERCENTAGE"
    )
  fi
  if [[ -n "$EVOMASTER_PREMATURE_STOP" ]]; then
    common_em_args+=(
      --prematureStop "$EVOMASTER_PREMATURE_STOP"
    )
  fi
  if [[ -n "$openapi_examples_file" && -f "$openapi_examples_file" ]]; then
    evomaster_effective_openapi_file="$openapi_examples_file"
    common_em_args+=(
      --overrideOpenAPIUrl "file://$openapi_examples_file"
    )
  fi
  if [[ -n "$seed_file" && -f "$seed_file" ]]; then
    seed_count="$(jq -r '.item | length // 0' "$seed_file")"
    if [[ "$EVOMASTER_POSTMAN_SEEDS_ENABLED" == "true" && "$EVOMASTER_SEED_FROM_SMOKE" == "true" && "$seed_count" != "0" ]] &&
      [[ ! -f "$openapi_examples_file" || "$EVOMASTER_POSTMAN_SEEDS_WITH_OPENAPI_EXAMPLES" == "true" ]]; then
      seed_args+=(
        --seedTestCases true
        --seedTestCasesFormat POSTMAN
        --seedTestCasesPath "$seed_file"
        --exportTestCasesDuringSeeding "$EVOMASTER_EXPORT_TEST_CASES_DURING_SEEDING"
      )
    fi
  fi
  fixed_header_index=0
  if [[ "$EVOMASTER_AUTH_FROM_SMOKE_TOKEN" == "true" && -n "$auth_token" ]]; then
    common_em_args+=(
      "--header${fixed_header_index}" "Authorization: Bearer $auth_token"
    )
    fixed_header_index=$((fixed_header_index + 1))
  fi
  if [[ -n "$EVOMASTER_ACCEPT_HEADER" ]]; then
    common_em_args+=(
      "--header${fixed_header_index}" "Accept: $EVOMASTER_ACCEPT_HEADER"
    )
  fi
  if [[ "$EVOMASTER_SECURITY" != "true" ]]; then
    readarray -t common_em_args < <(evomaster_args_without_option "xss" "${common_em_args[@]}")
  fi
  if [[ -n "$EVOMASTER_EXTRA_ARGS" ]]; then
    read -r -a extra_args <<< "$EVOMASTER_EXTRA_ARGS"
    common_em_args+=("${extra_args[@]}")
  fi
  em_args=(
    "${common_em_args[@]}"
    --maxTime "${EVOMASTER_SECONDS_PER_API}s"
    --outputFolder "$generated_tests_dir"
    --statisticsFile "$stats_file"
    --snapshotStatisticsFile "$snapshot_file"
  )
  if [[ -n "$EVOMASTER_JAVA_OPTS" ]]; then
    read -r -a em_java_opts <<< "$EVOMASTER_JAVA_OPTS"
  fi
  em_timeout="$(evomaster_timeout_seconds "$EVOMASTER_SECONDS_PER_API" "$EVOMASTER_MINIMIZE_TIMEOUT_MINUTES" "$EVOMASTER_EXTRA_TIMEOUT_SECONDS" "$em_timeout")"
  active_seed_args=("${seed_args[@]}")
  run_args=("${em_args[@]}" "${active_seed_args[@]}")
  set +e
  run_evomaster_core "$em_log" "$em_report" "$em_timeout" java "${em_java_opts[@]}" -jar "$EVOMASTER_JAR" "${run_args[@]}"
  em_status=$?
  set -e
  em_status="$(normalize_evomaster_exit_status "$em_status" "$em_log" "$em_report")"

  if [[ "$em_status" != "0" && "${#seed_args[@]}" -gt 0 && "$EVOMASTER_RETRY_WITHOUT_SEEDS_ON_SEED_FAILURE" == "true" ]] &&
    evomaster_seed_parser_failed "$em_log"; then
    seed_retry=true
    seeded_failure_log="$em_dir/evomaster-seeded-failure.log"
    mv "$em_log" "$seeded_failure_log"
    rm -rf "$generated_tests_dir"
    mkdir -p "$generated_tests_dir"
    active_seed_args=()
    echo "=== [$name] EvoMaster seed parser failed; retrying white-box fuzzing without smoke seeds ==="
    set +e
    run_evomaster_core "$em_log" "$em_report" "$em_timeout" java "${em_java_opts[@]}" -jar "$EVOMASTER_JAR" "${em_args[@]}"
    em_status=$?
    set -e
    em_status="$(normalize_evomaster_exit_status "$em_status" "$em_log" "$em_report")"
  fi

  if [[ "$em_status" != "0" && "$EVOMASTER_SECURITY" == "true" && "$EVOMASTER_RETRY_WITHOUT_SECURITY_ON_SECURITY_FAILURE" == "true" ]] &&
    evomaster_security_phase_failed "$em_log"; then
    security_retry=true
    security_failure_log="$em_dir/evomaster-security-failure.log"
    mv "$em_log" "$security_failure_log"
    rm -rf "$generated_tests_dir"
    mkdir -p "$generated_tests_dir"
    readarray -t security_disabled_args < <(evomaster_args_with_security_disabled "${em_args[@]}")
    echo "=== [$name] EvoMaster security phase failed; retrying white-box fuzzing with --security false ==="
    set +e
    run_evomaster_core "$em_log" "$em_report" "$em_timeout" java "${em_java_opts[@]}" -jar "$EVOMASTER_JAR" "${security_disabled_args[@]}" "${active_seed_args[@]}"
    em_status=$?
    set -e
    em_status="$(normalize_evomaster_exit_status "$em_status" "$em_log" "$em_report")"
  fi
  if [[ "$em_status" == "0" && ! -f "$em_report" ]] && grep -q 'Invalid parameter settings' "$em_log"; then
    em_status=64
  fi
  main_end_epoch="$(now_epoch)"
  main_duration_seconds="$(duration_seconds "$main_start_epoch" "$main_end_epoch")"
  timestamped_step "$name" "EvoMaster main run finished in ${main_duration_seconds}s with exit ${em_status}"

  if [[ -f "$em_report" ]]; then
    em_report_present=true

    # Keep a stable, easy-to-archive copy next to status.json.
    cp -f "$em_report" "$em_dir/report.json"

    em_faults="$(jq -r '.faults.totalNumber // 0' "$em_report")"
    jq '.faults.foundFaults // []' "$em_report" > "$faults_summary"
    declared_endpoint_count="$(jq -r '.problemDetails.rest.endpointIds | length // 0' "$em_report")"
    write_evomaster_endpoint_coverage "$em_report" "$exercised_endpoints_file" "$successful_endpoints_file"
    exercised_endpoint_count="$(jq -r 'length' "$exercised_endpoints_file")"
    successful_endpoint_count="$(jq -r 'length' "$successful_endpoints_file")"
    write_missing_2xx_endpoints "$em_report" "$successful_endpoints_file" "$missing_2xx_endpoints_file"
  else
    printf '[]\n' > "$faults_summary"
    printf '[]\n' > "$exercised_endpoints_file"
    printf '[]\n' > "$successful_endpoints_file"
    printf '[]\n' > "$missing_2xx_endpoints_file"
  fi

  : > "$covered2xx_lines_file"
  : > "$exercised_lines_file"
  jq -r '.[]' "$successful_endpoints_file" >> "$covered2xx_lines_file"
  jq -r '.[]' "$exercised_endpoints_file" >> "$exercised_lines_file"
  printf '[]\n' > "$coverage_sweep_attempted_file"
  : > "$coverage_sweep_attempted_lines_file"
  : > "$coverage_sweep_focus_resolution_log"
  printf '[]\n' > "$coverage_sweep_reports_file"
  : > "$coverage_sweep_reports_lines_file"

  if [[ "$EVOMASTER_COVERAGE_SWEEP_ENABLED" == "true" ]]; then
    coverage_sweep_effective_enabled=true
  elif [[ "$EVOMASTER_COVERAGE_SWEEP_ENABLED" == "auto" ]]; then
    if [[
      "$EVOMASTER_COVERAGE_SWEEP_AUTO_SEEDED_APIS" == "true" &&
        ( "${#active_seed_args[@]}" -gt 0 || ( -n "$openapi_examples_file" && -f "$openapi_examples_file" ) )
    ]]; then
      coverage_sweep_effective_enabled=true
    elif [[ "$EVOMASTER_COVERAGE_SWEEP_AUTO_SMALL_APIS" == "true" && "$declared_endpoint_count" -le "$EVOMASTER_COVERAGE_SWEEP_AUTO_MAX_DECLARED_ENDPOINTS" ]]; then
      coverage_sweep_effective_enabled=true
    else
      coverage_sweep_stop_reason="auto-skipped-no-smoke-seeds-or-examples"
    fi
  else
    coverage_sweep_stop_reason="disabled"
  fi

  if [[
    "$em_status" == "0" &&
      "$em_report_present" == "true" &&
      "$coverage_sweep_effective_enabled" == "true" &&
      "$declared_endpoint_count" -gt "$successful_endpoint_count" &&
      "$EVOMASTER_COVERAGE_SWEEP_MAX_ENDPOINTS" -gt 0 &&
      "$EVOMASTER_COVERAGE_SWEEP_SECONDS_PER_ENDPOINT" -gt 0
  ]]; then
    declare -A coverage_sweep_focus_seen=()
    while IFS= read -r endpoint_id; do
      if ! focus_path="$(evomaster_endpoint_focus_path "$evomaster_effective_openapi_file" "$endpoint_id" 2>>"$coverage_sweep_focus_resolution_log")"; then
        continue
      fi
      focus_option="--endpointFocus"
      if [[ "$endpoint_id" =~ ^[A-Z]+:(/.*)$ && "$focus_path" != "${BASH_REMATCH[1]}" ]]; then
        focus_option="--endpointPrefix"
      fi
      if [[ -z "$focus_path" ]]; then
        continue
      fi
      if [[ -n "${coverage_sweep_focus_seen[$focus_path]:-}" ]]; then
        continue
      fi
      coverage_sweep_focus_seen["$focus_path"]=true
      coverage_sweep_attempted+=("$endpoint_id")
      if [[ "${#coverage_sweep_attempted[@]}" -ge "$EVOMASTER_COVERAGE_SWEEP_MAX_ENDPOINTS" ]]; then
        break
      fi
    done < <(coverage_sweep_candidate_endpoint_ids "$missing_2xx_endpoints_file")
    printf '%s\n' "${coverage_sweep_attempted[@]}" > "$coverage_sweep_attempted_lines_file"
    write_unique_json_array_from_lines "$coverage_sweep_attempted_lines_file" "$coverage_sweep_attempted_file"
    mkdir -p "$coverage_sweep_dir"
    local sweep_output_dir
    local sweep_log
    local sweep_stats_file
    local sweep_snapshot_file
    local sweep_report
    local sweep_exercised_file
    local sweep_successful_file
    local sweep_args
    local sweep_run_args
    local sweep_seed_args
    local sweep_seed_file
    local sweep_stripped_seed_file
    local sweep_seed_summary_file
    local sweep_stripped_seed_summary_file
    local sweep_common_args
    local sweep_accept_header_option
    local sweep_seed_count
    local sweep_seed_retry
    local sweep_seed_strip_retry
    local sweep_seeded_failure_log
    local sweep_stripped_seeded_failure_log
    local sweep_status
    local sweep_raw_status
    local sweep_faults
    local sweep_timeout
    local sweep_start_epoch
    local sweep_end_epoch
    local sweep_duration_seconds
    local previous_successful_count
    local current_successful_count
    local sweep_successful_gain
    local sweep_slug
    local sweep_index=0
    sweep_timeout="$(evomaster_timeout_seconds "$EVOMASTER_COVERAGE_SWEEP_SECONDS_PER_ENDPOINT" "$EVOMASTER_COVERAGE_SWEEP_MINIMIZE_TIMEOUT_MINUTES" "$EVOMASTER_COVERAGE_SWEEP_EXTRA_TIMEOUT_SECONDS" "")"
    coverage_sweep_start_epoch="$(now_epoch)"
    for endpoint_id in "${coverage_sweep_attempted[@]}"; do
      coverage_sweep_total_duration_seconds="$(duration_seconds "$coverage_sweep_start_epoch" "$(now_epoch)")"
      if [[ "$EVOMASTER_COVERAGE_SWEEP_MAX_WALL_SECONDS" -gt 0 && "$coverage_sweep_total_duration_seconds" -ge "$EVOMASTER_COVERAGE_SWEEP_MAX_WALL_SECONDS" ]]; then
        coverage_sweep_stop_reason="max-wall-seconds"
        break
      fi
      if [[ "$EVOMASTER_COVERAGE_SWEEP_MAX_WALL_SECONDS" -gt 0 && "$coverage_sweep_run_count" -gt 0 ]]; then
        coverage_sweep_average_duration_seconds="$((coverage_sweep_total_duration_seconds / coverage_sweep_run_count))"
        if [[ "$coverage_sweep_average_duration_seconds" -gt 0 &&
          "$((coverage_sweep_total_duration_seconds + coverage_sweep_average_duration_seconds))" -gt "$EVOMASTER_COVERAGE_SWEEP_MAX_WALL_SECONDS" ]]; then
          coverage_sweep_stop_reason="projected-max-wall-seconds"
          break
        fi
      fi
      if [[ "$EVOMASTER_COVERAGE_SWEEP_STOP_AFTER_NO_GAIN" -gt 0 && "$coverage_sweep_no_gain_streak" -ge "$EVOMASTER_COVERAGE_SWEEP_STOP_AFTER_NO_GAIN" ]]; then
        coverage_sweep_stop_reason="no-coverage-gain"
        break
      fi
      sweep_index=$((sweep_index + 1))
      sweep_slug="$(endpoint_slug "$endpoint_id")"
      if ! focus_path="$(evomaster_endpoint_focus_path "$evomaster_effective_openapi_file" "$endpoint_id" 2>>"$coverage_sweep_focus_resolution_log")"; then
        continue
      fi
      focus_option="--endpointFocus"
      if [[ "$endpoint_id" =~ ^[A-Z]+:(/.*)$ && "$focus_path" != "${BASH_REMATCH[1]}" ]]; then
        focus_option="--endpointPrefix"
      fi
      sweep_output_dir="$coverage_sweep_dir/$(printf '%03d' "$sweep_index")-$sweep_slug"
      sweep_log="$sweep_output_dir/evomaster.log"
      sweep_stats_file="$sweep_output_dir/statistics.csv"
      sweep_snapshot_file="$sweep_output_dir/snapshot-statistics.csv"
      sweep_report="$sweep_output_dir/report.json"
      sweep_exercised_file="$sweep_output_dir/exercised-endpoints.json"
      sweep_successful_file="$sweep_output_dir/successful-endpoints.json"
      sweep_seed_file="$sweep_output_dir/seed.postman_collection.json"
      sweep_stripped_seed_file="$sweep_output_dir/seed.path-only.postman_collection.json"
      sweep_seed_summary_file="$sweep_output_dir/seed-summary.json"
      sweep_stripped_seed_summary_file="$sweep_output_dir/seed-path-only-summary.json"
      sweep_seed_count=0
      sweep_seed_retry=false
      sweep_seed_strip_retry=false
      sweep_seeded_failure_log=""
      sweep_stripped_seeded_failure_log=""
      rm -rf "$sweep_output_dir"
      mkdir -p "$sweep_output_dir"
      previous_successful_count="$(sort -u "$covered2xx_lines_file" | sed '/^$/d' | wc -l)"
      sweep_start_epoch="$(now_epoch)"
      timestamped_step "$name" "EvoMaster focused coverage sweep start for $endpoint_id via $focus_path (${EVOMASTER_COVERAGE_SWEEP_SECONDS_PER_ENDPOINT}s budget)"
      readarray -t sweep_common_args < <(evomaster_args_with_option_value "minimizeTimeout" "$EVOMASTER_COVERAGE_SWEEP_MINIMIZE_TIMEOUT_MINUTES" "${common_em_args[@]}")
      readarray -t sweep_common_args < <(evomaster_args_with_option_value "security" "$EVOMASTER_COVERAGE_SWEEP_SECURITY" "${sweep_common_args[@]}")
      if [[ "$EVOMASTER_COVERAGE_SWEEP_SECURITY" != "true" ]]; then
        readarray -t sweep_common_args < <(evomaster_args_without_option "xss" "${sweep_common_args[@]}")
      fi
      readarray -t sweep_common_args < <(evomaster_args_with_option_value "extraHeader" "$EVOMASTER_COVERAGE_SWEEP_EXTRA_HEADER" "${sweep_common_args[@]}")
      readarray -t sweep_common_args < <(evomaster_args_with_option_value "extraQueryParam" "$EVOMASTER_COVERAGE_SWEEP_EXTRA_QUERY_PARAM" "${sweep_common_args[@]}")
      readarray -t sweep_common_args < <(evomaster_args_with_option_value "allowInvalidData" "$EVOMASTER_COVERAGE_SWEEP_ALLOW_INVALID_DATA" "${sweep_common_args[@]}")
      readarray -t sweep_common_args < <(evomaster_args_with_option_value "probNamedExamples" "$EVOMASTER_COVERAGE_SWEEP_PROB_NAMED_EXAMPLES" "${sweep_common_args[@]}")
      readarray -t sweep_common_args < <(evomaster_args_with_option_value "probRestExamples" "$EVOMASTER_COVERAGE_SWEEP_PROB_REST_EXAMPLES" "${sweep_common_args[@]}")
      readarray -t sweep_common_args < <(evomaster_args_with_option_value "probRestDefault" "$EVOMASTER_COVERAGE_SWEEP_PROB_REST_DEFAULT" "${sweep_common_args[@]}")
      readarray -t sweep_common_args < <(evomaster_args_without_header_name "Accept" "${sweep_common_args[@]}")
      if [[ -n "$EVOMASTER_COVERAGE_SWEEP_ACCEPT_HEADER" ]]; then
        if sweep_accept_header_option="$(evomaster_next_header_option "${sweep_common_args[@]}")"; then
          sweep_common_args+=("$sweep_accept_header_option" "Accept: $EVOMASTER_COVERAGE_SWEEP_ACCEPT_HEADER")
        fi
      fi
      sweep_args=(
        "${sweep_common_args[@]}"
        --maxTime "${EVOMASTER_COVERAGE_SWEEP_SECONDS_PER_ENDPOINT}s"
        --outputFolder "$sweep_output_dir"
        --statisticsFile "$sweep_stats_file"
        --snapshotStatisticsFile "$sweep_snapshot_file"
        "$focus_option" "$focus_path"
      )
      sweep_seed_args=()
      if [[ "$EVOMASTER_POSTMAN_SEEDS_ENABLED" == "true" && "$EVOMASTER_COVERAGE_SWEEP_WITH_SEEDS" == "true" && -f "$seed_file" ]]; then
        node "$EVOMASTER_SEED_FILTER" "$seed_file" "$sweep_seed_file" "$endpoint_id" > "$sweep_seed_summary_file"
        sweep_seed_count="$(jq -r '.itemCount // 0' "$sweep_seed_summary_file")"
        if [[ "$sweep_seed_count" != "0" ]]; then
          sweep_seed_args=(
            --seedTestCases true
            --seedTestCasesFormat POSTMAN
            --seedTestCasesPath "$sweep_seed_file"
            --exportTestCasesDuringSeeding "$EVOMASTER_EXPORT_TEST_CASES_DURING_SEEDING"
          )
        fi
      fi
      sweep_run_args=("${sweep_args[@]}" "${sweep_seed_args[@]}")
      set +e
      run_evomaster_core "$sweep_log" "$sweep_report" "$sweep_timeout" java "${em_java_opts[@]}" -jar "$EVOMASTER_JAR" "${sweep_run_args[@]}"
      sweep_raw_status=$?
      set -e
      sweep_status="$(normalize_evomaster_sweep_exit_status "$sweep_raw_status" "$sweep_log" "$sweep_report")"
      if [[ "$sweep_status" != "0" && "${#sweep_seed_args[@]}" -gt 0 && "$EVOMASTER_RETRY_WITHOUT_SEEDS_ON_SEED_FAILURE" == "true" ]] &&
        evomaster_seed_parser_failed "$sweep_log"; then
        sweep_seeded_failure_log="$sweep_output_dir/evomaster-seeded-failure.log"
        mv "$sweep_log" "$sweep_seeded_failure_log"
        rm -f "$sweep_report" "$sweep_stats_file" "$sweep_snapshot_file"
        if [[ "$EVOMASTER_COVERAGE_SWEEP_RETRY_PATH_ONLY_SEEDS" == "true" ]]; then
          echo "=== [$name] EvoMaster focused sweep seed parser failed; retrying $endpoint_id with path-only smoke seed ==="
          node "$EVOMASTER_SEED_FILTER" "$seed_file" "$sweep_stripped_seed_file" "$endpoint_id" --strip-bodies > "$sweep_stripped_seed_summary_file"
          sweep_seed_count="$(jq -r '.itemCount // 0' "$sweep_stripped_seed_summary_file")"
          if [[ "$sweep_seed_count" != "0" ]]; then
            sweep_seed_strip_retry=true
            sweep_run_args=(
              "${sweep_args[@]}"
              --seedTestCases true
              --seedTestCasesFormat POSTMAN
              --seedTestCasesPath "$sweep_stripped_seed_file"
              --exportTestCasesDuringSeeding "$EVOMASTER_EXPORT_TEST_CASES_DURING_SEEDING"
            )
            set +e
            run_evomaster_core "$sweep_log" "$sweep_report" "$sweep_timeout" java "${em_java_opts[@]}" -jar "$EVOMASTER_JAR" "${sweep_run_args[@]}"
            sweep_raw_status=$?
            set -e
            sweep_status="$(normalize_evomaster_sweep_exit_status "$sweep_raw_status" "$sweep_log" "$sweep_report")"
          fi
        fi
      fi
      if [[ "$sweep_status" != "0" && "${#sweep_seed_args[@]}" -gt 0 && "$EVOMASTER_RETRY_WITHOUT_SEEDS_ON_SEED_FAILURE" == "true" ]] &&
        {
          [[ -n "$sweep_seeded_failure_log" && "$EVOMASTER_COVERAGE_SWEEP_RETRY_PATH_ONLY_SEEDS" != "true" ]] ||
            evomaster_seed_parser_failed "$sweep_log"
        }; then
        sweep_seed_retry=true
        if [[ "$sweep_seed_strip_retry" == "true" ]]; then
          sweep_stripped_seeded_failure_log="$sweep_output_dir/evomaster-path-only-seeded-failure.log"
          mv "$sweep_log" "$sweep_stripped_seeded_failure_log"
        fi
        rm -f "$sweep_report" "$sweep_stats_file" "$sweep_snapshot_file"
        if [[ "$sweep_seed_strip_retry" == "true" ]]; then
          echo "=== [$name] EvoMaster focused sweep path-only seed parser failed; retrying $endpoint_id without smoke seed ==="
        else
          echo "=== [$name] EvoMaster focused sweep seed parser failed; retrying $endpoint_id without smoke seed ==="
        fi
        set +e
        run_evomaster_core "$sweep_log" "$sweep_report" "$sweep_timeout" java "${em_java_opts[@]}" -jar "$EVOMASTER_JAR" "${sweep_args[@]}"
        sweep_raw_status=$?
        set -e
        sweep_status="$(normalize_evomaster_sweep_exit_status "$sweep_raw_status" "$sweep_log" "$sweep_report")"
      fi
      if [[ "$sweep_status" == "0" && ! -f "$sweep_report" ]] && grep -q 'Invalid parameter settings' "$sweep_log"; then
        sweep_status=64
      fi
      sweep_end_epoch="$(now_epoch)"
      sweep_duration_seconds="$(duration_seconds "$sweep_start_epoch" "$sweep_end_epoch")"
      coverage_sweep_run_count=$((coverage_sweep_run_count + 1))
      coverage_sweep_logs+=("$sweep_log")
      if [[ -n "$sweep_seeded_failure_log" ]]; then
        coverage_sweep_logs+=("$sweep_seeded_failure_log")
      fi
      if [[ -n "$sweep_stripped_seeded_failure_log" ]]; then
        coverage_sweep_logs+=("$sweep_stripped_seeded_failure_log")
      fi
      if [[ -f "$sweep_report" ]]; then
        write_evomaster_endpoint_coverage "$sweep_report" "$sweep_exercised_file" "$sweep_successful_file"
        jq -r '.[]' "$sweep_successful_file" >> "$covered2xx_lines_file"
        jq -r '.[]' "$sweep_exercised_file" >> "$exercised_lines_file"
        sweep_faults="$(jq -r '.faults.totalNumber // 0' "$sweep_report")"
        em_faults=$((em_faults + sweep_faults))
      else
        printf '[]\n' > "$sweep_exercised_file"
        printf '[]\n' > "$sweep_successful_file"
        sweep_faults=0
      fi
      current_successful_count="$(sort -u "$covered2xx_lines_file" | sed '/^$/d' | wc -l)"
      sweep_successful_gain="$((current_successful_count - previous_successful_count))"
      if [[ "$sweep_successful_gain" -gt 0 ]]; then
        coverage_sweep_gain_count=$((coverage_sweep_gain_count + sweep_successful_gain))
        coverage_sweep_no_gain_streak=0
      else
        coverage_sweep_no_gain_streak=$((coverage_sweep_no_gain_streak + 1))
        if [[ -z "$coverage_sweep_stop_reason" && -f "$sweep_report" ]] && grep -q 'Potential faults: 0' "$sweep_log"; then
          coverage_sweep_stop_reason="no-gain-report-without-faults"
        fi
      fi
      timestamped_step "$name" "EvoMaster focused coverage sweep finished for $endpoint_id in ${sweep_duration_seconds}s; 2xx gain ${sweep_successful_gain}; exit ${sweep_status}"
      jq -n \
        --arg endpointId "$endpoint_id" \
        --arg focusPath "$focus_path" \
        --arg startEpoch "$sweep_start_epoch" \
        --arg endEpoch "$sweep_end_epoch" \
        --arg durationSeconds "$sweep_duration_seconds" \
        --arg status "$sweep_status" \
        --arg rawStatus "$sweep_raw_status" \
        --arg focusOption "$focus_option" \
        --arg report "$sweep_report" \
        --arg log "$sweep_log" \
        --arg seedFile "$sweep_seed_file" \
        --arg seedCount "$sweep_seed_count" \
        --arg seedRetryWithoutSeeds "$sweep_seed_retry" \
        --arg seedRetryWithStrippedBodies "$sweep_seed_strip_retry" \
        --arg seededFailureLog "$sweep_seeded_failure_log" \
        --arg strippedSeededFailureLog "$sweep_stripped_seeded_failure_log" \
        --arg faults "$sweep_faults" \
        --arg successfulEndpointGain "$sweep_successful_gain" \
        --slurpfile exercised "$sweep_exercised_file" \
        --slurpfile covered2xx "$sweep_successful_file" \
        '{endpointId: $endpointId, focusPath: $focusPath, focusOption: $focusOption, startEpoch: ($startEpoch | tonumber), startIso: ($startEpoch | tonumber | strftime("%Y-%m-%dT%H:%M:%SZ")), endEpoch: ($endEpoch | tonumber), endIso: ($endEpoch | tonumber | strftime("%Y-%m-%dT%H:%M:%SZ")), durationSeconds: ($durationSeconds | tonumber), exitCode: ($status | tonumber), rawExitCode: ($rawStatus | tonumber), timedOut: (($rawStatus | tonumber) == 124), report: $report, log: $log, seedFile: $seedFile, seedCount: ($seedCount | tonumber), seedRetryWithStrippedBodies: ($seedRetryWithStrippedBodies == "true"), seedRetryWithoutSeeds: ($seedRetryWithoutSeeds == "true"), seededFailureLog: $seededFailureLog, strippedSeededFailureLog: $strippedSeededFailureLog, faultCount: ($faults | tonumber), successfulEndpointGain: ($successfulEndpointGain | tonumber), exercisedEndpointIds: ($exercised[0] // []), covered2xxEndpointIds: ($covered2xx[0] // [])}' \
        >> "$coverage_sweep_reports_lines_file"
      if [[ "$sweep_status" != "0" ]]; then
        coverage_sweep_failure_log="$sweep_log"
        em_status="$sweep_status"
        break
      fi
    done
    coverage_sweep_end_epoch="$(now_epoch)"
    coverage_sweep_total_duration_seconds="$(duration_seconds "$coverage_sweep_start_epoch" "$coverage_sweep_end_epoch")"
    if [[ "$coverage_sweep_run_count" -gt 0 ]]; then
      coverage_sweep_average_duration_seconds="$((coverage_sweep_total_duration_seconds / coverage_sweep_run_count))"
    fi
    jq -s '.' "$coverage_sweep_reports_lines_file" > "$coverage_sweep_reports_file"
    write_unique_json_array_from_lines "$covered2xx_lines_file" "$successful_endpoints_file"
    write_unique_json_array_from_lines "$exercised_lines_file" "$exercised_endpoints_file"
    write_missing_2xx_endpoints "$em_report" "$successful_endpoints_file" "$missing_2xx_endpoints_file"
    exercised_endpoint_count="$(jq -r 'length' "$exercised_endpoints_file")"
    successful_endpoint_count="$(jq -r 'length' "$successful_endpoints_file")"
  fi

  cleanup_driver "$driver_pid"
  driver_pid=""

  writer_warning_count="$(count_log_pattern_in_files 'A failure has occurred in writing test' "$em_log" "$seeded_failure_log" "$security_failure_log" "${coverage_sweep_logs[@]}")"
  writer_missing_primary_key_count="$(count_log_pattern_in_files 'Input genes do not contain primary key' "$em_log" "$seeded_failure_log" "$security_failure_log" "${coverage_sweep_logs[@]}")"
  seed_parser_warning_count="$(count_log_pattern_in_files 'org\.evomaster\.core\.problem\.rest\.seeding|PostmanParser|initSeededTests|AbstractParser|Unexpected gene found in RestCallAction' "$em_log" "$seeded_failure_log" "$security_failure_log" "${coverage_sweep_logs[@]}")"
  seed_missing_required_parameter_warning_count="$(count_log_pattern_in_files 'Required parameter .* was not found in a seeded request' "$em_log" "$seeded_failure_log" "$security_failure_log" "${coverage_sweep_logs[@]}")"
  seed_experimental_warning_count="$(count_log_pattern_in_files 'experimental settings.*seedTestCases|Activated experimental settings: .*seedTestCases' "$em_log" "$seeded_failure_log" "$security_failure_log" "${coverage_sweep_logs[@]}")"
  driver_sql_insertion_failure_count="$(count_log_pattern "$driver_log" 'Failed to execute insertion')"
  driver_sql_check_violation_count="$(count_log_pattern "$driver_log" 'violates check constraint')"
  driver_sql_foreign_key_violation_count="$(count_log_pattern "$driver_log" 'violates foreign key constraint')"
  driver_sql_temporal_failure_count="$(count_log_pattern "$driver_log" 'date/time field value out of range')"
  driver_instrumentation_error_count="$(count_log_pattern "$driver_log" 'ERROR - Failed to instrument')"
  generated_test_file_count="$(find "$em_dir" -type f -name '*Test.java' | wc -l)"
  evomaster_elapsed_seconds="$(csv_stat_value "$stats_file" "elapsedSeconds")"
  evomaster_evaluated_tests="$(stat_value "$stats_file" "evaluatedTests" "$em_log" "Evaluated tests")"
  evomaster_evaluated_actions="$(stat_value "$stats_file" "evaluatedActions" "$em_log" "Evaluated actions")"
  evomaster_generated_tests="$(csv_stat_value "$stats_file" "generatedTests")"
  evomaster_generated_test_total_size="$(csv_stat_value "$stats_file" "generatedTestTotalSize")"
  evomaster_covered_targets="$(csv_stat_value "$stats_file" "coveredTargets")"
  evomaster_number_of_lines="$(csv_stat_value "$stats_file" "numberOfLines")"
  evomaster_covered_lines="$(csv_stat_value "$stats_file" "coveredLines")"
  evomaster_number_of_branches="$(csv_stat_value "$stats_file" "numberOfBranches")"
  evomaster_covered_branches="$(csv_stat_value "$stats_file" "coveredBranches")"
  evomaster_number_of_units="$(csv_stat_value "$stats_file" "numberOfUnits")"
  evomaster_end_epoch="$(now_epoch)"

  jq -n \
    --arg artifact "$name" \
    --arg mode "white-box" \
    --arg startEpoch "$evomaster_start_epoch" \
    --arg startIso "$(iso_from_epoch "$evomaster_start_epoch")" \
    --arg endEpoch "$evomaster_end_epoch" \
    --arg endIso "$(iso_from_epoch "$evomaster_end_epoch")" \
    --arg durationSeconds "$(duration_seconds "$evomaster_start_epoch" "$evomaster_end_epoch")" \
    --arg mainStartEpoch "$main_start_epoch" \
    --arg mainStartIso "$(iso_from_epoch "$main_start_epoch")" \
    --arg mainEndEpoch "$main_end_epoch" \
    --arg mainEndIso "$(iso_from_epoch "$main_end_epoch")" \
    --arg mainDurationSeconds "$main_duration_seconds" \
    --arg seconds "$EVOMASTER_SECONDS_PER_API" \
    --arg minimizeTimeoutMinutes "$EVOMASTER_MINIMIZE_TIMEOUT_MINUTES" \
    --arg extraTimeoutSeconds "$EVOMASTER_EXTRA_TIMEOUT_SECONDS" \
    --arg postSearchTimeoutPercent "$EVOMASTER_POST_SEARCH_TIMEOUT_PERCENT" \
    --arg prematureStop "$EVOMASTER_PREMATURE_STOP" \
    --arg timeoutSeconds "$em_timeout" \
    --arg timeoutKillAfterSeconds "$EVOMASTER_TIMEOUT_KILL_AFTER_SECONDS" \
    --arg completionGraceSeconds "$EVOMASTER_COMPLETION_GRACE_SECONDS" \
    --arg status "$em_status" \
    --arg faults "$em_faults" \
    --arg output "$generated_tests_dir" \
    --arg report "$em_report" \
    --arg reportPresent "$em_report_present" \
    --arg seedFile "$seed_file" \
    --arg seedCount "$seed_count" \
    --arg evomasterMode "$EVOMASTER_MODE" \
    --arg extraHeader "$EVOMASTER_EXTRA_HEADER" \
    --arg extraQueryParam "$EVOMASTER_EXTRA_QUERY_PARAM" \
    --arg authFromSmokeToken "$EVOMASTER_AUTH_FROM_SMOKE_TOKEN" \
    --arg openApiExamplesFromSmoke "$EVOMASTER_OPENAPI_EXAMPLES_FROM_SMOKE" \
    --arg openApiExamplesFile "$openapi_examples_file" \
    --arg probRestExamples "$EVOMASTER_PROB_REST_EXAMPLES" \
    --arg probRestDefault "$EVOMASTER_PROB_REST_DEFAULT" \
    --arg generateSqlDataWithSearch "$EVOMASTER_GENERATE_SQL_DATA_WITH_SEARCH" \
    --arg reuseSmokeDbState "$EVOMASTER_REUSE_SMOKE_DB_STATE" \
    --arg seedRetryWithoutSeeds "$seed_retry" \
    --arg seededFailureLog "$seeded_failure_log" \
    --arg securityRetryWithoutSecurity "$security_retry" \
    --arg securityFailureLog "$security_failure_log" \
    --arg coverageSweepEnabled "$EVOMASTER_COVERAGE_SWEEP_ENABLED" \
    --arg coverageSweepEffectiveEnabled "$coverage_sweep_effective_enabled" \
    --arg coverageSweepSecondsPerEndpoint "$EVOMASTER_COVERAGE_SWEEP_SECONDS_PER_ENDPOINT" \
    --arg coverageSweepMaxEndpoints "$EVOMASTER_COVERAGE_SWEEP_MAX_ENDPOINTS" \
    --arg coverageSweepAutoMaxDeclaredEndpoints "$EVOMASTER_COVERAGE_SWEEP_AUTO_MAX_DECLARED_ENDPOINTS" \
    --arg coverageSweepAutoSmallApis "$EVOMASTER_COVERAGE_SWEEP_AUTO_SMALL_APIS" \
    --arg coverageSweepAutoSeededApis "$EVOMASTER_COVERAGE_SWEEP_AUTO_SEEDED_APIS" \
    --arg coverageSweepMinimizeTimeoutMinutes "$EVOMASTER_COVERAGE_SWEEP_MINIMIZE_TIMEOUT_MINUTES" \
    --arg coverageSweepExtraTimeoutSeconds "$EVOMASTER_COVERAGE_SWEEP_EXTRA_TIMEOUT_SECONDS" \
    --arg coverageSweepMaxWallSeconds "$EVOMASTER_COVERAGE_SWEEP_MAX_WALL_SECONDS" \
    --arg coverageSweepStopAfterNoGain "$EVOMASTER_COVERAGE_SWEEP_STOP_AFTER_NO_GAIN" \
    --arg coverageSweepTimeoutsFatal "$EVOMASTER_COVERAGE_SWEEP_TIMEOUTS_FATAL" \
    --arg coverageSweepStartEpoch "$coverage_sweep_start_epoch" \
    --arg coverageSweepStartIso "$(iso_from_epoch "$coverage_sweep_start_epoch")" \
    --arg coverageSweepEndEpoch "$coverage_sweep_end_epoch" \
    --arg coverageSweepEndIso "$(iso_from_epoch "$coverage_sweep_end_epoch")" \
    --arg coverageSweepTotalDurationSeconds "$coverage_sweep_total_duration_seconds" \
    --arg coverageSweepAverageDurationSeconds "$coverage_sweep_average_duration_seconds" \
    --arg coverageSweepGainCount "$coverage_sweep_gain_count" \
    --arg coverageSweepStopReason "$coverage_sweep_stop_reason" \
    --arg coverageSweepSecurity "$EVOMASTER_COVERAGE_SWEEP_SECURITY" \
    --arg coverageSweepExtraHeader "$EVOMASTER_COVERAGE_SWEEP_EXTRA_HEADER" \
    --arg coverageSweepExtraQueryParam "$EVOMASTER_COVERAGE_SWEEP_EXTRA_QUERY_PARAM" \
    --arg coverageSweepAllowInvalidData "$EVOMASTER_COVERAGE_SWEEP_ALLOW_INVALID_DATA" \
    --arg coverageSweepProbNamedExamples "$EVOMASTER_COVERAGE_SWEEP_PROB_NAMED_EXAMPLES" \
    --arg coverageSweepProbRestExamples "$EVOMASTER_COVERAGE_SWEEP_PROB_REST_EXAMPLES" \
    --arg coverageSweepProbRestDefault "$EVOMASTER_COVERAGE_SWEEP_PROB_REST_DEFAULT" \
    --arg coverageSweepAcceptHeader "$EVOMASTER_COVERAGE_SWEEP_ACCEPT_HEADER" \
    --arg coverageSweepRunCount "$coverage_sweep_run_count" \
    --arg coverageSweepFailureLog "$coverage_sweep_failure_log" \
    --arg coverageSweepFocusResolutionLog "$coverage_sweep_focus_resolution_log" \
    --arg declaredEndpointCount "$declared_endpoint_count" \
    --arg exercisedEndpointCount "$exercised_endpoint_count" \
    --arg successfulEndpointCount "$successful_endpoint_count" \
    --arg evomasterElapsedSeconds "$evomaster_elapsed_seconds" \
    --arg evomasterEvaluatedTests "$evomaster_evaluated_tests" \
    --arg evomasterEvaluatedActions "$evomaster_evaluated_actions" \
    --arg evomasterGeneratedTests "$evomaster_generated_tests" \
    --arg evomasterGeneratedTestTotalSize "$evomaster_generated_test_total_size" \
    --arg evomasterCoveredTargets "$evomaster_covered_targets" \
    --arg evomasterNumberOfLines "$evomaster_number_of_lines" \
    --arg evomasterCoveredLines "$evomaster_covered_lines" \
    --arg evomasterNumberOfBranches "$evomaster_number_of_branches" \
    --arg evomasterCoveredBranches "$evomaster_covered_branches" \
    --arg evomasterNumberOfUnits "$evomaster_number_of_units" \
    --arg writerWarningCount "$writer_warning_count" \
    --arg writerMissingPrimaryKeyCount "$writer_missing_primary_key_count" \
    --arg seedParserWarningCount "$seed_parser_warning_count" \
    --arg seedMissingRequiredParameterWarningCount "$seed_missing_required_parameter_warning_count" \
    --arg seedExperimentalWarningCount "$seed_experimental_warning_count" \
    --arg driverSqlInsertionFailureCount "$driver_sql_insertion_failure_count" \
    --arg driverSqlCheckViolationCount "$driver_sql_check_violation_count" \
    --arg driverSqlForeignKeyViolationCount "$driver_sql_foreign_key_violation_count" \
    --arg driverSqlTemporalFailureCount "$driver_sql_temporal_failure_count" \
    --arg driverInstrumentationErrorCount "$driver_instrumentation_error_count" \
    --arg generatedTestFileCount "$generated_test_file_count" \
    --slurpfile coverageSweepAttempted "$coverage_sweep_attempted_file" \
    --slurpfile coverageSweepReports "$coverage_sweep_reports_file" \
    --slurpfile exercised "$exercised_endpoints_file" \
    --slurpfile covered2xx "$successful_endpoints_file" \
    --slurpfile missing2xx "$missing_2xx_endpoints_file" \
    --slurpfile seedSummary "$seed_summary_status_file" \
    --slurpfile openApiExamplesSummary "$openapi_examples_summary_status_file" \
    'def nullable_number($v): if ($v | length) == 0 then null else ($v | tonumber) end;
    def ratio($n; $d): if ($d | tonumber) == 0 then null else (($n | tonumber) / ($d | tonumber)) end;
    {artifact: $artifact, mode: $mode, evomasterMode: $evomasterMode, startEpoch: ($startEpoch | tonumber), startIso: $startIso, endEpoch: ($endEpoch | tonumber), endIso: $endIso, durationSeconds: ($durationSeconds | tonumber), mainStartEpoch: ($mainStartEpoch | tonumber), mainStartIso: $mainStartIso, mainEndEpoch: ($mainEndEpoch | tonumber), mainEndIso: $mainEndIso, mainDurationSeconds: ($mainDurationSeconds | tonumber), seconds: ($seconds | tonumber), minimizeTimeoutMinutes: ($minimizeTimeoutMinutes | tonumber), extraTimeoutSeconds: ($extraTimeoutSeconds | tonumber), postSearchTimeoutPercent: ($postSearchTimeoutPercent | tonumber), prematureStop: $prematureStop, timeoutSeconds: ($timeoutSeconds | tonumber), timeoutKillAfterSeconds: ($timeoutKillAfterSeconds | tonumber), completionGraceSeconds: ($completionGraceSeconds | tonumber), exitCode: ($status | tonumber), faultCount: ($faults | tonumber), outputFolder: $output, report: $report, reportPresent: ($reportPresent == "true"), seedFile: $seedFile, seedCount: ($seedCount | tonumber), seedSummary: ($seedSummary[0] // {}), openApiExamplesFromSmoke: ($openApiExamplesFromSmoke == "true"), openApiExamplesFile: $openApiExamplesFile, openApiExamplesSummary: ($openApiExamplesSummary[0] // {}), extraHeader: ($extraHeader == "true"), extraQueryParam: ($extraQueryParam == "true"), authFromSmokeToken: ($authFromSmokeToken == "true"), probRestExamples: ($probRestExamples | tonumber), probRestDefault: ($probRestDefault | tonumber), generateSqlDataWithSearch: ($generateSqlDataWithSearch == "true"), reuseSmokeDbState: ($reuseSmokeDbState == "true"), seedRetryWithoutSeeds: ($seedRetryWithoutSeeds == "true"), seededFailureLog: $seededFailureLog, seedParserWarningCount: ($seedParserWarningCount | tonumber), seedMissingRequiredParameterWarningCount: ($seedMissingRequiredParameterWarningCount | tonumber), seedExperimentalWarningCount: ($seedExperimentalWarningCount | tonumber), securityRetryWithoutSecurity: ($securityRetryWithoutSecurity == "true"), securityFailureLog: $securityFailureLog, coverageSweepRequested: $coverageSweepEnabled, coverageSweepEnabled: ($coverageSweepEffectiveEnabled == "true"), coverageSweepSecondsPerEndpoint: ($coverageSweepSecondsPerEndpoint | tonumber), coverageSweepMaxEndpoints: ($coverageSweepMaxEndpoints | tonumber), coverageSweepAutoMaxDeclaredEndpoints: ($coverageSweepAutoMaxDeclaredEndpoints | tonumber), coverageSweepAutoSmallApis: ($coverageSweepAutoSmallApis == "true"), coverageSweepAutoSeededApis: ($coverageSweepAutoSeededApis == "true"), coverageSweepMinimizeTimeoutMinutes: ($coverageSweepMinimizeTimeoutMinutes | tonumber), coverageSweepExtraTimeoutSeconds: ($coverageSweepExtraTimeoutSeconds | tonumber), coverageSweepMaxWallSeconds: ($coverageSweepMaxWallSeconds | tonumber), coverageSweepStopAfterNoGain: ($coverageSweepStopAfterNoGain | tonumber), coverageSweepTimeoutsFatal: ($coverageSweepTimeoutsFatal == "true"), coverageSweepSecurity: ($coverageSweepSecurity == "true"), coverageSweepExtraHeader: ($coverageSweepExtraHeader == "true"), coverageSweepExtraQueryParam: ($coverageSweepExtraQueryParam == "true"), coverageSweepStartEpoch: nullable_number($coverageSweepStartEpoch), coverageSweepStartIso: $coverageSweepStartIso, coverageSweepEndEpoch: nullable_number($coverageSweepEndEpoch), coverageSweepEndIso: $coverageSweepEndIso, coverageSweepTotalDurationSeconds: ($coverageSweepTotalDurationSeconds | tonumber), coverageSweepAverageDurationSeconds: ($coverageSweepAverageDurationSeconds | tonumber), coverageSweepGainCount: ($coverageSweepGainCount | tonumber), coverageSweepStopReason: $coverageSweepStopReason, coverageSweepRunCount: ($coverageSweepRunCount | tonumber), coverageSweepFailureLog: $coverageSweepFailureLog, coverageSweepFocusResolutionLog: $coverageSweepFocusResolutionLog, coverageSweepAttemptedEndpointIds: ($coverageSweepAttempted[0] // []), coverageSweepReports: ($coverageSweepReports[0] // []), declaredEndpointCount: ($declaredEndpointCount | tonumber), exercisedEndpointCount: ($exercisedEndpointCount | tonumber), successfulEndpointCount: ($successfulEndpointCount | tonumber), endpoint2xxCoverageRatio: ratio($successfulEndpointCount; $declaredEndpointCount), exercisedEndpointIds: ($exercised[0] // []), covered2xxEndpointIds: ($covered2xx[0] // []), missing2xxEndpointIds: ($missing2xx[0] // []), evomasterElapsedSeconds: ($evomasterElapsedSeconds | tonumber), evomasterEvaluatedTests: ($evomasterEvaluatedTests | tonumber), evomasterEvaluatedActions: ($evomasterEvaluatedActions | tonumber), evomasterGeneratedTests: ($evomasterGeneratedTests | tonumber), evomasterGeneratedTestTotalSize: ($evomasterGeneratedTestTotalSize | tonumber), evomasterCoveredTargets: ($evomasterCoveredTargets | tonumber), evomasterNumberOfLines: ($evomasterNumberOfLines | tonumber), evomasterCoveredLines: ($evomasterCoveredLines | tonumber), evomasterLineCoverageRatio: ratio($evomasterCoveredLines; $evomasterNumberOfLines), evomasterNumberOfBranches: ($evomasterNumberOfBranches | tonumber), evomasterCoveredBranches: ($evomasterCoveredBranches | tonumber), evomasterBranchCoverageRatio: ratio($evomasterCoveredBranches; $evomasterNumberOfBranches), evomasterNumberOfUnits: ($evomasterNumberOfUnits | tonumber), generatedTestFileCount: ($generatedTestFileCount | tonumber), writerWarningCount: ($writerWarningCount | tonumber), writerMissingPrimaryKeyCount: ($writerMissingPrimaryKeyCount | tonumber), driverSqlInsertionFailureCount: ($driverSqlInsertionFailureCount | tonumber), driverSqlCheckViolationCount: ($driverSqlCheckViolationCount | tonumber), driverSqlForeignKeyViolationCount: ($driverSqlForeignKeyViolationCount | tonumber), driverSqlTemporalFailureCount: ($driverSqlTemporalFailureCount | tonumber), driverInstrumentationErrorCount: ($driverInstrumentationErrorCount | tonumber)}' \
    > "$em_dir/status.json"

  if [[ "$em_status" != "0" ]]; then
    echo "EvoMaster failed for $name with exit code $em_status" >&2
    tail -n 200 "$driver_log" >&2
    tail -n 200 "$em_log" >&2
    if [[ -n "$coverage_sweep_failure_log" ]]; then
      tail -n 200 "$coverage_sweep_failure_log" >&2
    fi
    return "$em_status"
  fi
  if [[ "$em_report_present" != "true" ]]; then
    echo "EvoMaster did not produce report for $name" >&2
    tail -n 200 "$driver_log" >&2
    tail -n 200 "$em_log" >&2
    return 3
  fi
  if [[ "$EVOMASTER_FAIL_ON_FAULTS" == "true" && "$em_faults" != "0" ]]; then
    echo "EvoMaster found $em_faults potential fault(s) for $name" >&2
    cat "$faults_summary" >&2
    return 2
  fi
  if [[ "$EVOMASTER_FAIL_ON_WRITER_WARNINGS" == "true" && "$writer_warning_count" != "0" ]]; then
    echo "EvoMaster reported $writer_warning_count generated-test writer warning(s) for $name" >&2
    grep -E 'A failure has occurred in writing test|Input genes do not contain primary key' "$em_log" >&2 || true
    return 4
  fi
}

if [[ -f "$PERSISTENCE_PROFILES_FILE" ]]; then
  jq -e 'type == "array"' "$PERSISTENCE_PROFILES_FILE" >/dev/null
fi

processed_count=0
failure_count=0
failure_summary_lines_file="$OUTPUT_DIR/runtime-failures.jsonl"
failure_summary_json="$OUTPUT_DIR/runtime-failures.json"
runtime_status_lines_file="$OUTPUT_DIR/runtime-artifacts.jsonl"
runtime_status_json="$OUTPUT_DIR/runtime-artifacts.json"
processed_artifacts_file="$OUTPUT_DIR/runtime-processed-artifacts.txt"
runtime_summary_json="$OUTPUT_DIR/runtime-summary.json"
runtime_junit_xml="$OUTPUT_DIR/runtime-junit.xml"
runtime_form_crud_gui_summary_json="$OUTPUT_DIR/runtime-form-crud-gui-summary.json"
runtime_evomaster_summary_json="$OUTPUT_DIR/runtime-evomaster-summary.json"
runtime_start_epoch="$(now_epoch)"
: > "$failure_summary_lines_file"
: > "$runtime_status_lines_file"
: > "$processed_artifacts_file"
reference_picker_config_service_pid=""
reference_picker_config_service_status=0
should_start_reference_picker_config_service || reference_picker_config_service_status=$?
if [[ "$reference_picker_config_service_status" == "2" ]]; then
  exit 2
fi
if [[ "$reference_picker_config_service_status" == "0" ]]; then
  start_reference_picker_config_service
fi

write_runtime_reports() {
  local runtime_end_epoch
  local form_crud_gui_status_files=()
  local evomaster_status_files=()
  runtime_end_epoch="$(now_epoch)"

  while IFS= read -r artifact; do
    [[ -z "$artifact" ]] && continue
    if [[ -f "$OUTPUT_DIR/$artifact/form-crud-gui/form-crud-gui-summary.json" ]]; then
      form_crud_gui_status_files+=("$OUTPUT_DIR/$artifact/form-crud-gui/form-crud-gui-summary.json")
    elif [[ -f "$OUTPUT_DIR/$artifact/form-crud-gui/form-crud-gui-smoke.json" ]]; then
      form_crud_gui_status_files+=("$OUTPUT_DIR/$artifact/form-crud-gui/form-crud-gui-smoke.json")
    fi
    if [[ -f "$OUTPUT_DIR/$artifact/evomaster/status.json" ]]; then
      evomaster_status_files+=("$OUTPUT_DIR/$artifact/evomaster/status.json")
    fi
  done < "$processed_artifacts_file"

  jq -s '.' "$runtime_status_lines_file" > "$runtime_status_json"
  jq -s '.' "$failure_summary_lines_file" > "$failure_summary_json"

  if [[ "${#form_crud_gui_status_files[@]}" -gt 0 ]]; then
    jq -s '
      def ratio($n; $d): if ($d // 0) == 0 then 0 else (($n // 0) / $d) end;
      {
        artifactCount: length,
        passed: (map(select(.status == "passed")) | length),
        failed: (map(select(.status != "passed")) | length),
        totalDurationMs: (map(.durationMs // 0) | add // 0),
        totalDiscoveredResources: (map(.coverage.discoveredResources // 0) | add // 0),
        totalPlannedCreateResources: (map(.coverage.plannedCreateResources // 0) | add // 0),
        totalSuccessfulCreateResources: (map(.coverage.successfulCreateResources // 0) | add // 0),
        totalExercisedUpdateResources: (map(.coverage.exercisedUpdateResources // 0) | add // 0),
        totalSuccessfulUpdateResources: (map(.coverage.successfulUpdateResources // 0) | add // 0),
        totalExercisedDeleteResources: (map(.coverage.exercisedDeleteResources // 0) | add // 0),
        totalSuccessfulDeleteResources: (map(.coverage.successfulDeleteResources // 0) | add // 0),
        totalExercisedReferencePickerSaves: (map(.coverage.exercisedReferencePickerSaves // 0) | add // 0),
        totalSuccessfulReferencePickerSaves: (map(.coverage.successfulReferencePickerSaves // 0) | add // 0),
        totalDeclaredOperations: (map(.coverage.declaredOperations // 0) | add // 0),
        totalRenderedOperations: (map(.coverage.renderedOperations // 0) | add // 0),
        totalSubmittedOperations: (map(.coverage.submittedOperations // 0) | add // 0),
        totalSuccessfulOperations: (map(.coverage.successfulOperations // 0) | add // 0),
        totalApiOperationsPageRenderedOperations: (map(.coverage.apiOperationsPageRenderedOperations // 0) | add // 0),
        totalApiOperationsPageSubmittedOperations: (map(.coverage.apiOperationsPageSubmittedOperations // 0) | add // 0),
        totalApiOperationsPage2xxSuccesses: (map(.coverage.apiOperationsPage2xxSuccesses // 0) | add // 0),
        totalApiOperationsPageExpectedNegatives: (map(.coverage.apiOperationsPageExpectedNegatives // 0) | add // 0),
        totalApiOperationsPageUnexecutableOperations: (map(.coverage.apiOperationsPageUnexecutableOperations // 0) | add // 0),
        totalApiOperationsPageHarnessErrors: (map(.coverage.apiOperationsPageHarnessErrors // 0) | add // 0),
        totalApiOperationsPageUnexpectedFailures: (map(.coverage.apiOperationsPageUnexpectedFailures // 0) | add // 0),
        totalApiOperationsPageTerminalResults: (map(.coverage.apiOperationsPageTerminalResults // 0) | add // 0),
        totalApiOperationsPageRoundTripChecks: (map(.coverage.apiOperationsPageRoundTripChecks // 0) | add // 0),
        totalApiOperationsPageSuccessfulRoundTripChecks: (map(.coverage.apiOperationsPageSuccessfulRoundTripChecks // 0) | add // 0),
        totalApplicableSchemaFields: (map(.coverage.schemaFields.applicable // 0) | add // 0),
        totalCoveredSchemaFields: (map(.coverage.schemaFields.covered // 0) | add // 0),
        totalUnavailableSchemaFields: (map(.coverage.schemaFields.unavailable // 0) | add // 0),
        totalExcludedSchemaFields: (map(.coverage.schemaFields.excluded // 0) | add // 0),
        totalAccessibleControlsChecked: (map(.coverage.accessibleControlsChecked // 0) | add // 0),
        totalRequiredValidationChecks: (map(.coverage.requiredValidationChecks // 0) | add // 0),
        totalKeyboardChecks: (map(.coverage.keyboardChecks // 0) | add // 0),
        totalDialogAccessibilityChecks: (map(.coverage.dialogAccessibilityChecks // 0) | add // 0),
        totalStructuredObjectOperations: (map(.coverage.structuredObjectOperations // 0) | add // 0),
        totalStructuredArrayOperations: (map(.coverage.structuredArrayOperations // 0) | add // 0),
        totalObjectStringControlFailures: (map(.coverage.objectStringControlFailures // 0) | add // 0),
        totalResponsiveViewportsChecked: (map(.coverage.responsiveViewportsChecked // 0) | add // 0),
        totalCombinedSourceLines: (map(.sourceCoverage.combined.lines.total // 0) | add // 0),
        totalCoveredCombinedSourceLines: (map(.sourceCoverage.combined.lines.covered // 0) | add // 0),
        totalCombinedSourceBranches: (map(.sourceCoverage.combined.branches.total // 0) | add // 0),
        totalCoveredCombinedSourceBranches: (map(.sourceCoverage.combined.branches.covered // 0) | add // 0),
        angularVitestPassed: (map(select(((.unitTest // .jest).status // "skipped") == "passed")) | length),
        angularVitestFailed: (map(select(((.unitTest // .jest).status // "skipped") == "failed")) | length),
        angularVitestSkipped: (map(select(((.unitTest // .jest).status // "skipped") == "skipped")) | length),
        totalAngularVitestDurationMs: (map((.unitTest // .jest).durationMs // 0) | add // 0),
        createSuccessRatio: ratio((map(.coverage.successfulCreateResources // 0) | add // 0); (map(.coverage.plannedCreateResources // 0) | add // 0)),
        updateSuccessRatio: ratio((map(.coverage.successfulUpdateResources // 0) | add // 0); (map(.coverage.exercisedUpdateResources // 0) | add // 0)),
        deleteSuccessRatio: ratio((map(.coverage.successfulDeleteResources // 0) | add // 0); (map(.coverage.exercisedDeleteResources // 0) | add // 0)),
        referencePickerSaveSuccessRatio: ratio((map(.coverage.successfulReferencePickerSaves // 0) | add // 0); (map(.coverage.exercisedReferencePickerSaves // 0) | add // 0)),
        operationRenderCoverageRatio: ratio((map(.coverage.renderedOperations // 0) | add // 0); (map(.coverage.declaredOperations // 0) | add // 0)),
        apiOperationsPageRenderCoverageRatio: ratio((map(.coverage.apiOperationsPageRenderedOperations // 0) | add // 0); (map(.coverage.declaredOperations // 0) | add // 0)),
        apiOperationsPageSubmissionCoverageRatio: ratio((map(.coverage.apiOperationsPageSubmittedOperations // 0) | add // 0); (map(.coverage.declaredOperations // 0) | add // 0)),
        apiOperationsPage2xxSuccessRatio: ratio((map(.coverage.apiOperationsPage2xxSuccesses // 0) | add // 0); (map(.coverage.declaredOperations // 0) | add // 0)),
        apiOperationsPageTerminalResultRatio: ratio((map(.coverage.apiOperationsPageTerminalResults // 0) | add // 0); (map(.coverage.declaredOperations // 0) | add // 0)),
        apiOperationsPageRoundTripSuccessRatio: ratio((map(.coverage.apiOperationsPageSuccessfulRoundTripChecks // 0) | add // 0); (map(.coverage.apiOperationsPageRoundTripChecks // 0) | add // 0)),
        schemaFieldCoverageRatio: ratio((map(.coverage.schemaFields.covered // 0) | add // 0); (map(.coverage.schemaFields.applicable // 0) | add // 0)),
        combinedSourceLineCoverageRatio: ratio((map(.sourceCoverage.combined.lines.covered // 0) | add // 0); (map(.sourceCoverage.combined.lines.total // 0) | add // 0)),
        combinedSourceBranchCoverageRatio: ratio((map(.sourceCoverage.combined.branches.covered // 0) | add // 0); (map(.sourceCoverage.combined.branches.total // 0) | add // 0)),
        artifacts: map({
          artifact,
          status,
          durationMs,
          resourceCount: (.resourceCount // .coverage.discoveredResources // 0),
          coverage,
          sourceCoverage,
          angularVitest: (.unitTest // .jest // null),
          browserStatus: (.browser.status // .status),
          screenshotCount: ((.screenshots // []) | length),
          failedResponseCount: ((.failedResponses // []) | length),
          pageErrorCount: ((.pageErrors // []) | length),
          authenticatedConsoleErrorCount: ((.console // []) | map(select(.type == "error" and .authenticated == true)) | length),
          error: (.error.message // "")
        })
      }
    ' "${form_crud_gui_status_files[@]}" > "$runtime_form_crud_gui_summary_json"
    node "$SCRIPT_DIR/form-crud-summary-policy.mjs" "$runtime_form_crud_gui_summary_json" "${form_crud_gui_status_files[@]}"
  else
    printf '{"artifactCount":0,"artifacts":[]}\n' > "$runtime_form_crud_gui_summary_json"
  fi

  if [[ "${#evomaster_status_files[@]}" -gt 0 ]]; then
    jq -s '
      def ratio($n; $d): if ($d // 0) == 0 then 0 else (($n // 0) / $d) end;
      {
        artifactCount: length,
        totalDeclaredEndpointCount: (map(.declaredEndpointCount // 0) | add // 0),
        totalExercisedEndpointCount: (map(.exercisedEndpointCount // 0) | add // 0),
        totalSuccessfulEndpointCount: (map(.successfulEndpointCount // 0) | add // 0),
        totalFaultCount: (map(.faultCount // 0) | add // 0),
        totalDurationSeconds: (map(.durationSeconds // 0) | add // 0),
        coverageRatio: ratio((map(.successfulEndpointCount // 0) | add // 0); (map(.declaredEndpointCount // 0) | add // 0)),
        artifacts: map({
          artifact,
          exitCode,
          faultCount,
          durationSeconds,
          declaredEndpointCount,
          exercisedEndpointCount,
          successfulEndpointCount,
          coverageRatio: ratio(.successfulEndpointCount; .declaredEndpointCount),
          evomasterCoveredTargets,
          evomasterEvaluatedTests,
          evomasterEvaluatedActions,
          coverageSweepRunCount,
          coverageSweepGainCount,
          coverageSweepStopReason
        })
      }
    ' "${evomaster_status_files[@]}" > "$runtime_evomaster_summary_json"
  else
    printf '{"artifactCount":0,"artifacts":[]}\n' > "$runtime_evomaster_summary_json"
  fi

  jq -n \
    --arg startEpoch "$runtime_start_epoch" \
    --arg startIso "$(iso_from_epoch "$runtime_start_epoch")" \
    --arg endEpoch "$runtime_end_epoch" \
    --arg endIso "$(iso_from_epoch "$runtime_end_epoch")" \
    --arg processedCount "$processed_count" \
    --arg failureCount "$failure_count" \
    --slurpfile artifacts "$runtime_status_json" \
    --slurpfile failures "$failure_summary_json" \
    --slurpfile formCrudGui "$runtime_form_crud_gui_summary_json" \
    --slurpfile evomaster "$runtime_evomaster_summary_json" \
    '($artifacts[0] // []) as $artifactResults |
      ($failures[0] // []) as $failureResults |
      {
      startEpoch: ($startEpoch | tonumber),
      startIso: $startIso,
      endEpoch: ($endEpoch | tonumber),
      endIso: $endIso,
      durationSeconds: (($endEpoch | tonumber) - ($startEpoch | tonumber)),
      processedCount: ($processedCount | tonumber),
      failureCount: ($failureCount | tonumber),
      artifactFailureCount: ($artifactResults | map(select(.exitCode != 0)) | length),
      ok: (($failureCount | tonumber) == 0 and (($artifactResults | map(select(.exitCode != 0)) | length) == 0)),
      failures: $failureResults,
      artifacts: $artifactResults,
      formCrudGui: ($formCrudGui[0] // {artifactCount: 0, artifacts: []}),
      evomaster: ($evomaster[0] // {artifactCount: 0, artifacts: []})
    }' > "$runtime_summary_json"

  jq -r '
    def esc:
      tostring
      | gsub("&"; "&amp;")
      | gsub("<"; "&lt;")
      | gsub(">"; "&gt;")
      | gsub("\""; "&quot;");
    "<testsuite name=\"oas-regression-runtime\" tests=\"\(.artifacts | length)\" failures=\"\(.artifactFailureCount)\" time=\"\(.durationSeconds)\">",
    (.artifacts[] |
      "  <testcase classname=\"\(.artifact | esc)\" name=\"\(.phase | esc)\" time=\"\(.durationSeconds // 0)\">" +
      (if .exitCode == 0 then "" else "<failure message=\"exit \(.exitCode)\">\(.artifact | esc) \(.phase | esc)</failure>" end) +
      "</testcase>"
    ),
    "</testsuite>"
  ' "$runtime_summary_json" > "$runtime_junit_xml"
}

write_artifact_runtime_status() {
  local phase="${1:-runtime-loop}"
  local exit_code="${2:-0}"
  local artifact_end_epoch
  local status_file
  artifact_end_epoch="$(now_epoch)"
  status_file="$artifact_output_dir/harness/runtime-status.json"
  jq -n \
    --arg artifact "$name" \
    --arg phase "$phase" \
    --arg exitCode "$exit_code" \
    --arg startEpoch "$artifact_start_epoch" \
    --arg startIso "$(iso_from_epoch "$artifact_start_epoch")" \
    --arg endEpoch "$artifact_end_epoch" \
    --arg endIso "$(iso_from_epoch "$artifact_end_epoch")" \
    --arg durationSeconds "$(duration_seconds "$artifact_start_epoch" "$artifact_end_epoch")" \
    --arg evomasterEnabled "$EVOMASTER_ENABLED" \
    --arg evomasterStatusFile "$artifact_output_dir/evomaster/status.json" \
    '{artifact: $artifact, phase: $phase, exitCode: ($exitCode | tonumber), startEpoch: ($startEpoch | tonumber), startIso: $startIso, endEpoch: ($endEpoch | tonumber), endIso: $endIso, durationSeconds: ($durationSeconds | tonumber), evomasterEnabled: ($evomasterEnabled == "true"), evomasterStatusFile: $evomasterStatusFile}' \
    > "$status_file"
  jq -c . "$status_file" >> "$runtime_status_lines_file"
}

while IFS=$'\t' read -r name app_dir _jdl_file yaml_file db_user db_name _base_name <&3; do
  if [[ -z "$name" ]]; then
    continue
  fi
  if ! artifact_matches_name_filter "$name"; then
    continue
  fi
  processed_count=$((processed_count + 1))
  artifact_start_epoch="$(now_epoch)"
  artifact_phase="runtime-loop"
  artifact_exit_code=0
  artifact_output_dir="$OUTPUT_DIR/$name"
  printf '%s\n' "$name" >> "$processed_artifacts_file"
  case "$artifact_output_dir" in
    "$OUTPUT_DIR"/*)
      mkdir -p "$artifact_output_dir"
      find "$artifact_output_dir" -mindepth 1 -maxdepth 1 ! -name harness -exec rm -rf {} +
      ;;
    *)
      echo "Refusing to clean unexpected output directory: $artifact_output_dir" >&2
      exit 1
      ;;
  esac
  mkdir -p "$artifact_output_dir"
  mkdir -p "$artifact_output_dir/harness"
  log_file="$artifact_output_dir/app.log"
  smoke_file="$artifact_output_dir/smoke.json"
  seed_file="$artifact_output_dir/evomaster-seed.postman_collection.json"
  seed_summary_file="$artifact_output_dir/evomaster-seed-summary.json"
  openapi_examples_file="$artifact_output_dir/evomaster-openapi-smoke-examples.yaml"
  openapi_examples_summary_file="$artifact_output_dir/evomaster-openapi-smoke-examples-summary.json"
  evomaster_seed_schema_file="$app_dir/src/main/resources/swagger/api.yml"
  if [[ ! -f "$evomaster_seed_schema_file" ]]; then
    evomaster_seed_schema_file="$yaml_file"
  fi
  app_pid=""
  driver_pid=""
  trap 'cleanup_driver "$driver_pid"; cleanup_app "$app_pid" "$app_dir"; cleanup_reference_picker_config_service "$reference_picker_config_service_pid"' EXIT

  timestamped_step "$name" "reset PostgreSQL"
  (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml down -v --remove-orphans < /dev/null)
  (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml up -d "${DOCKER_COMPOSE_UP_ARGS_ARRAY[@]}" < /dev/null)
  wait_for_db "$app_dir" "$db_user"

  timestamped_step "$name" "start Spring Boot"
  rm -f "$log_file"
  (
    cd "$app_dir"
    LIQUIBASE_ANALYTICS_ENABLED=false APPLICATION_LIQUIBASE_ASYNC_START="$LIQUIBASE_ASYNC_START" FORM_CRUD_REFERENCE_PICKER_CONFIG_URL="$FORM_CRUD_REFERENCE_PICKER_CONFIG_URL" FORM_CRUD_REFERENCE_PICKER_CONFIG_BEARER_TOKEN="$FORM_CRUD_REFERENCE_PICKER_CONFIG_BEARER_TOKEN" FORM_CRUD_REFERENCE_PICKER_FORWARD_AUTHORIZATION="$FORM_CRUD_REFERENCE_PICKER_FORWARD_AUTHORIZATION" SPRING_PROFILES_ACTIVE=dev,api-docs SPRING_DOCKER_COMPOSE_ENABLED=false SPRING_LIQUIBASE_CONTEXTS="$LIQUIBASE_CONTEXTS" ./mvnw "${MAVEN_ARGS[@]}" -P'!webapp' spring-boot:run -Dskip.npm=true -DskipTests=true -Dmaven.test.skip=true >"$log_file" 2>&1 < /dev/null
  ) &
  app_pid=$!
  wait_for_app "$log_file" "$app_pid"

  timestamped_step "$name" "authenticate"
  token=$(authenticate)
  echo "auth=ok"

  timestamped_step "$name" "YAML smoke"
  smoke_exit=0
  set +e
  node "$SMOKE" "$yaml_file" "http://localhost:$PORT/api" "$token" "$name" "$artifact_output_dir" < /dev/null | tee "$smoke_file"
  smoke_exit="${PIPESTATUS[0]}"
  set -e
  if [[ "$smoke_exit" != "0" ]]; then
    failure_count=$((failure_count + 1))
    jq -n \
      --arg artifact "$name" \
      --arg phase "yaml-smoke" \
      --arg exitCode "$smoke_exit" \
      --arg smokeFile "$smoke_file" \
      --arg failureFile "$artifact_output_dir/failure.json" \
      --arg appLog "$log_file" \
      '{artifact: $artifact, phase: $phase, exitCode: ($exitCode | tonumber), smokeFile: $smokeFile, failureFile: $failureFile, appLog: $appLog}' \
      >> "$failure_summary_lines_file"
    cleanup_driver "$driver_pid"
    driver_pid=""
    cleanup_app "$app_pid" "$app_dir"
    app_pid=""
    write_artifact_runtime_status "yaml-smoke" "$smoke_exit"
    trap - EXIT
    if [[ "$RUNTIME_FAIL_FAST" == "true" ]]; then
      write_runtime_reports
      exit "$smoke_exit"
    fi
    echo "Continuing after YAML smoke failure for $name; recorded exit code $smoke_exit" >&2
    continue
  fi

  if [[ "$FORM_CRUD_GUI_ENABLED" == "true" ]]; then
    if run_form_crud_gui_smoke "$name" "$app_dir" "$artifact_output_dir"; then
      form_crud_gui_exit=0
    else
      form_crud_gui_exit=$?
    fi
    if [[ "$form_crud_gui_exit" != "0" ]]; then
      failure_count=$((failure_count + 1))
      jq -n \
        --arg artifact "$name" \
        --arg phase "form-crud-gui" \
        --arg exitCode "$form_crud_gui_exit" \
        --arg resultFile "$artifact_output_dir/form-crud-gui/form-crud-gui-summary.json" \
        --arg browserResultFile "$artifact_output_dir/form-crud-gui/form-crud-gui-smoke.json" \
        --arg angularLog "$artifact_output_dir/form-crud-gui/angular.log" \
        --arg angularJestLog "$artifact_output_dir/form-crud-gui/angular-jest.log" \
        --arg appLog "$log_file" \
        '{artifact: $artifact, phase: $phase, exitCode: ($exitCode | tonumber), resultFile: $resultFile, browserResultFile: $browserResultFile, angularLog: $angularLog, angularJestLog: $angularJestLog, appLog: $appLog}' \
        >> "$failure_summary_lines_file"
      if [[ "$artifact_exit_code" == "0" ]]; then
        artifact_phase="form-crud-gui"
        artifact_exit_code="$form_crud_gui_exit"
      fi
      if [[ "$RUNTIME_FAIL_FAST" == "true" ]]; then
        write_artifact_runtime_status "form-crud-gui" "$form_crud_gui_exit"
        write_runtime_reports
        exit "$form_crud_gui_exit"
      fi
      echo "Continuing after Form CRUD GUI failure for $name; recorded exit code $form_crud_gui_exit" >&2
    fi
  fi

  if [[ "$EVOMASTER_ENABLED" == "true" && "$EVOMASTER_POSTMAN_SEEDS_ENABLED" == "true" && ( "$EVOMASTER_SEED_FROM_SMOKE" == "true" || "$EVOMASTER_COVERAGE_SWEEP_WITH_SEEDS" == "true" ) ]]; then
    timestamped_step "$name" "build EvoMaster seed collection"
    EVOMASTER_SEED_AUTH_TOKEN="$token" \
    EVOMASTER_SEED_BODY_MODE="$EVOMASTER_SEED_BODY_MODE" \
      node "$EVOMASTER_SEED_BUILDER" "$artifact_output_dir/summary.json" "$seed_file" "$EVOMASTER_SEED_BASE_PATH" "$evomaster_seed_schema_file" | tee "$seed_summary_file"
  fi

  if [[ "$EVOMASTER_ENABLED" == "true" && "$EVOMASTER_OPENAPI_EXAMPLES_FROM_SMOKE" == "true" ]]; then
    timestamped_step "$name" "build EvoMaster OpenAPI smoke examples"
    node "$EVOMASTER_OPENAPI_EXAMPLE_BUILDER" \
      "$artifact_output_dir/summary.json" \
      "$evomaster_seed_schema_file" \
      "$openapi_examples_file" \
      "$EVOMASTER_SEED_BASE_PATH" | tee "$openapi_examples_summary_file"
  fi

  if [[ -f "$PERSISTENCE_PROFILES_FILE" ]]; then
    while IFS= read -r persistence_profile; do
      profile_id="$(jq -r '.id' <<< "$persistence_profile")"
      request_method="$(jq -r '.request.method' <<< "$persistence_profile")"
      request_path="$(jq -r '.request.path' <<< "$persistence_profile")"
      request_body_file="$GENERATOR_ROOT/$(jq -r '.request.bodyFile' <<< "$persistence_profile")"
      database_sql_file="$GENERATOR_ROOT/$(jq -r '.database.sqlFile' <<< "$persistence_profile")"
      profile_output_dir="$artifact_output_dir/persistence/$profile_id"
      response_file="$profile_output_dir/response.txt"
      database_file="$profile_output_dir/database-verification.txt"
      status_file="$profile_output_dir/status.json"
      mkdir -p "$profile_output_dir"
      jq . "$request_body_file" >/dev/null

      timestamped_step "$profile_id" "profile request and database verification"
    TOKEN="$token"
    export TOKEN
    curl -sS -i -X "$request_method" "http://localhost:$PORT$request_path" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      --data @"$request_body_file" | tee "$response_file"
    status=$(awk 'NR==1 {print $2}' "$response_file")
    if ! jq -e --argjson status "$status" '.request.expectedStatuses | index($status) != null' <<< "$persistence_profile" >/dev/null; then
      failure_count=$((failure_count + 1))
      echo "Persistence profile $profile_id returned unexpected HTTP $status" >&2
      tail -n 200 "$log_file" >&2
      jq -n \
        --arg artifact "$name" \
        --arg phase "persistence-profile" \
        --arg profile "$profile_id" \
        --arg exitCode "1" \
        --arg responseFile "$response_file" \
        --arg appLog "$log_file" \
        '{artifact: $artifact, phase: $phase, profile: $profile, exitCode: ($exitCode | tonumber), responseFile: $responseFile, appLog: $appLog}' \
        >> "$failure_summary_lines_file"
      write_artifact_runtime_status "persistence-profile" "1"
      write_runtime_reports
      exit 1
    fi

    (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml exec -T postgresql \
      psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1) \
      < "$database_sql_file" | tee "$database_file"
      jq -n \
        --arg artifact "$name" \
        --arg profile "$profile_id" \
        --arg requestMethod "$request_method" \
        --arg requestPath "$request_path" \
        --arg responseStatus "$status" \
        --arg responseFile "$response_file" \
        --arg databaseFile "$database_file" \
        '{
          artifact: $artifact,
          profile: $profile,
          status: "passed",
          request: {method: $requestMethod, path: $requestPath, status: ($responseStatus | tonumber), evidence: $responseFile},
          database: {status: "verified", evidence: $databaseFile}
        }' > "$status_file"
    done < <(matching_persistence_profiles "$yaml_file" "$PERSISTENCE_PROFILES_FILE")
  fi

  if [[ "$EVOMASTER_ENABLED" == "true" && "$EVOMASTER_REUSE_SMOKE_DB_STATE" == "true" && "$EVOMASTER_PREPARE_LIVE_DB_STATE" == "true" ]]; then
    evomaster_db_seed_dir="$artifact_output_dir/evomaster-db-seed"
    evomaster_db_seed_file="$artifact_output_dir/evomaster-db-seed.json"
    timestamped_step "$name" "prepare live PostgreSQL state for EvoMaster"
    evomaster_db_seed_exit=0
    set +e
    OPENAPI_SMOKE_SKIP_DELETE=true node "$SMOKE" "$yaml_file" "http://localhost:$PORT/api" "$token" "$name" "$evomaster_db_seed_dir" < /dev/null | tee "$evomaster_db_seed_file"
    evomaster_db_seed_exit="${PIPESTATUS[0]}"
    set -e
    if [[ "$evomaster_db_seed_exit" != "0" ]]; then
      failure_count=$((failure_count + 1))
      jq -n \
        --arg artifact "$name" \
        --arg phase "evomaster-db-seed-smoke" \
        --arg exitCode "$evomaster_db_seed_exit" \
        --arg smokeFile "$evomaster_db_seed_file" \
        --arg failureFile "$evomaster_db_seed_dir/failure.json" \
        --arg appLog "$log_file" \
        '{artifact: $artifact, phase: $phase, exitCode: ($exitCode | tonumber), smokeFile: $smokeFile, failureFile: $failureFile, appLog: $appLog}' \
        >> "$failure_summary_lines_file"
      cleanup_driver "$driver_pid"
      driver_pid=""
      cleanup_app "$app_pid" "$app_dir"
      app_pid=""
      write_artifact_runtime_status "evomaster-db-seed-smoke" "$evomaster_db_seed_exit"
      trap - EXIT
      if [[ "$RUNTIME_FAIL_FAST" == "true" ]]; then
        write_runtime_reports
        exit "$evomaster_db_seed_exit"
      fi
      echo "Continuing after EvoMaster DB seed smoke failure for $name; recorded exit code $evomaster_db_seed_exit" >&2
      continue
    fi
    if [[ "$EVOMASTER_POSTMAN_SEEDS_ENABLED" == "true" && ( "$EVOMASTER_SEED_FROM_SMOKE" == "true" || "$EVOMASTER_COVERAGE_SWEEP_WITH_SEEDS" == "true" ) ]]; then
      timestamped_step "$name" "refresh EvoMaster seed collection from live state"
      EVOMASTER_SEED_AUTH_TOKEN="$token" \
      EVOMASTER_SEED_BODY_MODE="$EVOMASTER_SEED_BODY_MODE" \
        node "$EVOMASTER_SEED_BUILDER" "$evomaster_db_seed_file" "$seed_file" "$EVOMASTER_SEED_BASE_PATH" "$evomaster_seed_schema_file" | tee "$seed_summary_file"
    fi
    if [[ "$EVOMASTER_OPENAPI_EXAMPLES_FROM_SMOKE" == "true" ]]; then
      timestamped_step "$name" "refresh EvoMaster OpenAPI smoke examples from live state"
      node "$EVOMASTER_OPENAPI_EXAMPLE_BUILDER" \
        "$evomaster_db_seed_file" \
        "$evomaster_seed_schema_file" \
        "$openapi_examples_file" \
        "$EVOMASTER_SEED_BASE_PATH" | tee "$openapi_examples_summary_file"
    fi
  fi

  if [[ "$EVOMASTER_ENABLED" == "true" && "$EVOMASTER_REUSE_SMOKE_DB_STATE" == "true" ]]; then
    cleanup_app "$app_pid" ""
  else
    cleanup_app "$app_pid" "$app_dir"
  fi
  app_pid=""

  if [[ "$EVOMASTER_ENABLED" == "true" ]]; then
    if [[ "$EVOMASTER_REUSE_SMOKE_DB_STATE" == "true" ]]; then
      timestamped_step "$name" "reuse smoke PostgreSQL state for EvoMaster"
      wait_for_db "$app_dir" "$db_user"
    else
      timestamped_step "$name" "reset PostgreSQL for EvoMaster"
      (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml down -v --remove-orphans < /dev/null)
      (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml up -d "${DOCKER_COMPOSE_UP_ARGS_ARRAY[@]}" < /dev/null)
      wait_for_db "$app_dir" "$db_user"
    fi
    if run_evomaster_whitebox \
      "$name" \
      "$app_dir" \
      "$db_user" \
      "$db_name" \
      "$artifact_output_dir" \
      "$seed_file" \
      "$token" \
      "$EVOMASTER_CONTROLLER_PORT" \
      "$evomaster_seed_schema_file" \
      "$seed_summary_file" \
      "$openapi_examples_file" \
      "$openapi_examples_summary_file"; then
      evomaster_exit=0
    else
      evomaster_exit=$?
    fi
    if [[ "$evomaster_exit" != "0" ]]; then
      failure_count=$((failure_count + 1))
      jq -n \
        --arg artifact "$name" \
        --arg phase "evomaster" \
        --arg exitCode "$evomaster_exit" \
        --arg evomasterStatusFile "$artifact_output_dir/evomaster/status.json" \
        --arg appLog "$log_file" \
        '{artifact: $artifact, phase: $phase, exitCode: ($exitCode | tonumber), evomasterStatusFile: $evomasterStatusFile, appLog: $appLog}' \
        >> "$failure_summary_lines_file"
      if [[ "$artifact_exit_code" == "0" ]]; then
        artifact_phase="evomaster"
        artifact_exit_code="$evomaster_exit"
      fi
      if [[ "$RUNTIME_FAIL_FAST" == "true" ]]; then
        write_artifact_runtime_status "evomaster" "$evomaster_exit"
        write_runtime_reports
        exit "$evomaster_exit"
      fi
      echo "Continuing after EvoMaster failure for $name; recorded exit code $evomaster_exit" >&2
    fi
  else
    timestamped_step "$name" "EvoMaster disabled"
  fi

  cleanup_app "" "$app_dir"
  write_artifact_runtime_status "$artifact_phase" "$artifact_exit_code"
  trap - EXIT
done 3< <(
  node "$SCRIPT_DIR/artifact-utils.mjs" list \
    --artifact-root "$ARTIFACTS" \
    --workspace-root "$WORKSPACE_ROOT" \
    --app-root "$REGRESSION_APP_ROOT" \
    --format tsv
)

if [[ "$processed_count" == "0" ]]; then
  echo "No OpenAPI/JDL artifact pairs matched the configured filters." >&2
  failure_count=1
  no_artifact_end_epoch="$(now_epoch)"
  jq -cn \
    --arg artifact "harness" \
    --arg phase "artifact-discovery" \
    --arg exitCode "2" \
    --arg message "No OpenAPI/JDL artifact pairs matched the configured filters." \
    '{artifact: $artifact, phase: $phase, exitCode: ($exitCode | tonumber), message: $message}' \
    >> "$failure_summary_lines_file"
  jq -n \
    --arg artifact "harness" \
    --arg phase "artifact-discovery" \
    --arg exitCode "2" \
    --arg startEpoch "$runtime_start_epoch" \
    --arg startIso "$(iso_from_epoch "$runtime_start_epoch")" \
    --arg endEpoch "$no_artifact_end_epoch" \
    --arg endIso "$(iso_from_epoch "$no_artifact_end_epoch")" \
    --arg durationSeconds "$(duration_seconds "$runtime_start_epoch" "$no_artifact_end_epoch")" \
    '{artifact: $artifact, phase: $phase, exitCode: ($exitCode | tonumber), startEpoch: ($startEpoch | tonumber), startIso: $startIso, endEpoch: ($endEpoch | tonumber), endIso: $endIso, durationSeconds: ($durationSeconds | tonumber), evomasterEnabled: false, evomasterStatusFile: ""}' \
    >> "$runtime_status_lines_file"
  cleanup_reference_picker_config_service "$reference_picker_config_service_pid"
  write_runtime_reports
  exit 2
fi

cleanup_reference_picker_config_service "$reference_picker_config_service_pid"
write_runtime_reports

if [[ "$failure_count" != "0" ]]; then
  echo "Runtime loop completed with $failure_count artifact failure(s). See $runtime_summary_json" >&2
  exit 1
fi
