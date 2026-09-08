#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/node-runtime.sh"

TEST_ROOT="$(mktemp -d)"
trap '[[ -n "${TEST_ROOT:-}" && -d "$TEST_ROOT" ]] && rm -rf -- "$TEST_ROOT"' EXIT

create_node() {
  local node_binary="$1"
  mkdir -p "$(dirname "$node_binary")"
  touch "$node_binary"
  chmod +x "$node_binary"
}

create_generator_root() {
  local root="$1"
  local recommended_version="$2"
  mkdir -p "$root/generators/init/resources"
  printf '%s\n' "$recommended_version" > "$root/generators/init/resources/.node-version"
}

assert_equals() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL: %s\nExpected: %s\nActual:   %s\n' "$message" "$expected" "$actual" >&2
    return 1
  fi
}

test_configured_runtime_takes_precedence() (
  local fixture="$TEST_ROOT/configured"
  local configured_bin="$fixture/configured/bin"
  GENERATOR_ROOT="$fixture/generator"
  HOME="$fixture/home"
  create_generator_root "$GENERATOR_ROOT" "24.20.0"
  create_node "$configured_bin/node"
  create_node "$HOME/.nvm/versions/node/v24.20.0/bin/node"

  node_satisfies_generator_engine() {
    [[ -x "$1" ]]
  }

  assert_equals "$configured_bin" "$(resolve_generator_node_bin "$configured_bin")" \
    'an explicit compatible runtime should take precedence'
)

test_recorded_runtime_takes_precedence_over_current() (
  local fixture="$TEST_ROOT/recorded"
  local current_bin="$fixture/current/bin"
  local recommended_bin
  GENERATOR_ROOT="$fixture/generator"
  HOME="$fixture/home"
  recommended_bin="$HOME/.nvm/versions/node/v24.20.0/bin"
  create_generator_root "$GENERATOR_ROOT" "24.20.0"
  create_node "$current_bin/node"
  create_node "$recommended_bin/node"
  PATH="$current_bin:$PATH"

  node_satisfies_generator_engine() {
    [[ -x "$1" ]]
  }

  assert_equals "$recommended_bin" "$(resolve_generator_node_bin)" \
    'the recorded runtime should take precedence over a compatible current runtime'
)

test_current_runtime_is_used_when_recorded_runtime_is_unavailable() (
  local fixture="$TEST_ROOT/current"
  local current_bin="$fixture/current/bin"
  GENERATOR_ROOT="$fixture/generator"
  HOME="$fixture/home"
  create_generator_root "$GENERATOR_ROOT" "24.20.0"
  create_node "$current_bin/node"
  PATH="$current_bin:$PATH"

  node_satisfies_generator_engine() {
    [[ -x "$1" ]]
  }

  assert_equals "$current_bin" "$(resolve_generator_node_bin)" \
    'the current compatible runtime should be used when the recorded runtime is unavailable'
)

test_explicit_node_bin_override_takes_precedence() (
  local fixture="$TEST_ROOT/node-bin-override"
  local configured_bin="$fixture/configured/bin"
  local current_bin="$fixture/current/bin"
  create_node "$configured_bin/node"
  create_node "$current_bin/node"
  PATH="$current_bin:$PATH"

  assert_equals "$configured_bin" "$(resolve_node_bin "$configured_bin")" \
    'an explicit Node bin should take precedence over the current runtime'
)

test_current_node_bin_is_used_without_override() (
  local fixture="$TEST_ROOT/current-node-bin"
  local current_bin="$fixture/current/bin"
  create_node "$current_bin/node"
  PATH="$current_bin:$PATH"

  assert_equals "$current_bin" "$(resolve_node_bin)" \
    'the current Node bin should be preserved when no override is configured'
)

test_configured_runtime_takes_precedence
test_recorded_runtime_takes_precedence_over_current
test_current_runtime_is_used_when_recorded_runtime_is_unavailable
test_explicit_node_bin_override_takes_precedence
test_current_node_bin_is_used_without_override
printf 'node-runtime tests passed\n'
