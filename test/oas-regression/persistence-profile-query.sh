#!/usr/bin/env bash

matching_persistence_profiles() {
  local artifact_file="$1"
  local profiles_file="$2"

  jq -c --arg artifact_file "$artifact_file" '
    .[] |
    .artifactPattern as $artifact_pattern |
    select($artifact_file | test($artifact_pattern))
  ' "$profiles_file"
}
