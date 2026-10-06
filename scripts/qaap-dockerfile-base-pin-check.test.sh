#!/usr/bin/env bash
# Test the Dockerfile base image pin check, and that the VPS deploy pulls the CI-verified image
# before anything can make Compose build `theia` from source.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK="$ROOT/scripts/qaap-dockerfile-base-pin-check.sh"
UPDATE="$ROOT/scripts/qaap-vps-update.sh"
TEST_ROOT="$(mktemp -d -t qaap-dockerfile-pin-test.XXXXXXXX)"
cleanup() { case "$TEST_ROOT" in */qaap-dockerfile-pin-test.*) rm -rf -- "$TEST_ROOT" ;; *) exit 2 ;; esac; }
trap cleanup EXIT

failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
pass() { echo "ok - $*"; }

DIGEST="sha256:363e1587494626837fa7f9a23bdb453d13b0ff3c67c705c2805cfc69c2d2fad7"

expect() {
    local want="$1" name="$2" content="$3" file
    file="$TEST_ROOT/$(printf '%s' "$name" | tr -c 'a-z0-9' '-').Dockerfile"
    printf '%s\n' "$content" > "$file"
    if bash "$CHECK" "$file" >"$file.out" 2>&1; then got=pass; else got=fail; fi
    if [[ "$got" == "$want" ]]; then pass "$name"; else fail "$name: expected $want, got $got"; cat "$file.out" >&2; fi
}

if bash "$CHECK" >/dev/null 2>&1; then pass 'repository Dockerfile is pinned'; else fail 'repository Dockerfile is not pinned'; bash "$CHECK" || true; fi

expect pass 'version tag and digest' "FROM node:22.23.3-bookworm@$DIGEST AS build
FROM build AS runtime"
expect pass 'platform flag, stage reference and scratch' "FROM --platform=linux/amd64 node:22.23.3-bookworm@$DIGEST AS Build
FROM build
FROM scratch"
expect pass 'CRLF line endings' "FROM node:22.23.3-bookworm@$DIGEST AS build"$'\r'
expect pass 'registry with port' "FROM registry.local:5000/qaap/base:1.2@$DIGEST"
expect fail 'moving tag without digest' 'FROM node:22-bookworm AS build'
expect fail 'digest without version tag' "FROM node@$DIGEST"
expect fail 'lower-case from without digest' 'from python:3.12-slim-bookworm as python-runtime'
expect fail 'short digest' 'FROM node:22.23.3-bookworm@sha256:363e1587'
expect fail 'image from a build arg' 'ARG BASE=node:22
FROM ${BASE}'
expect fail 'one unpinned stage among pinned ones' "FROM node:22.23.3-bookworm@$DIGEST AS build
FROM node:22-bookworm-slim AS runtime"
expect fail 'stage alias defined later is not a stage yet' "FROM runtime
FROM node:22.23.3-bookworm@$DIGEST AS runtime"
expect fail 'no FROM' 'RUN true'

# The deploy must pull (and verify) the CI image before the runtime-state check, which runs a
# temporary `theia` container: with QAAP_THEIA_IMAGE unset, Compose builds qaap-theia:local.
pull_line="$(grep -n '^    docker compose pull theia$' "$UPDATE" | head -n 1 | cut -d: -f1)"
check_line="$(grep -n '^run_runtime_state_check$' "$UPDATE" | head -n 1 | cut -d: -f1)"
export_line="$(grep -n '^    export QAAP_THEIA_IMAGE="\$IMAGE_REF"$' "$UPDATE" | head -n 1 | cut -d: -f1)"
if [[ -n "$pull_line" && -n "$check_line" && -n "$export_line" ]] \
    && (( export_line < pull_line && pull_line < check_line )); then
    pass 'VPS deploy pulls the CI image before the runtime-state check'
else
    fail "VPS deploy must export QAAP_THEIA_IMAGE and pull it before run_runtime_state_check (export=${export_line:-none} pull=${pull_line:-none} check=${check_line:-none})"
fi

if (( failures > 0 )); then
    echo "$failures failure(s)" >&2
    exit 1
fi
echo 'all Dockerfile base pin checks passed'
