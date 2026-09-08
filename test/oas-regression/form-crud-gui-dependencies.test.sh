#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/form-crud-gui-dependencies.sh"

TEST_ROOT="$(mktemp -d)"
trap '[[ -n "${TEST_ROOT:-}" && -d "$TEST_ROOT" ]] && rm -rf -- "$TEST_ROOT"' EXIT

now_epoch() {
  date +%s
}

duration_seconds() {
  echo 0
}

timestamped_step() {
  :
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -F -- "$expected" "$file" >/dev/null || fail "expected $file to contain: $expected"
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -F -- "$unexpected" "$file" >/dev/null; then
    fail "expected $file not to contain: $unexpected"
  fi
}

create_fake_commands() {
  local fixture="$1"
  mkdir -p "$fixture/bin" "$fixture/app"

  cat > "$fixture/bin/node" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == *form-crud-gui-smoke.mjs ]]; then
  [[ -f "$FORM_CRUD_GUI_PLAYWRIGHT_ROOT/playwright-ready" ]]
elif [[ "$1" == *form-crud-source-coverage.mjs ]]; then
  [[ -f "$FORM_CRUD_GUI_PLAYWRIGHT_ROOT/coverage-ready" ]]
else
  exit 2
fi
EOF
  cat > "$fixture/bin/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$INSTALL_LOG"
touch "$FORM_CRUD_GUI_PLAYWRIGHT_ROOT/playwright-ready"
if [[ " $* " == *" @bcoe/v8-coverage "* ]]; then
  touch "$FORM_CRUD_GUI_PLAYWRIGHT_ROOT/coverage-ready"
fi
EOF
  chmod +x "$fixture/bin/node" "$fixture/bin/npm"
}

configure_fixture() {
  local fixture="$1"
  FORM_CRUD_GUI_NODE_BIN="$fixture/bin"
  FORM_CRUD_GUI_PLAYWRIGHT_ROOT="$fixture/playwright"
  FORM_CRUD_GUI_PLAYWRIGHT_INSTALL="offline"
  FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS="skip"
  FORM_CRUD_GUI_PLAYWRIGHT_BROWSER="chromium"
  FORM_CRUD_GUI_PLAYWRIGHT_PACKAGE="@playwright/test"
  FORM_CRUD_GUI_SOURCE_COVERAGE_PACKAGES="@bcoe/v8-coverage v8-to-istanbul istanbul-lib-coverage istanbul-lib-report istanbul-reports"
  FORM_CRUD_GUI_SMOKE="$SCRIPT_DIR/form-crud-gui-smoke.mjs"
  FORM_CRUD_GUI_SOURCE_COVERAGE_WORKER="$SCRIPT_DIR/form-crud-source-coverage.mjs"
  INSTALL_LOG="$fixture/npm-install.log"
  export INSTALL_LOG FORM_CRUD_GUI_PLAYWRIGHT_ROOT
}

test_incomplete_coverage_toolchain_is_provisioned() {
  local fixture="$TEST_ROOT/coverage"
  create_fake_commands "$fixture"
  configure_fixture "$fixture"
  FORM_CRUD_GUI_SOURCE_COVERAGE_ENABLED="true"
  mkdir -p "$FORM_CRUD_GUI_PLAYWRIGHT_ROOT"
  touch "$FORM_CRUD_GUI_PLAYWRIGHT_ROOT/playwright-ready"

  ensure_form_crud_gui_playwright_dependencies "fixture" "$fixture/app"

  assert_contains "$INSTALL_LOG" "@playwright/test"
  assert_contains "$INSTALL_LOG" "@bcoe/v8-coverage"
  assert_contains "$INSTALL_LOG" "v8-to-istanbul"
  assert_contains "$INSTALL_LOG" "istanbul-lib-coverage"
  assert_contains "$INSTALL_LOG" "istanbul-lib-report"
  assert_contains "$INSTALL_LOG" "istanbul-reports"
  assert_contains "$INSTALL_LOG" "--offline"
}

test_coverage_packages_are_omitted_when_coverage_is_disabled() {
  local fixture="$TEST_ROOT/no-coverage"
  create_fake_commands "$fixture"
  configure_fixture "$fixture"
  FORM_CRUD_GUI_SOURCE_COVERAGE_ENABLED="false"

  ensure_form_crud_gui_playwright_dependencies "fixture" "$fixture/app"

  assert_contains "$INSTALL_LOG" "@playwright/test"
  assert_not_contains "$INSTALL_LOG" "@bcoe/v8-coverage"
  assert_not_contains "$INSTALL_LOG" "v8-to-istanbul"
}

test_incomplete_coverage_toolchain_is_provisioned
test_coverage_packages_are_omitted_when_coverage_is_disabled
printf 'form-crud-gui dependency tests passed\n'
