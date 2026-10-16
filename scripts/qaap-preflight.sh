#!/usr/bin/env bash
# Local preflight: run what the REQUIRED master checks run, in fail-fast order, before pushing.
#
#   npm run qaap:preflight                 # --quick (default)
#   npm run qaap:preflight -- --full       # everything the required checks do (long)
#   npm run qaap:preflight -- --help
#
# Required checks mirrored (doc/qaap-ci-invariants.md, "Required checks"):
#   qaap-guards (qaap-guards.yml), qaap:drift-check (qaap-drift-check.yml), Lint and
#   Build and Test ubuntu node-22/24 (ci-cd.yml), Playwright Tests (playwright.yml, only with
#   --with-upstream-playwright), Smoke Test for Browser Example Production Build
#   (production-smoke-test.yml).
# Keep the commands in sync with those workflows when they change.
#
# Portable to macOS bash 3.2: no associative arrays, no mapfile, no ${var,,}.
# Step functions below are called indirectly through run_step "$@".
# shellcheck disable=SC2329
set -o pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 2

MODE=quick
INSTALL=0
UPSTREAM_PLAYWRIGHT=0
BASE_REF=origin/master

usage() {
    cat <<'EOF'
Usage: npm run qaap:preflight -- [--quick | --full] [options]

Modes:
  --quick (default)  Static guards exactly as qaap-guards.yml and qaap-drift-check.yml run them,
                     package-graph check, npm run compile, then lint and unit tests only for the
                     packages changed vs --base (plus their dependents). No npm ci unless --install.
  --full             Everything the required checks run: npm ci, full lint, npm run build,
                     download:plugins, mobile bundle guard + required mobile E2E (qaap-guards),
                     rebuild:browser + test:theia + test:browser (Build and Test), and the
                     production build + theia-app Playwright smoke. Takes a long time.

Options:
  --install                   Run npm ci (with scripts/qaap-npm-ci-retry.sh) first. Default in --full.
  --no-install                Skip npm ci in --full (reuse the current node_modules).
  --with-upstream-playwright  In --full, also run the upstream Playwright suite
                              (playwright.qaap-upstream-ci.config.ts) with the CI env vars.
  --base <ref>                Ref for "changed packages" in --quick (default: origin/master).
                              Run `git fetch origin master` first if it is stale.
  -h, --help                  Show this help.

Stops at the first failure and prints a timed summary table.
EOF
}

INSTALL_SET=0
while [ $# -gt 0 ]; do
    case "$1" in
        --quick) MODE=quick ;;
        --full) MODE=full ;;
        --install) INSTALL=1; INSTALL_SET=1 ;;
        --no-install) INSTALL=0; INSTALL_SET=1 ;;
        --with-upstream-playwright) UPSTREAM_PLAYWRIGHT=1 ;;
        --base)
            shift
            [ $# -gt 0 ] || { echo "--base needs a ref" >&2; exit 2; }
            BASE_REF="$1" ;;
        --base=*) BASE_REF="${1#--base=}" ;;
        -h | --help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
    shift
done
if [ "$MODE" = full ] && [ "$INSTALL_SET" = 0 ]; then INSTALL=1; fi

OS_NAME="$(uname -s)"
export NODE_OPTIONS="${NODE_OPTIONS:---max_old_space_size=4096}"
# Same as CI: lerna runs without the Nx daemon.
export NX_DAEMON=false

# ---- step bookkeeping (indexed arrays only: bash 3.2) ------------------------------------------
STEP_NAMES=()
STEP_STATUS=()
STEP_SECS=()
STEP_NOTES=()
RUN_START=$(date +%s)

fmt_secs() {
    printf '%dm%02ds' $(($1 / 60)) $(($1 % 60))
}

print_summary() {
    local i total
    total=$(( $(date +%s) - RUN_START ))
    echo
    echo "==================== qaap preflight (${MODE}) summary ===================="
    printf '%-6s  %8s  %s\n' STATUS TIME STEP
    i=0
    while [ $i -lt ${#STEP_NAMES[@]} ]; do
        if [ -n "${STEP_NOTES[$i]}" ]; then
            printf '%-6s  %8s  %s  (%s)\n' "${STEP_STATUS[$i]}" "$(fmt_secs "${STEP_SECS[$i]}")" "${STEP_NAMES[$i]}" "${STEP_NOTES[$i]}"
        else
            printf '%-6s  %8s  %s\n' "${STEP_STATUS[$i]}" "$(fmt_secs "${STEP_SECS[$i]}")" "${STEP_NAMES[$i]}"
        fi
        i=$((i + 1))
    done
    echo "Total: $(fmt_secs "$total")"
    echo
    echo "Not covered locally (CI still decides):"
    echo "  - one Node version here ($(node -v 2>/dev/null || echo 'node missing')); CI Build and Test runs node 22.x AND 24.x."
    if [ "$OS_NAME" != Linux ]; then
        echo "  - ${OS_NAME} host: Linux-only specs (e.g. the rlimit fallback spec) and the Linux-only bash/GNU guard tests"
        echo "    marked SKIP above run only on the ubuntu runners."
    fi
    echo "  - the windows-2022 / macos-15 Build legs (master pushes, or PRs labeled ci:full) and test:electron."
    if [ "$MODE" = quick ]; then
        echo "  - --quick skips npm ci, full lint, bundles and every Playwright suite: run --full before risky merges."
    elif [ "$UPSTREAM_PLAYWRIGHT" = 0 ]; then
        echo "  - the required upstream Playwright check (add --with-upstream-playwright)."
    fi
}

on_interrupt() {
    echo
    echo "Interrupted."
    print_summary
    exit 130
}
trap on_interrupt INT TERM

record() { # name status secs note
    STEP_NAMES+=("$1")
    STEP_STATUS+=("$2")
    STEP_SECS+=("$3")
    STEP_NOTES+=("$4")
}

# run_step <name> <command...>: runs the command in a subshell (cd does not leak); stops on failure.
run_step() {
    local name="$1" start secs status
    shift
    echo
    echo "---- [preflight] ${name}"
    start=$(date +%s)
    ( "$@" )
    status=$?
    secs=$(( $(date +%s) - start ))
    if [ $status -eq 0 ]; then
        record "$name" ok "$secs" ""
    else
        record "$name" FAIL "$secs" "exit ${status}"
        echo
        echo "[preflight] FAILED: ${name} (exit ${status}). Stopping (fail-fast)."
        print_summary
        exit 1
    fi
}

skip_step() { # name reason
    echo
    echo "---- [preflight] ${1}: SKIP (${2})"
    record "$1" SKIP 0 "$2"
}

# Bash guard tests that need bash >= 4 or GNU userland (declare -A, ${,,}, mapfile, find -printf).
linux_only_step() {
    if [ "$OS_NAME" = Linux ]; then
        run_step "$@"
    else
        skip_step "$1" "needs Linux bash>=4/GNU tools; runs in CI"
    fi
}

# ---- step implementations ----------------------------------------------------------------------
fetch_upstream_base() {
    local upstream_base attempt
    upstream_base="$(sed -e 's/#.*//' -e '/^[[:space:]]*$/d' scripts/qaap-upstream-base.txt)"
    case "$upstream_base" in
        *[!0-9a-f]* | '') echo "Invalid upstream base in scripts/qaap-upstream-base.txt: $upstream_base" >&2; return 2 ;;
    esac
    if [ ${#upstream_base} -ne 40 ]; then
        echo "Invalid upstream base in scripts/qaap-upstream-base.txt: $upstream_base" >&2
        return 2
    fi
    if git cat-file -e "${upstream_base}^{commit}" 2>/dev/null; then
        echo "Reviewed upstream base ${upstream_base} already present."
        return 0
    fi
    if git remote get-url upstream >/dev/null 2>&1; then
        git remote set-url upstream https://github.com/eclipse-theia/theia.git
    else
        git remote add upstream https://github.com/eclipse-theia/theia.git
    fi
    for attempt in 1 2 3; do
        if git -c http.version=HTTP/1.1 fetch --no-tags --depth=1 --filter=blob:none upstream "$upstream_base"; then
            break
        fi
        if [ "$attempt" -eq 3 ]; then
            echo "Unable to fetch reviewed upstream base: $upstream_base" >&2
            return 1
        fi
        sleep $((attempt * 5))
    done
    git cat-file -e "${upstream_base}^{commit}"
}

require_node_modules() {
    if [ ! -d node_modules/typescript ] || [ ! -d node_modules/lerna ]; then
        echo "node_modules is missing or incomplete; rerun with --install." >&2
        return 1
    fi
}

compile_step() { require_node_modules && npm run compile; }

package_graph_step() { require_node_modules && node scripts/qaap-package-graph-check.js; }

electron_and_git_status() {
    node node_modules/electron/install.js && ./scripts/check_git_status.sh
}

changed_lint() {
    git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null \
        || { echo "Base ref ${BASE_REF} not found; git fetch origin master or pass --base." >&2; return 2; }
    # --no-bail: lint otherwise stops at the first failing package and hides later errors.
    npx lerna run lint --since "$BASE_REF" --include-dependents --no-bail
}

changed_tests() {
    git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null \
        || { echo "Base ref ${BASE_REF} not found; git fetch origin master or pass --base." >&2; return 2; }
    # Same scope and concurrency as `npm run test:theia`, restricted to changed packages + dependents.
    npx lerna run test --scope "@theia/!(example-)*" --since "$BASE_REF" --include-dependents --stream --concurrency=1
}

full_lint() { npx lerna run lint --stream --concurrency 2; }

build_step() { npm run build && ./scripts/check_git_status.sh; }

mobile_bundle_guard() {
    node scripts/qaap-frontend-graph-report.js && node scripts/qaap-mobile-bundle-guard.js
}

install_chromium() { cd examples/playwright && npx playwright install chromium; }

# Mirrors qaap-guards.yml "Required mobile E2E smoke (unfiltered)": mock QAIQ on PATH + same env.
required_mobile_e2e() {
    local mock_bin
    mock_bin="$(mktemp -d "${TMPDIR:-/tmp}/qaap-preflight-mock-qaiq.XXXXXX")" || return 1
    ln -sf "$ROOT/examples/playwright/scripts/mock-qaiq-rioja-agent" "$mock_bin/qaiq"
    export PATH="$mock_bin:$PATH"
    export QAAP_SKIP_AUTH=true OPENROUTER_API_KEY=mock-rioja-e2e QAAP_CLOUD_MODE=local FRONTEND_CONNECTION_TIMEOUT=2700000
    cd examples/playwright && npx playwright test --config=./configs/playwright.qaap-mobile-required.config.ts
}

headless_tests() { npm run rebuild:browser && npm run test:theia; }

browser_tests() { QAAP_SKIP_AUTH=true npm run test:browser; }

# Mirrors playwright.yml (invariants 2 and 3).
upstream_playwright() {
    (cd examples/playwright && npm run build) || return 1
    cd examples/playwright \
        && QAAP_SKIP_AUTH=true QAAP_CLOUD_MODE=local QAAP_PLAYWRIGHT_SURFACE=ide \
            npx playwright test --config=./configs/playwright.qaap-upstream-ci.config.ts
}

# Mirrors production-smoke-test.yml.
production_smoke() {
    (cd examples/browser && npm run build:production) || return 1
    (cd examples/playwright && npm run build) || return 1
    QAAP_SKIP_AUTH=true QAAP_CLOUD_MODE=local npm run test:playwright -- theia-app
}

# ---- run ---------------------------------------------------------------------------------------
echo "[preflight] mode=${MODE} install=${INSTALL} base=${BASE_REF} node=$(node -v 2>/dev/null) host=${OS_NAME}"
if [ -f .env ]; then
    echo "[preflight] WARNING: ./.env exists. Nx loads it into every 'lerna run', so lint/test here can see"
    echo "            env vars (QAAP_BETA_ALLOWED_LOGINS, NODE_ENV, QAAP_CLOUD_MODE, ...) that CI does not."
    echo "            A spec that passes only because of .env will fail in CI (doc/qaap-ci-invariants.md, 10)."
fi
echo "[preflight] No step needs CI-only secrets: CI passes GITHUB_TOKEN only to avoid GitHub API rate"
echo "            limits (ripgrep, plugins); export GITHUB_TOKEN yourself if downloads get rate-limited."

# qaap-guards.yml, pre-install part (same order).
run_step "guards: fetch reviewed upstream base" fetch_upstream_base
run_step "guards: drift check" node scripts/qaap-drift-check.js
run_step "guards: legacy workflow cleanup regression" node --test scripts/qaap-legacy-workflows.test.js
run_step "guards: tenant backend isolation check regression" node --test scripts/qaap-tenant-backend-isolation-check.test.js
linux_only_step "guards: tenant host loopback guard regression" bash scripts/qaap-tenant-loopback-guard.test.sh
linux_only_step "guards: Dockerfile base image pin regression" bash scripts/qaap-dockerfile-base-pin-check.test.sh
run_step "guards: tenant image seed regression" bash scripts/qaap-vps-tenant-image.test.sh
run_step "guards: required mobile E2E workflow regression" node --test scripts/qaap-mobile-required-ci.test.js
run_step "guards: post-deploy agent smoke regression" node --test scripts/qaap-post-deploy-agent-smoke.test.mjs
run_step "guards: mobile bundle guard regression" node --test scripts/qaap-mobile-bundle-guard.test.js
run_step "guards: browser start script preview port regression" node --test scripts/qaap-start-browser.test.mjs
run_step "guards: endpoint ownership check" node scripts/qaap-endpoint-ownership-check.js

# qaap-drift-check.yml (the drift check itself already ran above).
run_step "drift: ts-nocheck ratchet" npm run -s qaap:ts-nocheck-check
run_step "drift: specs own their jsdom" node scripts/qaap-spec-jsdom-check.js
run_step "drift: drift guard failure modes" node --test scripts/qaap-drift-check.test.js
linux_only_step "drift: beta release gate decisions" bash scripts/qaap-launch-gate.test.sh
run_step "drift: release readiness payload validation" node --test scripts/qaap-release-config-check.test.js
run_step "drift: candidate image gate orchestration" bash scripts/qaap-image-smoke.test.sh
run_step "drift: post-deploy image cleanup retention" bash scripts/qaap-vps-image-prune.test.sh
run_step "drift: post-deploy user smoke behavior" bash scripts/qaap-vps-post-deploy-user-smoke.test.sh
if python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then
    run_step "drift: backup restore safety and integrity" python3 scripts/qaap-backup-restore-check.test.py
else
    skip_step "drift: backup restore safety and integrity" "needs python3 >= 3.12 (tarfile.data_filter)"
fi
linux_only_step "drift: backup publication and retention" bash scripts/qaap-vps-backup.test.sh
run_step "drift: runtime state migration safeguards" node --test scripts/qaap-persist-runtime-state.test.mjs scripts/qaap-runtime-state-copy.test.js

if [ "$INSTALL" = 1 ]; then
    run_step "install: npm ci (with retries)" bash scripts/qaap-npm-ci-retry.sh
    run_step "install: electron binary + clean git status" electron_and_git_status
else
    skip_step "install: npm ci" "reusing node_modules; pass --install"
fi

run_step "guards: package graph check" package_graph_step
run_step "guards: compile" compile_step

if [ "$MODE" = quick ]; then
    run_step "lint: changed packages + dependents (vs ${BASE_REF})" changed_lint
    run_step "test: changed packages + dependents (vs ${BASE_REF})" changed_tests
    print_summary
    exit 0
fi

# --full: Lint, then the Build and Test / qaap-guards bundle steps, then Playwright suites.
run_step "lint: all packages" full_lint
run_step "build: npm run build + clean git status" build_step
run_step "build: download plugins" npm run download:plugins -- --rate-limit 3
run_step "guards: mobile bundle guard" mobile_bundle_guard
run_step "guards: install Playwright Chromium" install_chromium
run_step "guards: required mobile E2E smoke" required_mobile_e2e
run_step "test: rebuild:browser + test:theia" headless_tests
run_step "test: test:browser" browser_tests
if [ "$UPSTREAM_PLAYWRIGHT" = 1 ]; then
    run_step "playwright: upstream suite (qaap-upstream-ci config)" upstream_playwright
else
    skip_step "playwright: upstream suite" "pass --with-upstream-playwright"
fi
# Last: build:production replaces the development bundle (run `npm run build:browser` afterwards).
run_step "smoke: production build + theia-app Playwright" production_smoke
echo "[preflight] Note: examples/browser now holds the production bundle; run 'npm run build:browser' for dev."
print_summary
exit 0
