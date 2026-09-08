#!/usr/bin/env bash

node_satisfies_generator_engine() {
  local node_binary="$1"

  [[ -x "$node_binary" ]] || return 1
  "$node_binary" -e '
    const root = process.argv[1];
    const semver = require(`${root}/node_modules/semver`);
    const packageJson = require(`${root}/package.json`);
    process.exit(semver.satisfies(process.versions.node, packageJson.engines.node) ? 0 : 1);
  ' "$GENERATOR_ROOT"
}

resolve_node_bin() {
  local configured_bin="${1:-}"
  local current_node

  if [[ -n "$configured_bin" ]]; then
    if [[ -x "$configured_bin/node" ]]; then
      printf '%s\n' "$configured_bin"
      return
    fi
    printf 'Configured Node bin does not contain an executable node: %s\n' "$configured_bin" >&2
    return 1
  fi

  current_node="$(command -v node)"
  dirname "$current_node"
}

resolve_generator_node_bin() {
  local configured_bin="${1:-}"
  local current_node recommended_version recommended_node node_binary

  if [[ -n "$configured_bin" ]]; then
    if node_satisfies_generator_engine "$configured_bin/node"; then
      printf '%s\n' "$configured_bin"
      return
    fi
    printf 'GENERATOR_NODE_BIN does not contain a Node runtime satisfying %s\n' \
      "$(node -p "require('$GENERATOR_ROOT/package.json').engines.node")" >&2
    return 1
  fi

  recommended_version="$(cat "$GENERATOR_ROOT/generators/init/resources/.node-version")"
  recommended_node="$HOME/.nvm/versions/node/v$recommended_version/bin/node"
  if node_satisfies_generator_engine "$recommended_node"; then
    dirname "$recommended_node"
    return
  fi

  current_node="$(command -v node)"
  if node_satisfies_generator_engine "$current_node"; then
    dirname "$current_node"
    return
  fi

  while IFS= read -r node_binary; do
    if node_satisfies_generator_engine "$node_binary"; then
      dirname "$node_binary"
      return
    fi
  done < <(find "$HOME/.nvm/versions/node" -type f -path '*/bin/node' -print 2> /dev/null | sort -Vr)

  printf 'No Node runtime satisfying the generator engine %s was found\n' \
    "$(node -p "require('$GENERATOR_ROOT/package.json').engines.node")" >&2
  return 1
}
