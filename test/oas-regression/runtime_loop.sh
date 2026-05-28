#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERATOR_ROOT="${GENERATOR_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "$GENERATOR_ROOT/.." && pwd)}"
ARTIFACTS="${ARTIFACT_ROOT:-$WORKSPACE_ROOT/oas-to-jdl/artifacts}"
SMOKE="$SCRIPT_DIR/openapi-smoke.mjs"
DB_VERIFY_SQL="$SCRIPT_DIR/tmf683-db-verify.sql"
EVOMASTER_SEED_BUILDER="$SCRIPT_DIR/evomaster-postman-seed.mjs"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/generator-jhipster-regression}"
TMF_PAYLOAD="${TMF_PAYLOAD:-$GENERATOR_ROOT/party-interaction-full.json}"
REGRESSION_APP_ROOT="${REGRESSION_APP_ROOT:-$WORKSPACE_ROOT}"
PORT="${PORT:-8081}"
LIQUIBASE_CONTEXTS="${LIQUIBASE_CONTEXTS:-dev}"
EVOMASTER_ENABLED="${EVOMASTER_ENABLED:-true}"
EVOMASTER_JAR="${EVOMASTER_JAR:-$WORKSPACE_ROOT/tools/evomaster/evomaster-6.0.0.jar}"
EVOMASTER_SECONDS_PER_API="${EVOMASTER_SECONDS_PER_API:-600}"
EVOMASTER_CONTROLLER_PORT="${EVOMASTER_CONTROLLER_PORT:-40100}"
EVOMASTER_OUTPUT_FORMAT="${EVOMASTER_OUTPUT_FORMAT:-JAVA_JUNIT_5}"
EVOMASTER_MINIMIZE_TIMEOUT_MINUTES="${EVOMASTER_MINIMIZE_TIMEOUT_MINUTES:-5}"
EVOMASTER_TCP_TIMEOUT_MS="${EVOMASTER_TCP_TIMEOUT_MS:-10000}"
EVOMASTER_TEST_TIMEOUT="${EVOMASTER_TEST_TIMEOUT:-30}"
EVOMASTER_ALGORITHM="${EVOMASTER_ALGORITHM:-MIO}"
EVOMASTER_SECURITY="${EVOMASTER_SECURITY:-true}"
EVOMASTER_XSS="${EVOMASTER_XSS:-false}"
EVOMASTER_FAIL_ON_FAULTS="${EVOMASTER_FAIL_ON_FAULTS:-true}"
EVOMASTER_FAIL_ON_WRITER_WARNINGS="${EVOMASTER_FAIL_ON_WRITER_WARNINGS:-false}"
EVOMASTER_SKIP_FAILURE_SQL_IN_TEST_FILE="${EVOMASTER_SKIP_FAILURE_SQL_IN_TEST_FILE:-true}"
EVOMASTER_AUTH_FROM_SMOKE_TOKEN="${EVOMASTER_AUTH_FROM_SMOKE_TOKEN:-true}"
EVOMASTER_SEED_FROM_SMOKE="${EVOMASTER_SEED_FROM_SMOKE:-true}"
EVOMASTER_RETRY_WITHOUT_SEEDS_ON_SEED_FAILURE="${EVOMASTER_RETRY_WITHOUT_SEEDS_ON_SEED_FAILURE:-true}"
EVOMASTER_RETRY_WITHOUT_SECURITY_ON_SECURITY_FAILURE="${EVOMASTER_RETRY_WITHOUT_SECURITY_ON_SECURITY_FAILURE:-true}"
EVOMASTER_EXPORT_TEST_CASES_DURING_SEEDING="${EVOMASTER_EXPORT_TEST_CASES_DURING_SEEDING:-true}"
EVOMASTER_SEED_BASE_PATH="${EVOMASTER_SEED_BASE_PATH:-/api}"
EVOMASTER_DO_COLLECT_IMPACT="${EVOMASTER_DO_COLLECT_IMPACT:-false}"
EVOMASTER_ADAPTIVE_GENE_SELECTION_METHOD="${EVOMASTER_ADAPTIVE_GENE_SELECTION_METHOD:-NONE}"
EVOMASTER_ARCHIVE_GENE_MUTATION="${EVOMASTER_ARCHIVE_GENE_MUTATION:-NONE}"
EVOMASTER_EXTRA_ARGS="${EVOMASTER_EXTRA_ARGS:-}"
EVOMASTER_JAVA_OPTS="${EVOMASTER_JAVA_OPTS:--Xms512m -Xmx4g}"
EVOMASTER_EXTRA_TIMEOUT_SECONDS="${EVOMASTER_EXTRA_TIMEOUT_SECONDS:-900}"
EVOMASTER_TIMEOUT_SECONDS="${EVOMASTER_TIMEOUT_SECONDS:-}"
EVOMASTER_DRIVER_JVM_ARGS="${EVOMASTER_DRIVER_JVM_ARGS:--Djdk.attach.allowAttachSelf=true --add-opens java.base/java.util=ALL-UNNAMED --add-opens java.base/java.util.regex=ALL-UNNAMED --add-opens java.base/java.net=ALL-UNNAMED --add-opens java.base/java.lang=ALL-UNNAMED -XX:+EnableDynamicAgentLoading}"
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

cleanup_driver() {
  local pid="${1:-}"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    kill -- "-$pid" >/dev/null 2>&1 || true
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
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
  token=$(curl -s -X POST "http://localhost:$PORT/api/authenticate" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin"}' | jq -r '.id_token // empty')
  if [[ -z "$token" || "$token" == "null" ]]; then
    echo "Authentication failed on port $PORT" >&2
    return 1
  fi
  printf '%s\n' "$token"
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

evomaster_args_with_security_disabled() {
  local args=("$@")
  local rewritten=()
  local i=0
  while [[ "$i" -lt "${#args[@]}" ]]; do
    if [[ "${args[$i]}" == "--security" ]]; then
      rewritten+=("--security" "false")
      i=$((i + 2))
    else
      rewritten+=("${args[$i]}")
      i=$((i + 1))
    fi
  done
  printf '%s\n' "${rewritten[@]}"
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

run_evomaster_whitebox() {
  local name="$1"
  local app_dir="$2"
  local db_user="$3"
  local db_name="$4"
  local artifact_output_dir="$5"
  local seed_file="${6:-}"
  local auth_token="${7:-}"
  local controller_port="${8:-$EVOMASTER_CONTROLLER_PORT}"
  local em_dir="$artifact_output_dir/evomaster"
  local driver_log="$em_dir/driver.log"
  local em_log="$em_dir/evomaster.log"
  local stats_file="$em_dir/statistics.csv"
  local snapshot_file="$em_dir/snapshot-statistics.csv"
  local config_file="$em_dir/evomaster-config.yaml"
  local generated_tests_dir="$em_dir/generated-tests"
  local em_report="$generated_tests_dir/report.json"
  local faults_summary="$em_dir/faults-summary.json"
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
  local successful_endpoint_count=0
  local seed_count=0
  local writer_warning_count=0
  local writer_missing_primary_key_count=0
  local driver_sql_insertion_failure_count=0
  local driver_sql_check_violation_count=0
  local driver_sql_foreign_key_violation_count=0
  local driver_sql_temporal_failure_count=0
  local driver_instrumentation_error_count=0
  local generated_test_file_count=0
  local seed_retry=false
  local seeded_failure_log=""
  local security_retry=false
  local security_failure_log=""
  local successful_endpoints_file="$em_dir/successful-endpoints.json"
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

  echo "=== [$name] start EvoMaster white-box driver ==="
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
      ./mvnw -P'!webapp' -Dskip.npm=true -DskipTests=true \
      -Dexec.executable=java \
      -Dexec.classpathScope=test \
      -Dexec.longClasspath=true \
      -Dexec.args="$2 -cp %classpath $3.evomaster.EvoMasterController" \
      test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:exec
    ' bash "$app_dir" "$EVOMASTER_DRIVER_JVM_ARGS" "$pkg" >"$driver_log" 2>&1 < /dev/null &
  driver_pid=$!
  wait_for_controller "$controller_port" "$driver_log" "$driver_pid"

  echo "=== [$name] EvoMaster white-box fuzzing (${EVOMASTER_SECONDS_PER_API}s) ==="
  em_args=(
    --configPath "$config_file"
    --blackBox false
    --sutControllerPort "$controller_port"
    --maxTime "${EVOMASTER_SECONDS_PER_API}s"
    --minimizeTimeout "$EVOMASTER_MINIMIZE_TIMEOUT_MINUTES"
    --tcpTimeoutMs "$EVOMASTER_TCP_TIMEOUT_MS"
    --testTimeout "$EVOMASTER_TEST_TIMEOUT"
    --algorithm "$EVOMASTER_ALGORITHM"
    --security "$EVOMASTER_SECURITY"
    --xss "$EVOMASTER_XSS"
    --doCollectImpact "$EVOMASTER_DO_COLLECT_IMPACT"
    --adaptiveGeneSelectionMethod "$EVOMASTER_ADAPTIVE_GENE_SELECTION_METHOD"
    --archiveGeneMutation "$EVOMASTER_ARCHIVE_GENE_MUTATION"
    --outputFolder "$generated_tests_dir"
    --outputFormat "$EVOMASTER_OUTPUT_FORMAT"
    --skipFailureSQLInTestFile "$EVOMASTER_SKIP_FAILURE_SQL_IN_TEST_FILE"
    --writeStatistics true
    --statisticsFile "$stats_file"
    --snapshotStatisticsFile "$snapshot_file"
    --showProgress false
    --avoidNonDeterministicLogs true
  )
  if [[ "$EVOMASTER_SEED_FROM_SMOKE" == "true" && -n "$seed_file" && -f "$seed_file" ]]; then
    seed_count="$(jq -r '.item | length // 0' "$seed_file")"
    if [[ "$seed_count" != "0" ]]; then
      seed_args+=(
        --seedTestCases true
        --seedTestCasesFormat POSTMAN
        --seedTestCasesPath "$seed_file"
        --exportTestCasesDuringSeeding "$EVOMASTER_EXPORT_TEST_CASES_DURING_SEEDING"
      )
    fi
  fi
  if [[ "$EVOMASTER_AUTH_FROM_SMOKE_TOKEN" == "true" && -n "$auth_token" ]]; then
    em_args+=(
      --header0 "Authorization: Bearer $auth_token"
    )
  fi
  if [[ -n "$EVOMASTER_EXTRA_ARGS" ]]; then
    read -r -a extra_args <<< "$EVOMASTER_EXTRA_ARGS"
    em_args+=("${extra_args[@]}")
  fi
  if [[ -n "$EVOMASTER_JAVA_OPTS" ]]; then
    read -r -a em_java_opts <<< "$EVOMASTER_JAVA_OPTS"
  fi
  if [[ -z "$em_timeout" ]]; then
    em_timeout="$((EVOMASTER_SECONDS_PER_API + (EVOMASTER_MINIMIZE_TIMEOUT_MINUTES * 60) + EVOMASTER_EXTRA_TIMEOUT_SECONDS))"
  fi
  active_seed_args=("${seed_args[@]}")
  run_args=("${em_args[@]}" "${active_seed_args[@]}")
  set +e
  timeout "${em_timeout}s" java "${em_java_opts[@]}" -jar "$EVOMASTER_JAR" "${run_args[@]}" 2>&1 | tee "$em_log"
  em_status=${PIPESTATUS[0]}
  set -e

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
    timeout "${em_timeout}s" java "${em_java_opts[@]}" -jar "$EVOMASTER_JAR" "${em_args[@]}" 2>&1 | tee "$em_log"
    em_status=${PIPESTATUS[0]}
    set -e
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
    timeout "${em_timeout}s" java "${em_java_opts[@]}" -jar "$EVOMASTER_JAR" "${security_disabled_args[@]}" "${active_seed_args[@]}" 2>&1 | tee "$em_log"
    em_status=${PIPESTATUS[0]}
    set -e
  fi

  cleanup_driver "$driver_pid"
  driver_pid=""

  if [[ -f "$em_report" ]]; then
    em_report_present=true
    em_faults="$(jq -r '.faults.totalNumber // 0' "$em_report")"
    jq '.faults.foundFaults // []' "$em_report" > "$faults_summary"
    declared_endpoint_count="$(jq -r '.problemDetails.rest.endpointIds | length // 0' "$em_report")"
    jq '[.problemDetails.rest.coveredHttpStatus[]? | select((.endpointId | startswith("OPTIONS:") | not) and (.httpStatus | any(. >= 200 and . < 300))) | .endpointId] | unique' "$em_report" > "$successful_endpoints_file"
    successful_endpoint_count="$(jq -r 'length' "$successful_endpoints_file")"
  else
    printf '[]\n' > "$faults_summary"
    printf '[]\n' > "$successful_endpoints_file"
  fi
  writer_warning_count="$(count_log_pattern "$em_log" 'A failure has occurred in writing test')"
  writer_missing_primary_key_count="$(count_log_pattern "$em_log" 'Input genes do not contain primary key')"
  driver_sql_insertion_failure_count="$(count_log_pattern "$driver_log" 'Failed to execute insertion')"
  driver_sql_check_violation_count="$(count_log_pattern "$driver_log" 'violates check constraint')"
  driver_sql_foreign_key_violation_count="$(count_log_pattern "$driver_log" 'violates foreign key constraint')"
  driver_sql_temporal_failure_count="$(count_log_pattern "$driver_log" 'date/time field value out of range')"
  driver_instrumentation_error_count="$(count_log_pattern "$driver_log" 'ERROR - Failed to instrument')"
  generated_test_file_count="$(find "$generated_tests_dir" -maxdepth 1 -type f -name '*Test.java' | wc -l)"

  jq -n \
    --arg artifact "$name" \
    --arg mode "white-box" \
    --arg seconds "$EVOMASTER_SECONDS_PER_API" \
    --arg status "$em_status" \
    --arg faults "$em_faults" \
    --arg output "$generated_tests_dir" \
    --arg report "$em_report" \
    --arg reportPresent "$em_report_present" \
    --arg seedFile "$seed_file" \
    --arg seedCount "$seed_count" \
    --arg authFromSmokeToken "$EVOMASTER_AUTH_FROM_SMOKE_TOKEN" \
    --arg seedRetryWithoutSeeds "$seed_retry" \
    --arg seededFailureLog "$seeded_failure_log" \
    --arg securityRetryWithoutSecurity "$security_retry" \
    --arg securityFailureLog "$security_failure_log" \
    --arg declaredEndpointCount "$declared_endpoint_count" \
    --arg successfulEndpointCount "$successful_endpoint_count" \
    --arg writerWarningCount "$writer_warning_count" \
    --arg writerMissingPrimaryKeyCount "$writer_missing_primary_key_count" \
    --arg driverSqlInsertionFailureCount "$driver_sql_insertion_failure_count" \
    --arg driverSqlCheckViolationCount "$driver_sql_check_violation_count" \
    --arg driverSqlForeignKeyViolationCount "$driver_sql_foreign_key_violation_count" \
    --arg driverSqlTemporalFailureCount "$driver_sql_temporal_failure_count" \
    --arg driverInstrumentationErrorCount "$driver_instrumentation_error_count" \
    --arg generatedTestFileCount "$generated_test_file_count" \
    --slurpfile covered2xx "$successful_endpoints_file" \
    '{artifact: $artifact, mode: $mode, seconds: ($seconds | tonumber), exitCode: ($status | tonumber), faultCount: ($faults | tonumber), outputFolder: $output, report: $report, reportPresent: ($reportPresent == "true"), seedFile: $seedFile, seedCount: ($seedCount | tonumber), authFromSmokeToken: ($authFromSmokeToken == "true"), seedRetryWithoutSeeds: ($seedRetryWithoutSeeds == "true"), seededFailureLog: $seededFailureLog, securityRetryWithoutSecurity: ($securityRetryWithoutSecurity == "true"), securityFailureLog: $securityFailureLog, declaredEndpointCount: ($declaredEndpointCount | tonumber), successfulEndpointCount: ($successfulEndpointCount | tonumber), covered2xxEndpointIds: ($covered2xx[0] // []), generatedTestFileCount: ($generatedTestFileCount | tonumber), writerWarningCount: ($writerWarningCount | tonumber), writerMissingPrimaryKeyCount: ($writerMissingPrimaryKeyCount | tonumber), driverSqlInsertionFailureCount: ($driverSqlInsertionFailureCount | tonumber), driverSqlCheckViolationCount: ($driverSqlCheckViolationCount | tonumber), driverSqlForeignKeyViolationCount: ($driverSqlForeignKeyViolationCount | tonumber), driverSqlTemporalFailureCount: ($driverSqlTemporalFailureCount | tonumber), driverInstrumentationErrorCount: ($driverInstrumentationErrorCount | tonumber)}' \
    > "$em_dir/status.json"

  if [[ "$em_status" != "0" ]]; then
    echo "EvoMaster failed for $name with exit code $em_status" >&2
    tail -n 200 "$driver_log" >&2
    tail -n 200 "$em_log" >&2
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
  seed_file="$artifact_output_dir/evomaster-seed.postman_collection.json"
  seed_summary_file="$artifact_output_dir/evomaster-seed-summary.json"
  evomaster_seed_schema_file="$app_dir/src/main/resources/swagger/api.yml"
  if [[ ! -f "$evomaster_seed_schema_file" ]]; then
    evomaster_seed_schema_file="$yaml_file"
  fi
  app_pid=""
  driver_pid=""
  trap 'cleanup_driver "$driver_pid"; cleanup_app "$app_pid" "$app_dir"' EXIT

  echo "=== [$name] reset PostgreSQL ==="
  (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml down -v --remove-orphans < /dev/null)
  (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml up -d < /dev/null)
  wait_for_db "$app_dir" "$db_user"

  echo "=== [$name] start Spring Boot ==="
  rm -f "$log_file"
  (
    cd "$app_dir"
    LIQUIBASE_ANALYTICS_ENABLED=false SPRING_PROFILES_ACTIVE=dev,api-docs SPRING_DOCKER_COMPOSE_ENABLED=false SPRING_LIQUIBASE_CONTEXTS="$LIQUIBASE_CONTEXTS" ./mvnw -P'!webapp' spring-boot:run -Dskip.npm=true -DskipTests=true -Dmaven.test.skip=true >"$log_file" 2>&1 < /dev/null
  ) &
  app_pid=$!
  wait_for_app "$log_file"

  echo "=== [$name] authenticate ==="
  token=$(authenticate)
  echo "auth=ok"

  echo "=== [$name] YAML smoke ==="
  node "$SMOKE" "$yaml_file" "http://localhost:$PORT/api" "$token" "$name" "$artifact_output_dir" < /dev/null | tee "$smoke_file"

  if [[ "$EVOMASTER_SEED_FROM_SMOKE" == "true" ]]; then
    echo "=== [$name] build EvoMaster seed collection ==="
    EVOMASTER_SEED_AUTH_TOKEN="$token" \
      node "$EVOMASTER_SEED_BUILDER" "$artifact_output_dir/summary.json" "$seed_file" "$EVOMASTER_SEED_BASE_PATH" "$evomaster_seed_schema_file" | tee "$seed_summary_file"
  fi

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

  if [[ "$EVOMASTER_ENABLED" == "true" ]]; then
    echo "=== [$name] reset PostgreSQL for EvoMaster ==="
    (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml down -v --remove-orphans < /dev/null)
    (cd "$app_dir" && docker compose -f src/main/docker/postgresql.yml up -d < /dev/null)
    wait_for_db "$app_dir" "$db_user"
    run_evomaster_whitebox "$name" "$app_dir" "$db_user" "$db_name" "$artifact_output_dir" "$seed_file" "$token"
  else
    echo "=== [$name] EvoMaster disabled ==="
  fi

  cleanup_app "" "$app_dir"
  trap - EXIT
done 3< <(
  node "$SCRIPT_DIR/artifact-utils.mjs" list \
    --artifact-root "$ARTIFACTS" \
    --workspace-root "$WORKSPACE_ROOT" \
    --app-root "$REGRESSION_APP_ROOT" \
    --format tsv
)
