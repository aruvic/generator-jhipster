#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERATOR_ROOT="${GENERATOR_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "$GENERATOR_ROOT/.." && pwd)}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-$WORKSPACE_ROOT/oas-to-jdl/artifacts}"
OAS_TO_JDL_JAR="${OAS_TO_JDL_JAR:-$WORKSPACE_ROOT/oas-to-jdl/target/oas-to-jdl-0.1.0-SNAPSHOT.jar}"
REGRESSION_APP_ROOT="${REGRESSION_APP_ROOT:-$WORKSPACE_ROOT}"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/generator-jhipster-regression}"
FULL_MATRIX_BUILD="${FULL_MATRIX_BUILD:-true}"
FULL_MATRIX_GENERATE_COMPILE="${FULL_MATRIX_GENERATE_COMPILE:-true}"
FULL_MATRIX_RUNTIME="${FULL_MATRIX_RUNTIME:-true}"
FULL_MATRIX_CONTINUE_AFTER_BUILD_FAILURE="${FULL_MATRIX_CONTINUE_AFTER_BUILD_FAILURE:-false}"
SKIP_OAS_TO_JDL="${SKIP_OAS_TO_JDL:-false}"
MAVEN_OFFLINE="${MAVEN_OFFLINE:-true}"
DOCKER_COMPOSE_UP_ARGS="${DOCKER_COMPOSE_UP_ARGS:---pull never}"
FULL_MATRIX_BUILD_TIMEOUT_SECONDS="${FULL_MATRIX_BUILD_TIMEOUT_SECONDS:-1800}"
FULL_MATRIX_OAS_TO_JDL_TIMEOUT_SECONDS="${FULL_MATRIX_OAS_TO_JDL_TIMEOUT_SECONDS:-900}"
FULL_MATRIX_GENERATE_COMPILE_TIMEOUT_SECONDS="${FULL_MATRIX_GENERATE_COMPILE_TIMEOUT_SECONDS:-7200}"
FULL_MATRIX_RUNTIME_TIMEOUT_SECONDS="${FULL_MATRIX_RUNTIME_TIMEOUT_SECONDS:-7200}"
FULL_MATRIX_TIMEOUT_KILL_AFTER_SECONDS="${FULL_MATRIX_TIMEOUT_KILL_AFTER_SECONDS:-60}"

mkdir -p "$OUTPUT_DIR"
SUMMARY_JSONL="$OUTPUT_DIR/full-matrix-status.jsonl"
SUMMARY_JSON="$OUTPUT_DIR/full-matrix-summary.json"
SUMMARY_JUNIT="$OUTPUT_DIR/full-matrix-junit.xml"
EVOMASTER_SUMMARY_JSON="$OUTPUT_DIR/full-matrix-evomaster-status.json"
FORM_CRUD_GUI_SUMMARY_JSON="$OUTPUT_DIR/full-matrix-form-crud-gui-status.json"
: > "$SUMMARY_JSONL"

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

FULL_MATRIX_START_EPOCH="$(now_epoch)"

LAST_RUN_START_EPOCH=""
LAST_RUN_END_EPOCH=""
LAST_RUN_DURATION_SECONDS=0

run_logged() {
  local log_file="$1"
  shift
  mkdir -p "$(dirname "$log_file")"
  LAST_RUN_START_EPOCH="$(now_epoch)"
  "$@" < /dev/null 2>&1 | tee "$log_file"
  local status="${PIPESTATUS[0]}"
  LAST_RUN_END_EPOCH="$(now_epoch)"
  LAST_RUN_DURATION_SECONDS="$(duration_seconds "$LAST_RUN_START_EPOCH" "$LAST_RUN_END_EPOCH")"
  return "$status"
}

record_status() {
  local artifact="$1"
  local phase="$2"
  local status="$3"
  local log_file="$4"
  local message="$5"
  local artifact_dir="$OUTPUT_DIR/$artifact"
  local runtime_summary_file=""
  local runtime_junit_file=""
  local runtime_artifacts_file=""
  local runtime_failures_file=""
  local runtime_form_crud_gui_summary_file=""
  local runtime_evomaster_summary_file=""
  mkdir -p "$artifact_dir/harness"
  if [[ "$phase" == "runtime-loop" ]]; then
    runtime_summary_file="$artifact_dir/harness/runtime-summary.json"
    runtime_junit_file="$artifact_dir/harness/runtime-junit.xml"
    runtime_artifacts_file="$artifact_dir/harness/runtime-artifacts.json"
    runtime_failures_file="$artifact_dir/harness/runtime-failures.json"
    runtime_form_crud_gui_summary_file="$artifact_dir/harness/runtime-form-crud-gui-summary.json"
    runtime_evomaster_summary_file="$artifact_dir/harness/runtime-evomaster-summary.json"
  fi
  jq -n \
    --arg artifact "$artifact" \
    --arg phase "$phase" \
    --arg status "$status" \
    --arg log "$log_file" \
    --arg message "$message" \
    --arg startEpoch "$LAST_RUN_START_EPOCH" \
    --arg startIso "$(iso_from_epoch "$LAST_RUN_START_EPOCH")" \
    --arg endEpoch "$LAST_RUN_END_EPOCH" \
    --arg endIso "$(iso_from_epoch "$LAST_RUN_END_EPOCH")" \
    --arg durationSeconds "$LAST_RUN_DURATION_SECONDS" \
    --arg runtimeSummary "$runtime_summary_file" \
    --arg runtimeJunit "$runtime_junit_file" \
    --arg runtimeArtifacts "$runtime_artifacts_file" \
    --arg runtimeFailures "$runtime_failures_file" \
    --arg runtimeFormCrudGuiSummary "$runtime_form_crud_gui_summary_file" \
    --arg runtimeEvoMasterSummary "$runtime_evomaster_summary_file" \
    'def nullable_number($v): if ($v | length) == 0 then null else ($v | tonumber) end;
    {artifact: $artifact, phase: $phase, exitCode: ($status | tonumber), ok: (($status | tonumber) == 0), log: $log, message: $message, startEpoch: nullable_number($startEpoch), startIso: $startIso, endEpoch: nullable_number($endEpoch), endIso: $endIso, durationSeconds: ($durationSeconds | tonumber)}
    + (if ($runtimeSummary | length) > 0 then {
      runtimeSummary: $runtimeSummary,
      runtimeJunit: $runtimeJunit,
      runtimeArtifacts: $runtimeArtifacts,
      runtimeFailures: $runtimeFailures,
      runtimeFormCrudGuiSummary: $runtimeFormCrudGuiSummary,
      runtimeEvoMasterSummary: $runtimeEvoMasterSummary
    } else {} end)' \
    > "$artifact_dir/harness/${phase}-status.json"
  jq -c . "$artifact_dir/harness/${phase}-status.json" >> "$SUMMARY_JSONL"
}

archive_runtime_loop_reports() {
  local artifact="$1"
  local artifact_dir="$OUTPUT_DIR/$artifact"
  local harness_dir="$artifact_dir/harness"
  local report_name
  mkdir -p "$harness_dir"
  for report_name in \
    runtime-summary.json \
    runtime-junit.xml \
    runtime-artifacts.json \
    runtime-failures.json \
    runtime-form-crud-gui-summary.json \
    runtime-evomaster-summary.json; do
    if [[ -f "$OUTPUT_DIR/$report_name" ]]; then
      cp "$OUTPUT_DIR/$report_name" "$harness_dir/$report_name"
    else
      rm -f "$harness_dir/$report_name"
    fi
  done
}

write_summary() {
  local summary_end_epoch
  local evomaster_status_files=()
  local form_crud_gui_status_files=()
  summary_end_epoch="$(now_epoch)"
  while IFS= read -r status_file; do
    evomaster_status_files+=("$status_file")
  done < <(find "$OUTPUT_DIR" -path '*/evomaster/status.json' -type f | sort)
  while IFS= read -r status_file; do
    form_crud_gui_status_files+=("$status_file")
  done < <(
    find "$OUTPUT_DIR" -path '*/form-crud-gui/form-crud-gui-summary.json' -type f | sort
    find "$OUTPUT_DIR" -path '*/form-crud-gui/form-crud-gui-smoke.json' -type f | sort | while IFS= read -r smoke_file; do
      summary_file="${smoke_file%/form-crud-gui-smoke.json}/form-crud-gui-summary.json"
      [[ -f "$summary_file" ]] || printf '%s\n' "$smoke_file"
    done
  )
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
        totalMainDurationSeconds: (map(.mainDurationSeconds // 0) | add // 0),
        totalConfiguredMainSeconds: (map(.seconds // 0) | add // 0),
        totalCoverageSweepDurationSeconds: (map(.coverageSweepTotalDurationSeconds // 0) | add // 0),
        totalCoverageSweepRunCount: (map(.coverageSweepRunCount // 0) | add // 0),
        totalCoverageSweepGainCount: (map(.coverageSweepGainCount // 0) | add // 0),
        totalEvoMasterEvaluatedTests: (map(.evomasterEvaluatedTests // 0) | add // 0),
        totalEvoMasterEvaluatedActions: (map(.evomasterEvaluatedActions // 0) | add // 0),
        totalEvoMasterCoveredTargets: (map(.evomasterCoveredTargets // 0) | add // 0),
        totalEvoMasterCoveredLines: (map(.evomasterCoveredLines // 0) | add // 0),
        totalEvoMasterNumberOfLines: (map(.evomasterNumberOfLines // 0) | add // 0),
        totalEvoMasterCoveredBranches: (map(.evomasterCoveredBranches // 0) | add // 0),
        totalEvoMasterNumberOfBranches: (map(.evomasterNumberOfBranches // 0) | add // 0),
        seedRetryWithoutSeedsCount: (map(select(.seedRetryWithoutSeeds == true)) | length),
        coverageRatio: ratio((map(.successfulEndpointCount // 0) | add // 0); (map(.declaredEndpointCount // 0) | add // 0)),
        evomasterLineCoverageRatio: ratio((map(.evomasterCoveredLines // 0) | add // 0); (map(.evomasterNumberOfLines // 0) | add // 0)),
        evomasterBranchCoverageRatio: ratio((map(.evomasterCoveredBranches // 0) | add // 0); (map(.evomasterNumberOfBranches // 0) | add // 0)),
        mainWallToBudgetRatio: ratio((map(.mainDurationSeconds // 0) | add // 0); (map(.seconds // 0) | add // 0)),
        coverageEndpointsPerMinute: ratio((map(.successfulEndpointCount // 0) | add // 0) * 60; (map(.durationSeconds // 0) | add // 0)),
        coveredTargetsPerMinute: ratio((map(.evomasterCoveredTargets // 0) | add // 0) * 60; (map(.durationSeconds // 0) | add // 0)),
        artifacts: map({
          artifact,
          exitCode,
          faultCount,
          durationSeconds,
          mainDurationSeconds,
          seconds,
          declaredEndpointCount,
          exercisedEndpointCount,
          successfulEndpointCount,
          coverageRatio: ratio(.successfulEndpointCount; .declaredEndpointCount),
          evomasterCoveredTargets,
          evomasterLineCoverageRatio,
          evomasterBranchCoverageRatio,
          evomasterEvaluatedTests,
          evomasterEvaluatedActions,
          mainWallToBudgetRatio: ratio(.mainDurationSeconds; .seconds),
          coverageSweepRunCount,
          coverageSweepTotalDurationSeconds,
          coverageSweepGainCount,
          coverageSweepStopReason,
          seedRetryWithoutSeeds
        })
      }
    ' "${evomaster_status_files[@]}" > "$EVOMASTER_SUMMARY_JSON"
  else
    printf '{"artifactCount":0,"artifacts":[]}\n' > "$EVOMASTER_SUMMARY_JSON"
  fi
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
        totalExercisedCreateResources: (map(.coverage.exercisedCreateResources // 0) | add // 0),
        totalSuccessfulCreateResources: (map(.coverage.successfulCreateResources // 0) | add // 0),
        totalPlannedListResources: (map(.coverage.plannedListResources // 0) | add // 0),
        totalExercisedListResources: (map(.coverage.exercisedListResources // 0) | add // 0),
        totalExercisedDetailResources: (map(.coverage.exercisedDetailResources // 0) | add // 0),
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
        totalApiOperationsPageSuccessfulOperations: (map(.coverage.apiOperationsPageSuccessfulOperations // 0) | add // 0),
        totalApiOperationsPageDeclaredResponseOperations: (map(.coverage.apiOperationsPageDeclaredResponseOperations // 0) | add // 0),
        totalApiOperationsPageContractCoveredOperations: (map(.coverage.apiOperationsPageContractCoveredOperations // 0) | add // 0),
        totalApiOperationsPageAccountedOperations: (map(.coverage.apiOperationsPageAccountedOperations // 0) | add // 0),
        totalApiOperationsPageUnexecutableOperations: (map(.coverage.apiOperationsPageUnexecutableOperations // 0) | add // 0),
        totalApiOperationsPageFailedOperations: (map(.coverage.apiOperationsPageFailedOperations // 0) | add // 0),
        totalApiOperationsPageRoundTripChecks: (map(.coverage.apiOperationsPageRoundTripChecks // 0) | add // 0),
        totalApiOperationsPageSuccessfulRoundTripChecks: (map(.coverage.apiOperationsPageSuccessfulRoundTripChecks // 0) | add // 0),
        totalStructuredObjectOperations: (map(.coverage.structuredObjectOperations // 0) | add // 0),
        totalStructuredArrayOperations: (map(.coverage.structuredArrayOperations // 0) | add // 0),
        totalObjectStringControlFailures: (map(.coverage.objectStringControlFailures // 0) | add // 0),
        totalResponsiveViewportsChecked: (map(.coverage.responsiveViewportsChecked // 0) | add // 0),
        totalCombinedSourceLines: (map(.sourceCoverage.combined.lines.total // 0) | add // 0),
        totalCoveredCombinedSourceLines: (map(.sourceCoverage.combined.lines.covered // 0) | add // 0),
        totalCombinedSourceBranches: (map(.sourceCoverage.combined.branches.total // 0) | add // 0),
        totalCoveredCombinedSourceBranches: (map(.sourceCoverage.combined.branches.covered // 0) | add // 0),
        totalScreenshots: (map((.screenshots // []) | length) | add // 0),
        angularJestPassed: (map(select((.jest.status // "skipped") == "passed")) | length),
        angularJestFailed: (map(select((.jest.status // "skipped") == "failed")) | length),
        angularJestSkipped: (map(select((.jest.status // "skipped") == "skipped")) | length),
        totalAngularJestDurationMs: (map(.jest.durationMs // 0) | add // 0),
        createSuccessRatio: ratio((map(.coverage.successfulCreateResources // 0) | add // 0); (map(.coverage.plannedCreateResources // 0) | add // 0)),
        listExerciseRatio: ratio((map(.coverage.exercisedListResources // 0) | add // 0); (map(.coverage.plannedListResources // 0) | add // 0)),
        updateSuccessRatio: ratio((map(.coverage.successfulUpdateResources // 0) | add // 0); (map(.coverage.exercisedUpdateResources // 0) | add // 0)),
        deleteSuccessRatio: ratio((map(.coverage.successfulDeleteResources // 0) | add // 0); (map(.coverage.exercisedDeleteResources // 0) | add // 0)),
        referencePickerSaveSuccessRatio: ratio((map(.coverage.successfulReferencePickerSaves // 0) | add // 0); (map(.coverage.exercisedReferencePickerSaves // 0) | add // 0)),
        operationRenderCoverageRatio: ratio((map(.coverage.renderedOperations // 0) | add // 0); (map(.coverage.declaredOperations // 0) | add // 0)),
        apiOperationsPageRenderCoverageRatio: ratio((map(.coverage.apiOperationsPageRenderedOperations // 0) | add // 0); (map(.coverage.declaredOperations // 0) | add // 0)),
        apiOperationsPageSubmissionCoverageRatio: ratio((map(.coverage.apiOperationsPageSubmittedOperations // 0) | add // 0); (map(.coverage.declaredOperations // 0) | add // 0)),
        apiOperationsPageSuccessCoverageRatio: ratio((map(.coverage.apiOperationsPageSuccessfulOperations // 0) | add // 0); (map(.coverage.declaredOperations // 0) | add // 0)),
        apiOperationsPageContractCoverageRatio: ratio((map(.coverage.apiOperationsPageContractCoveredOperations // 0) | add // 0); (map(.coverage.declaredOperations // 0) | add // 0)),
        apiOperationsPageAccountedCoverageRatio: ratio((map(.coverage.apiOperationsPageAccountedOperations // 0) | add // 0); (map(.coverage.declaredOperations // 0) | add // 0)),
        apiOperationsPageRoundTripSuccessRatio: ratio((map(.coverage.apiOperationsPageSuccessfulRoundTripChecks // 0) | add // 0); (map(.coverage.apiOperationsPageRoundTripChecks // 0) | add // 0)),
        combinedSourceLineCoverageRatio: ratio((map(.sourceCoverage.combined.lines.covered // 0) | add // 0); (map(.sourceCoverage.combined.lines.total // 0) | add // 0)),
        combinedSourceBranchCoverageRatio: ratio((map(.sourceCoverage.combined.branches.covered // 0) | add // 0); (map(.sourceCoverage.combined.branches.total // 0) | add // 0)),
        artifacts: map({
          artifact,
          status,
          durationMs,
          resourceCount: (.resourceCount // .coverage.discoveredResources // 0),
          coverage,
          sourceCoverage,
          angularJest: (.jest // null),
          browserStatus: (.browser.status // .status),
          screenshotCount: ((.screenshots // []) | length),
          error: (.error.message // "")
        })
      }
    ' "${form_crud_gui_status_files[@]}" > "$FORM_CRUD_GUI_SUMMARY_JSON"
  else
    printf '{"artifactCount":0,"artifacts":[]}\n' > "$FORM_CRUD_GUI_SUMMARY_JSON"
  fi

  jq -s \
    --arg startEpoch "$FULL_MATRIX_START_EPOCH" \
    --arg startIso "$(iso_from_epoch "$FULL_MATRIX_START_EPOCH")" \
    --arg endEpoch "$summary_end_epoch" \
    --arg endIso "$(iso_from_epoch "$summary_end_epoch")" \
    --slurpfile evomaster "$EVOMASTER_SUMMARY_JSON" \
    --slurpfile formCrudGui "$FORM_CRUD_GUI_SUMMARY_JSON" \
    '
    def nullable_number($v): if ($v | length) == 0 then null else ($v | tonumber) end;
    {
      startEpoch: nullable_number($startEpoch),
      startIso: $startIso,
      endEpoch: nullable_number($endEpoch),
      endIso: $endIso,
      durationSeconds: (nullable_number($endEpoch) - nullable_number($startEpoch)),
      total: length,
      failed: map(select(.ok | not)) | length,
      passed: map(select(.ok)) | length,
      ok: ((map(select(.ok | not)) | length) == 0),
      totalDurationSeconds: (map(.durationSeconds // 0) | add // 0),
      evomaster: ($evomaster[0] // {artifactCount: 0, artifacts: []}),
      formCrudGui: ($formCrudGui[0] // {artifactCount: 0, artifacts: []}),
      results: .
    }
  ' "$SUMMARY_JSONL" > "$SUMMARY_JSON"

  jq -r '
    def esc:
      tostring
      | gsub("&"; "&amp;")
      | gsub("<"; "&lt;")
      | gsub(">"; "&gt;")
      | gsub("\""; "&quot;");
    "<testsuite name=\"oas-regression-full-matrix\" tests=\"\(.total)\" failures=\"\(.failed)\">",
    (.results[] |
      "  <testcase classname=\"\(.artifact | esc)\" name=\"\(.phase | esc)\">" +
      (if .ok then "" else "<failure message=\"exit \(.exitCode)\">\(.message | esc)\n\(.log | esc)</failure>" end) +
      "</testcase>"
    ),
    "</testsuite>"
  ' "$SUMMARY_JSON" > "$SUMMARY_JUNIT"
}

exact_include_for() {
  printf '^%s\\s' "$1"
}

overall_status=0

if [[ "$FULL_MATRIX_BUILD" == "true" ]]; then
  build_log="$OUTPUT_DIR/npm-build.log"
  timestamped_step "generator-jhipster" "npm run build"
  if run_logged "$build_log" timeout --kill-after="${FULL_MATRIX_TIMEOUT_KILL_AFTER_SECONDS}s" "${FULL_MATRIX_BUILD_TIMEOUT_SECONDS}s" env NO_UPDATE_NOTIFIER=1 npm --prefix "$GENERATOR_ROOT" run build; then
    record_status "generator-jhipster" "build" "0" "$build_log" "npm run build passed"
  else
    status=$?
    record_status "generator-jhipster" "build" "$status" "$build_log" "npm run build failed"
    overall_status=1
    if [[ "$FULL_MATRIX_CONTINUE_AFTER_BUILD_FAILURE" != "true" ]]; then
      write_summary
      exit "$overall_status"
    fi
  fi
fi

if [[ "$SKIP_OAS_TO_JDL" != "true" ]]; then
  oas_log="$OUTPUT_DIR/oas-to-jdl.log"
  timestamped_step "oas-to-jdl" "regenerate JDL artifacts from $ARTIFACT_ROOT"
  if run_logged "$oas_log" timeout --kill-after="${FULL_MATRIX_TIMEOUT_KILL_AFTER_SECONDS}s" "${FULL_MATRIX_OAS_TO_JDL_TIMEOUT_SECONDS}s" java -jar "$OAS_TO_JDL_JAR" --input="$ARTIFACT_ROOT/" --output="$ARTIFACT_ROOT/" --use-relationships=true; then
    record_status "oas-to-jdl" "regenerate" "0" "$oas_log" "OAS-to-JDL regeneration passed"
  else
    status=$?
    record_status "oas-to-jdl" "regenerate" "$status" "$oas_log" "OAS-to-JDL regeneration failed"
    overall_status=1
    write_summary
    exit "$overall_status"
  fi
fi

while IFS=$'\t' read -r name _app_dir _jdl_file _yaml_file _db_user _db_name _base_name; do
  if [[ -z "$name" ]]; then
    continue
  fi

  artifact_dir="$OUTPUT_DIR/$name"
  mkdir -p "$artifact_dir/harness"
  include_pattern="$(exact_include_for "$name")"
  compile_ok=true

  if [[ "$FULL_MATRIX_GENERATE_COMPILE" == "true" ]]; then
    compile_log="$artifact_dir/harness/generate-compile.log"
    timestamped_step "$name" "full-matrix generate/compile"
    if run_logged "$compile_log" timeout --kill-after="${FULL_MATRIX_TIMEOUT_KILL_AFTER_SECONDS}s" "${FULL_MATRIX_GENERATE_COMPILE_TIMEOUT_SECONDS}s" env \
      SKIP_OAS_TO_JDL=true \
      ARTIFACT_INCLUDE="$include_pattern" \
      MAVEN_OFFLINE="$MAVEN_OFFLINE" \
      "$SCRIPT_DIR/generate_compile.sh"; then
      record_status "$name" "generate-compile" "0" "$compile_log" "generate/compile passed"
    else
      status=$?
      compile_ok=false
      overall_status=1
      record_status "$name" "generate-compile" "$status" "$compile_log" "generate/compile failed"
    fi
  fi

  if [[ "$FULL_MATRIX_RUNTIME" == "true" && "$compile_ok" == "true" ]]; then
    runtime_log="$artifact_dir/harness/runtime-loop.log"
    timestamped_step "$name" "full-matrix runtime/EvoMaster"
    if run_logged "$runtime_log" timeout --kill-after="${FULL_MATRIX_TIMEOUT_KILL_AFTER_SECONDS}s" "${FULL_MATRIX_RUNTIME_TIMEOUT_SECONDS}s" env \
      ARTIFACT_INCLUDE="$include_pattern" \
      OUTPUT_DIR="$OUTPUT_DIR" \
      MAVEN_OFFLINE="$MAVEN_OFFLINE" \
      DOCKER_COMPOSE_UP_ARGS="$DOCKER_COMPOSE_UP_ARGS" \
      "$SCRIPT_DIR/runtime_loop.sh"; then
      archive_runtime_loop_reports "$name"
      if [[ "${EVOMASTER_ENABLED:-true}" == "true" ]]; then
        record_status "$name" "runtime-loop" "0" "$runtime_log" "runtime smoke and EvoMaster passed"
      else
        record_status "$name" "runtime-loop" "0" "$runtime_log" "runtime smoke passed; EvoMaster disabled"
      fi
    else
      status=$?
      overall_status=1
      archive_runtime_loop_reports "$name"
      record_status "$name" "runtime-loop" "$status" "$runtime_log" "runtime smoke or EvoMaster failed"
    fi
  elif [[ "$FULL_MATRIX_RUNTIME" == "true" ]]; then
    LAST_RUN_START_EPOCH="$(now_epoch)"
    LAST_RUN_END_EPOCH="$LAST_RUN_START_EPOCH"
    LAST_RUN_DURATION_SECONDS=0
    record_status "$name" "runtime-loop" "125" "$artifact_dir/harness/runtime-loop.log" "runtime skipped because generate/compile failed"
  fi
done < <(
  node "$SCRIPT_DIR/artifact-utils.mjs" list \
    --artifact-root "$ARTIFACT_ROOT" \
    --workspace-root "$WORKSPACE_ROOT" \
    --app-root "$REGRESSION_APP_ROOT" \
    --format tsv
)

write_summary

if [[ "$overall_status" != "0" ]]; then
  echo "Full matrix completed with failures. Summary: $SUMMARY_JSON" >&2
fi

exit "$overall_status"
