#!/usr/bin/env bash
# Compares runc and runsc on the same host for a repository that a tenant would work on.
#
# Usage:
#   DOCKER_HOST=unix:///run/docker-tenants/proxy.sock scripts/qaap-runsc-benchmark.sh /path/to/repo
#
# Measured per runtime (REPS repetitions each, default 10):
#   install-cold   install from an empty package cache into an empty node_modules
#   install-warm   install again with the cache and lockfile in place
#   dev-start      time from `docker run -d` to the first HTTP 200 of the dev server
#   git-status     `git status` in the repository, mounted read-only
#
# Reports the median and p95 per metric and the median ratio runsc/runc. Thresholds:
#   install (cold and warm) ratio <= 1.6, dev-start ratio <= 1.3. The script exits 1 when a
# threshold fails, 2 on usage or environment errors. Nothing is written into the repository:
# the tenant copy and caches live in named volumes that are removed at the end.
#
# Environment:
#   DOCKER_HOST      daemon to benchmark against (the tenant daemon or proxy socket)
#   BENCH_IMAGE      image with node, npm and git (default node:22-bookworm)
#   BENCH_REPS       repetitions per runtime (default 10)
#   BENCH_PM         npm or pnpm (default npm)
#   BENCH_DEV_CMD    dev server command run in the repo copy (default "npm run dev -- --host 0.0.0.0 --port 5173")
#   BENCH_DEV_PORT   port the dev server listens on (default 5173)
#   BENCH_KEEP       set to 1 to keep the named volumes for inspection

set -euo pipefail

usage() {
    sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
}

[ "$#" -eq 1 ] || usage
REPO="$(cd "$1" 2>/dev/null && pwd)" || { echo "not a directory: $1" >&2; exit 2; }
[ -d "$REPO/.git" ] || [ -f "$REPO/.git" ] || { echo "not a git repository: $REPO" >&2; exit 2; }
[ -n "${DOCKER_HOST:-}" ] || { echo 'set DOCKER_HOST to the tenant daemon or proxy socket' >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo 'docker CLI not found' >&2; exit 2; }
command -v awk >/dev/null 2>&1 || { echo 'awk not found' >&2; exit 2; }

IMAGE="${BENCH_IMAGE:-node:22-bookworm}"
REPS="${BENCH_REPS:-10}"
PM="${BENCH_PM:-npm}"
DEV_CMD="${BENCH_DEV_CMD:-npm run dev -- --host 0.0.0.0 --port 5173}"
DEV_PORT="${BENCH_DEV_PORT:-5173}"
INSTALL_THRESHOLD='1.6'
DEV_THRESHOLD='1.3'
RUNTIMES=(runc runsc)
RUN_ID="qaapbench$$"
RESULTS="$(mktemp -d)"
trap 'cleanup' EXIT

cleanup() {
    docker ps -aq --filter "label=qaap.benchmark=$RUN_ID" | xargs -r docker rm -f >/dev/null 2>&1 || true
    if [ "${BENCH_KEEP:-0}" != 1 ]; then
        docker volume ls -q --filter "label=qaap.benchmark=$RUN_ID" | xargs -r docker volume rm -f >/dev/null 2>&1 || true
    fi
    rm -rf "$RESULTS"
}

# Milliseconds since epoch. macOS date lacks %N, so fall back to perl when needed.
now_ms() {
    if date +%s%3N 2>/dev/null | grep -q '^[0-9]\{13\}$'; then
        date +%s%3N
    else
        perl -MTime::HiRes=time -e 'printf "%d\n", time()*1000'
    fi
}

new_volume() {
    local name="$RUN_ID-$1-$RANDOM"
    docker volume create --label "qaap.benchmark=$RUN_ID" "$name" >/dev/null
    echo "$name"
}

# Copies the repository (without node_modules) into the container and installs.
install_cmd() {
    local install
    if [ "$PM" = pnpm ]; then
        install='corepack enable >/dev/null 2>&1 || true; pnpm install --frozen-lockfile --silent'
    else
        install='npm ci --no-audit --no-fund --silent'
    fi
    echo "mkdir -p /work && tar -C /src --exclude=node_modules --exclude=.git -cf - . | tar -C /work -xf - && cd /work && $install"
}

time_install() {
    local runtime="$1" mode="$2" rep="$3" cache start end rc
    cache="$(new_volume "cache-$runtime-$mode-$rep")"
    local runs_cache_volume="$cache"
    if [ "$mode" = warm ]; then
        # Warm: reuse the cache volume filled by the cold run of the same repetition.
        runs_cache_volume="$(cat "$RESULTS/cache-$runtime-$rep")"
    else
        echo "$cache" > "$RESULTS/cache-$runtime-$rep"
    fi
    start="$(now_ms)"
    set +e
    # The same volume is mounted at both package-manager caches, so npm and pnpm share one cold/warm state.
    docker run --rm --runtime "$runtime" --label "qaap.benchmark=$RUN_ID" \
        -v "$REPO:/src:ro" -v "$runs_cache_volume:/root/.npm" -v "$runs_cache_volume:/root/.local/share/pnpm" \
        -w /work "$IMAGE" sh -c "$(install_cmd)" >/dev/null 2>"$RESULTS/err-$runtime-$mode-$rep.log"
    rc=$?
    set -e
    end="$(now_ms)"
    if [ "$rc" -ne 0 ]; then
        echo "install ($mode) failed under $runtime, see $RESULTS/err-$runtime-$mode-$rep.log" >&2
        return 1
    fi
    echo $((end - start))
}

time_dev_start() {
    local runtime="$1" rep="$2" start name rc work cache
    name="$RUN_ID-dev-$runtime-$rep"
    work="$(new_volume "work-$runtime-$rep")"
    cache="$(cat "$RESULTS/cache-$runtime-$rep")"
    # Install happens first, untimed, into a named volume that the dev server then starts from.
    docker run --rm --runtime "$runtime" --label "qaap.benchmark=$RUN_ID" \
        -v "$REPO:/src:ro" -v "$work:/work" -v "$cache:/root/.npm" -w /work "$IMAGE" \
        sh -c "$(install_cmd)" >/dev/null 2>"$RESULTS/err-dev-$runtime-$rep.log" \
        || { echo "install before dev start failed under $runtime" >&2; return 1; }
    start="$(now_ms)"
    docker run -d --runtime "$runtime" --name "$name" --label "qaap.benchmark=$RUN_ID" \
        -v "$work:/work" -w /work "$IMAGE" sh -c "cd /work && $DEV_CMD" >/dev/null
    rc=0
    until docker exec "$name" sh -c "curl -fsS -o /dev/null http://127.0.0.1:$DEV_PORT/" >/dev/null 2>&1; do
        if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" != true ]; then
            rc=1
            break
        fi
        if [ $(( $(now_ms) - start )) -gt 900000 ]; then
            rc=1
            break
        fi
        sleep 0.2
    done
    local end
    end="$(now_ms)"
    docker rm -f "$name" >/dev/null 2>&1 || true
    if [ "$rc" -ne 0 ]; then
        echo "dev server did not answer under $runtime" >&2
        return 1
    fi
    echo $((end - start))
}

time_git_status() {
    local runtime="$1" start end
    start="$(now_ms)"
    docker run --rm --runtime "$runtime" --label "qaap.benchmark=$RUN_ID" \
        -v "$REPO:/repo:ro" -w /repo "$IMAGE" sh -c 'git -c safe.directory=/repo status --porcelain >/dev/null 2>&1 || true' >/dev/null
    end="$(now_ms)"
    echo $((end - start))
}

# Prints "median p95" of the numbers on stdin, one per line.
stats() {
    sort -n | awk '{ v[NR] = $1 } END {
        if (NR == 0) { print "NaN NaN"; exit }
        m = (NR % 2) ? v[(NR + 1) / 2] : (v[NR / 2] + v[NR / 2 + 1]) / 2
        idx = int(0.95 * NR + 0.999999); if (idx < 1) idx = 1; if (idx > NR) idx = NR
        printf "%.0f %.0f\n", m, v[idx]
    }'
}

echo "Benchmark: $REPO"
echo "Daemon: $DOCKER_HOST  image: $IMAGE  reps: $REPS  pm: $PM"
docker info --format '{{.Name}} runtimes={{range $k, $v := .Runtimes}}{{$k}} {{end}}default={{.DefaultRuntime}}' >/dev/null 2>&1 \
    || { echo 'cannot reach the Docker daemon at DOCKER_HOST' >&2; exit 2; }
for runtime in "${RUNTIMES[@]}"; do
    docker info --format '{{json .Runtimes}}' | grep -q "\"$runtime\"" \
        || { echo "runtime $runtime is not registered on $DOCKER_HOST" >&2; exit 2; }
done

declare -A FILES
for runtime in "${RUNTIMES[@]}"; do
    for metric in install-cold install-warm dev-start git-status; do
        FILES["$runtime-$metric"]="$RESULTS/$runtime-$metric.txt"
        : > "${FILES[$runtime-$metric]}"
    done
done

for rep in $(seq 1 "$REPS"); do
    for runtime in "${RUNTIMES[@]}"; do
        echo "rep $rep/$REPS $runtime" >&2
        time_install "$runtime" cold "$rep" >> "${FILES[$runtime-install-cold]}"
        time_install "$runtime" warm "$rep" >> "${FILES[$runtime-install-warm]}"
        time_dev_start "$runtime" "$rep" >> "${FILES[$runtime-dev-start]}"
        time_git_status "$runtime" >> "${FILES[$runtime-git-status]}"
    done
done

printf '\n%-12s %-14s %10s %10s\n' metric runtime median_ms p95_ms
declare -A MEDIAN
for metric in install-cold install-warm dev-start git-status; do
    for runtime in "${RUNTIMES[@]}"; do
        read -r median p95 < <(stats < "${FILES[$runtime-$metric]}")
        MEDIAN["$runtime-$metric"]="$median"
        printf '%-12s %-14s %10s %10s\n' "$metric" "$runtime" "$median" "$p95"
    done
done

echo
status=0
check_ratio() {
    local metric="$1" threshold="$2" runc runsc ratio verdict
    runc="${MEDIAN[runc-$metric]}"
    runsc="${MEDIAN[runsc-$metric]}"
    if [ "$runc" = NaN ] || [ "$runsc" = NaN ] || [ "$runc" = 0 ]; then
        printf '%-12s ratio n/a (no samples)  FAIL\n' "$metric"
        status=1
        return
    fi
    ratio="$(awk -v a="$runsc" -v b="$runc" 'BEGIN { printf "%.2f", a / b }')"
    verdict=PASS
    if awk -v r="$ratio" -v t="$threshold" 'BEGIN { exit !(r > t) }'; then
        verdict=FAIL
        status=1
    fi
    printf '%-12s ratio runsc/runc %s (threshold <= %s)  %s\n' "$metric" "$ratio" "$threshold" "$verdict"
}
check_ratio install-cold "$INSTALL_THRESHOLD"
check_ratio install-warm "$INSTALL_THRESHOLD"
check_ratio dev-start "$DEV_THRESHOLD"
printf '%-12s ratio runsc/runc %s (informational)\n' git-status \
    "$(awk -v a="${MEDIAN[runsc-git-status]}" -v b="${MEDIAN[runc-git-status]}" 'BEGIN { if (b > 0) printf "%.2f", a / b; else print "n/a" }')"

exit "$status"
