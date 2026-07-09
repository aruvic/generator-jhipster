#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERATOR_ROOT="${GENERATOR_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "$GENERATOR_ROOT/.." && pwd)}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-$WORKSPACE_ROOT/oas-to-jdl/artifacts}"
OAS_TO_JDL_JAR="${OAS_TO_JDL_JAR:-$WORKSPACE_ROOT/oas-to-jdl/target/oas-to-jdl-0.1.0-SNAPSHOT.jar}"
REGRESSION_APP_ROOT="${REGRESSION_APP_ROOT:-$WORKSPACE_ROOT}"
MAVEN_OFFLINE="${MAVEN_OFFLINE:-false}"
MAVEN_CLI_OPTS="${MAVEN_CLI_OPTS:-}"
ANGULAR_BUILD_ENABLED="${ANGULAR_BUILD_ENABLED:-false}"
ANGULAR_BUILD_COMMAND="${ANGULAR_BUILD_COMMAND:-npm run webapp:prod}"
ANGULAR_TEST_ENABLED="${ANGULAR_TEST_ENABLED:-false}"
ANGULAR_TEST_COMMAND="${ANGULAR_TEST_COMMAND:-npm run webapp:test -- --test-path-pattern=openapi-operations|form-crud}"
ANGULAR_NPM_INSTALL="${ANGULAR_NPM_INSTALL:-offline}"
NPM_INSTALL_COMMAND="${NPM_INSTALL_COMMAND:-npm install --no-audit --no-fund}"
NPM_LOGS_DIR="${NPM_LOGS_DIR:-/tmp/generator-jhipster-regression/npm-logs}"
ARTIFACT_NAME_REGEX="${ARTIFACT_NAME_REGEX:-}"
LOG_SKIPPED_ARTIFACTS="${LOG_SKIPPED_ARTIFACTS:-false}"

total_memory_mb() {
  awk '
    /MemTotal:/ { mem=$2 }
    /SwapTotal:/ { swap=$2 }
    END { print int((mem + swap) / 1024) }
  ' /proc/meminfo
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

default_prettier_worker_heap_mb() {
  local total_mb
  total_mb="$(total_memory_mb)"
  if [[ "$total_mb" -ge 24576 ]]; then
    echo 4096
  elif [[ "$total_mb" -ge 12288 ]]; then
    echo 3072
  else
    echo 2048
  fi
}

GENERATOR_NODE_OPTIONS="${GENERATOR_NODE_OPTIONS:---max-old-space-size=$(default_generator_node_heap_mb)}"
ANGULAR_NODE_OPTIONS="${ANGULAR_NODE_OPTIONS:-$GENERATOR_NODE_OPTIONS}"
GENERATOR_PRETTIER_WORKER_MAX_OLD_GENERATION_MB="${GENERATOR_PRETTIER_WORKER_MAX_OLD_GENERATION_MB:-$(default_prettier_worker_heap_mb)}"
GENERATOR_JHIPSTER_ARGS="${GENERATOR_JHIPSTER_ARGS:---ignore-errors --skip-prettier}"

GENERATOR_JHIPSTER_ARGS_ARRAY=()
if [[ -n "$GENERATOR_JHIPSTER_ARGS" ]]; then
  read -r -a GENERATOR_JHIPSTER_ARGS_ARRAY <<< "$GENERATOR_JHIPSTER_ARGS"
fi

MAVEN_ARGS=()
if [[ "$MAVEN_OFFLINE" == "true" ]]; then
  MAVEN_ARGS+=("-o")
fi
if [[ -n "$MAVEN_CLI_OPTS" ]]; then
  read -r -a MAVEN_CLI_OPTS_ARRAY <<< "$MAVEN_CLI_OPTS"
  MAVEN_ARGS+=("${MAVEN_CLI_OPTS_ARRAY[@]}")
fi

processed_count=0

now_epoch() {
  date +%s
}

iso_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

duration_seconds() {
  local start="$1"
  local end="$2"
  echo "$((end - start))"
}

timestamped_step() {
  local name="$1"
  local message="$2"
  echo "=== [$name] $(iso_now) $message ==="
}

artifact_matches_name_filter() {
  local name="$1"
  local regex="${ARTIFACT_NAME_REGEX,,}"

  if [[ -z "$regex" ]]; then
    return 0
  fi

  [[ "${name,,}" =~ $regex ]]
}

ensure_angular_dependencies() {
  local name="$1"
  local app_dir="$2"
  local install_start install_end

  (
    cd "$app_dir"
    mkdir -p "$NPM_LOGS_DIR"
    if [[ "$ANGULAR_NPM_INSTALL" != "skip" && ! -d node_modules ]]; then
      install_start="$(now_epoch)"
      timestamped_step "$name" "Angular npm install start ($ANGULAR_NPM_INSTALL)"
      case "$ANGULAR_NPM_INSTALL" in
        offline)
          env NODE_OPTIONS="${NODE_OPTIONS:-$ANGULAR_NODE_OPTIONS}" NO_UPDATE_NOTIFIER=1 npm_config_logs_dir="$NPM_LOGS_DIR" $NPM_INSTALL_COMMAND --offline < /dev/null
          ;;
        online)
          env NODE_OPTIONS="${NODE_OPTIONS:-$ANGULAR_NODE_OPTIONS}" NO_UPDATE_NOTIFIER=1 npm_config_logs_dir="$NPM_LOGS_DIR" $NPM_INSTALL_COMMAND < /dev/null
          ;;
        *)
          echo "Unsupported ANGULAR_NPM_INSTALL=$ANGULAR_NPM_INSTALL; use offline, online, or skip." >&2
          exit 2
          ;;
      esac
      install_end="$(now_epoch)"
      timestamped_step "$name" "Angular npm install finished in $(duration_seconds "$install_start" "$install_end")s"
    fi
  )
}

run_angular_build() {
  local name="$1"
  local app_dir="$2"
  local build_start build_end

  ensure_angular_dependencies "$name" "$app_dir"

  (
    cd "$app_dir"

    build_start="$(now_epoch)"
    timestamped_step "$name" "Angular build start: $ANGULAR_BUILD_COMMAND"
    env NODE_OPTIONS="${NODE_OPTIONS:-$ANGULAR_NODE_OPTIONS}" NO_UPDATE_NOTIFIER=1 $ANGULAR_BUILD_COMMAND < /dev/null
    build_end="$(now_epoch)"
    timestamped_step "$name" "Angular build finished in $(duration_seconds "$build_start" "$build_end")s"
  )
}

run_angular_test() {
  local name="$1"
  local app_dir="$2"
  local test_start test_end

  ensure_angular_dependencies "$name" "$app_dir"

  (
    cd "$app_dir"

    test_start="$(now_epoch)"
    timestamped_step "$name" "Angular test start: $ANGULAR_TEST_COMMAND"
    env NODE_OPTIONS="${NODE_OPTIONS:-$ANGULAR_NODE_OPTIONS}" NO_UPDATE_NOTIFIER=1 $ANGULAR_TEST_COMMAND < /dev/null
    test_end="$(now_epoch)"
    timestamped_step "$name" "Angular test finished in $(duration_seconds "$test_start" "$test_end")s"
  )
}

if [[ "${SKIP_OAS_TO_JDL:-false}" != "true" ]]; then
  timestamped_step "oas-to-jdl" "regenerate JDL artifacts from $ARTIFACT_ROOT"
  java -jar "$OAS_TO_JDL_JAR" --input="$ARTIFACT_ROOT/" --output="$ARTIFACT_ROOT/" --use-relationships=true
fi

echo "=== [regression] $(iso_now) ARTIFACT_NAME_REGEX=${ARTIFACT_NAME_REGEX:-<none>} ==="
echo "=== [regression] $(iso_now) ANGULAR_BUILD_ENABLED=$ANGULAR_BUILD_ENABLED ==="
echo "=== [regression] $(iso_now) ANGULAR_BUILD_COMMAND=$ANGULAR_BUILD_COMMAND ==="
echo "=== [regression] $(iso_now) ANGULAR_NPM_INSTALL=$ANGULAR_NPM_INSTALL ==="

while IFS=$'\t' read -r name app_dir jdl_file _yaml_file _db_user _db_name _base_name; do
  if [[ -z "$name" ]]; then
    continue
  fi

  if ! artifact_matches_name_filter "$name"; then
    if [[ "$LOG_SKIPPED_ARTIFACTS" == "true" ]]; then
      timestamped_step "$name" "skipped by ARTIFACT_NAME_REGEX=$ARTIFACT_NAME_REGEX"
    fi
    continue
  fi

  processed_count=$((processed_count + 1))
  artifact_start="$(now_epoch)"
  timestamped_step "$name" "regenerate start from $jdl_file"
  rm -Rf "$app_dir"
  mkdir -p "$app_dir"
  (
    cd "$app_dir"
    env NODE_OPTIONS="${NODE_OPTIONS:-$GENERATOR_NODE_OPTIONS}" \
      JHIPSTER_PRETTIER_WORKER_MAX_OLD_GENERATION_MB="${JHIPSTER_PRETTIER_WORKER_MAX_OLD_GENERATION_MB:-$GENERATOR_PRETTIER_WORKER_MAX_OLD_GENERATION_MB}" \
      node "$GENERATOR_ROOT/dist/cli/jhipster.cjs" jdl "$jdl_file" --no-insight --force --skip-install --skip-checks "${GENERATOR_JHIPSTER_ARGS_ARRAY[@]}" < /dev/null
  )
  artifact_generate_end="$(now_epoch)"
  timestamped_step "$name" "regenerate finished in $(duration_seconds "$artifact_start" "$artifact_generate_end")s"
  timestamped_step "$name" "Java compile including test support start"
  (
    cd "$app_dir"
    ./mvnw "${MAVEN_ARGS[@]}" clean test-compile -DskipTests=true -P'!webapp' < /dev/null
  )
  artifact_compile_end="$(now_epoch)"
  timestamped_step "$name" "Java compile finished in $(duration_seconds "$artifact_generate_end" "$artifact_compile_end")s"
  if [[ "$ANGULAR_BUILD_ENABLED" == "true" ]]; then
    run_angular_build "$name" "$app_dir"
  fi
  if [[ "$ANGULAR_TEST_ENABLED" == "true" ]]; then
    run_angular_test "$name" "$app_dir"
  fi
  artifact_end="$(now_epoch)"
  timestamped_step "$name" "artifact generate/compile finished in $(duration_seconds "$artifact_start" "$artifact_end")s"
done < <(
  node "$SCRIPT_DIR/artifact-utils.mjs" list \
    --artifact-root "$ARTIFACT_ROOT" \
    --workspace-root "$WORKSPACE_ROOT" \
    --app-root "$REGRESSION_APP_ROOT" \
    --format tsv
)

if [[ "$processed_count" == "0" ]]; then
  echo "No OpenAPI/JDL artifact pairs matched the configured filters." >&2
  exit 2
fi
