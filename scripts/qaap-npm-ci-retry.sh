#!/usr/bin/env bash
# Resilient `npm ci` for CI, the Docker build and local preflight.
#
# npm's own --fetch-retries only retries single tarball requests; a registry connection reset
# (ECONNRESET after a ~6 min hang, seen 3x on Oct 15 2026) still fails the whole install. This
# wrapper keeps npm's fetch-retry flags and re-runs the complete install up to
# QAAP_NPM_CI_ATTEMPTS times (default 3), removing the half-written node_modules in between.
#
# Usage: bash scripts/qaap-npm-ci-retry.sh [extra npm ci args...]
#   e.g. bash scripts/qaap-npm-ci-retry.sh --include=optional
# Extra args are passed through after the fetch-retry flags, so a caller can override them.
# Run from the directory that holds package-lock.json (root installs only; it removes
# ./node_modules between attempts, so do not use it with --prefix).
# Portable to macOS bash 3.2 and Git Bash on Windows runners.
set -o pipefail

attempts="${QAAP_NPM_CI_ATTEMPTS:-3}"
case "$attempts" in
    '' | *[!0-9]* | 0) echo "[qaap-npm-ci-retry] QAAP_NPM_CI_ATTEMPTS must be a positive integer" >&2; exit 2 ;;
esac

for arg in "$@"; do
    case "$arg" in
        --prefix | --prefix=*) echo "[qaap-npm-ci-retry] --prefix is not supported (it would clean the wrong node_modules)" >&2; exit 2 ;;
    esac
done

attempt=1
while :; do
    echo "[qaap-npm-ci-retry] npm ci attempt ${attempt}/${attempts}"
    if npm ci \
        --fetch-retries=5 \
        --fetch-retry-factor=2 \
        --fetch-retry-mintimeout=1000 \
        --fetch-retry-maxtimeout=120000 \
        "$@"; then
        exit 0
    else
        status=$?
    fi
    if [ "$attempt" -ge "$attempts" ]; then
        echo "[qaap-npm-ci-retry] npm ci failed after ${attempts} attempt(s) (exit ${status})" >&2
        exit "$status"
    fi
    delay=$((attempt * 15))
    echo "[qaap-npm-ci-retry] npm ci failed (exit ${status}); removing node_modules and retrying in ${delay}s" >&2
    rm -rf node_modules
    sleep "$delay"
    attempt=$((attempt + 1))
done
