#!/usr/bin/env bash
# Answers one question: can tenant containers run under gVisor (runsc, systrap) on a ROOTLESS Docker
# daemon, with the flags the orchestrator really uses? If yes, no rootful daemon and no socket proxy
# are needed (see origin/claude/tenant-runsc-theia-homes for that heavier design).
#
# Safe on a host with live tenants: run it as the rootless user (not root). It starts a throwaway
# rootless daemon under a scratch directory and removes everything on exit. It never talks to the
# production socket, and never reads or writes ~/.config/docker, ~/.local/share/docker or /usr/local.
# It does use CPU, about 2 GB of disk and up to 1.5 GB of RAM for a few minutes.
#
# Usage: bash qaap-runsc-rootless-probe.sh
#   QAAP_PROBE_TMP      parent of the scratch directory (default: /tmp); keep it short, sockets live there
#   QAAP_RUNSC_TARBALL  local gvisor.tar.zstd to test instead of the pinned upstream release
#   QAAP_RUNSC_SHA512   required with QAAP_RUNSC_TARBALL: its expected SHA-512
#   QAAP_PROBE_MODE     "contract" (default) checks the tenant contract; "tune" and "tune2" measure runsc flags on
#                       real workloads and the pids limit, including a fork bomb capped at 1 CPU and 1 GB; "sec" checks
#                       what a sandbox can reach, with the host-loopback setting production uses
# Exit: 0 viable, 1 a critical check failed, 2 the probe itself could not run.
set -uo pipefail

RUNSC_RELEASE='20261102.0'
RUNSC_SHA512_X86_64='3c400f72be459b57b99b1c4f69be96bcd67eef3caf2078e595fc98e688b6b9a3af7802646b3dde7da8a9aba96d34f86be303e0430c7868ab2d13becdd403c0c1'
RUNSC_SHA512_AARCH64='e829ca32eef36f4e960460a6dcb094d7945ab507e9bfe0275f09467ab9bfeb846528fddfd42349ad64bb4f5b02148e1065c06e573feb8f6a8b3f47efa30a7d2e'
BASE_IMAGE='node:22-alpine'
IMAGE='qaap-probe:latest'

CRITICAL_FAILS=0
WARNINGS=0
SCRATCH=''
DAEMON_PID=''

say() { printf '%s\n' "$*"; }
die() { say "PROBE ERROR: $*" >&2; exit 2; }
pass() { say "PASS  $1"; }
warn() { say "WARN  $1${2:+ :: $2}"; WARNINGS=$((WARNINGS + 1)); }
crit() { say "FAIL  $1${2:+ :: $2}"; CRITICAL_FAILS=$((CRITICAL_FAILS + 1)); }

cleanup() {
    local code=$?
    trap - EXIT INT TERM
    # The ssh session may be gone: keep cleaning up even though nothing can read the output.
    trap '' HUP PIPE
    say "--- cleanup"
    if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
        kill -TERM "$DAEMON_PID" 2>/dev/null
        for _ in $(seq 1 20); do kill -0 "$DAEMON_PID" 2>/dev/null || break; sleep 1; done
        kill -KILL "$DAEMON_PID" 2>/dev/null
    fi
    case "$SCRATCH" in
        */qrp.*)
            # Only processes whose command line names this scratch directory.
            pkill -KILL -f "$SCRATCH" 2>/dev/null
            sleep 1
            # Image layers belong to subuids, so removal has to happen inside a user namespace.
            if command -v rootlesskit >/dev/null 2>&1; then
                rootlesskit --state-dir="$SCRATCH.rm" rm -rf -- "$SCRATCH" >/dev/null 2>&1
                rm -rf -- "$SCRATCH.rm" 2>/dev/null
            fi
            rm -rf -- "$SCRATCH" 2>/dev/null
            if [ -e "$SCRATCH" ]; then
                say "WARNING: could not remove $SCRATCH; remove it by hand"
            else
                say "removed $SCRATCH"
            fi
            ;;
    esac
    exit "$code"
}
trap cleanup EXIT
trap 'exit 2' INT TERM HUP PIPE

# --- preflight
[ "$(id -u)" -ne 0 ] || die 'run as the rootless user, not root (for example: sudo -iu ubuntu bash <script>)'
# A rootless install from get.docker.com lives in ~/bin, absent from a short login PATH. HOME changes below.
export PATH="$PATH:$HOME/bin:/usr/local/bin:/usr/sbin:/sbin"
for tool in curl zstd tar sha512sum timeout docker dockerd dockerd-rootless.sh rootlesskit pkill; do
    command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
done
case "$(uname -m)" in
    x86_64) ARCH=x86_64; EXPECTED_SHA512=$RUNSC_SHA512_X86_64 ;;
    aarch64) ARCH=aarch64; EXPECTED_SHA512=$RUNSC_SHA512_AARCH64 ;;
    *) die "unsupported architecture: $(uname -m)" ;;
esac
PARENT="${QAAP_PROBE_TMP:-/tmp}"
FREE_KB="$(df --output=avail -k "$PARENT" | tail -1 | tr -d ' ')"
[ "$FREE_KB" -ge 3000000 ] || die "need 3 GB free in $PARENT, have $((FREE_KB / 1024)) MB"
AVAIL_MEM_KB="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
[ "$AVAIL_MEM_KB" -ge 1500000 ] || die "need 1.5 GB available RAM, have $((AVAIL_MEM_KB / 1024)) MB"

SCRATCH="$(mktemp -d "$PARENT/qrp.XXXXXX")" || die "cannot create a scratch directory in $PARENT"
chmod 0711 "$SCRATCH"
mkdir -p "$SCRATCH/run" "$SCRATCH/home" "$SCRATCH/data" "$SCRATCH/cli" "$SCRATCH/gvisor" "$SCRATCH/bind"
chmod 0700 "$SCRATCH/run"

say "=== host"
say "kernel=$(uname -r) arch=$ARCH user=$(id -un) uid=$(id -u) scratch=$SCRATCH"
say "cgroup=$(stat -fc %T /sys/fs/cgroup) controllers=[$(cat "/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/cgroup.controllers" 2>/dev/null)]"
say "docker=$(dockerd --version) rootlesskit=$(rootlesskit --version 2>/dev/null)"

# --- runsc, pinned and verified, inside the scratch directory only
TARBALL="$SCRATCH/gvisor.tar.zstd"
if [ -n "${QAAP_RUNSC_TARBALL:-}" ]; then
    [ -n "${QAAP_RUNSC_SHA512:-}" ] || die 'QAAP_RUNSC_TARBALL needs QAAP_RUNSC_SHA512'
    say "=== runsc from $QAAP_RUNSC_TARBALL"
    cp -- "$QAAP_RUNSC_TARBALL" "$TARBALL" || die 'could not read QAAP_RUNSC_TARBALL'
    EXPECTED_SHA512=$QAAP_RUNSC_SHA512
else
    say "=== runsc $RUNSC_RELEASE"
    timeout 300 curl -fsSL --proto '=https' --tlsv1.2 -o "$TARBALL" \
        "https://storage.googleapis.com/gvisor/releases/release/$RUNSC_RELEASE/$ARCH/gvisor.tar.zstd" \
        || die 'could not download gVisor'
fi
[ "$(sha512sum "$TARBALL" | awk '{print $1}')" = "$EXPECTED_SHA512" ] || die 'gVisor SHA-512 mismatch'
tar --zstd --no-same-owner -xf "$TARBALL" -C "$SCRATCH/gvisor" || die 'could not unpack gVisor'
rm -f "$TARBALL"
RUNSC="$SCRATCH/gvisor/runsc"
[ -x "$RUNSC" ] || die 'the tarball has no runsc at its root'
"$RUNSC" --version | head -2

# --- throwaway rootless daemon. systemd cgroups are tried first because production uses a user bus.
cat > "$SCRATCH/daemon.json" <<EOF
{
  "default-runtime": "runc",
  "runtimes": {
    "runsc-systemd": { "path": "$RUNSC", "runtimeArgs": ["--platform=systrap", "--directfs=false", "--systemd-cgroup"] },
    "tune-directfs": { "path": "$RUNSC", "runtimeArgs": ["--platform=systrap", "--systemd-cgroup"] },
    "runsc-plain": { "path": "$RUNSC", "runtimeArgs": ["--platform=systrap"] },
    "runsc-nocgroups": { "path": "$RUNSC", "runtimeArgs": ["--platform=systrap", "--ignore-cgroups"] },
    "tune-dcache": { "path": "$RUNSC", "runtimeArgs": ["--platform=systrap", "--systemd-cgroup", "--dcache=65536"] },
    "tune-nodirectfs": { "path": "$RUNSC", "runtimeArgs": ["--platform=systrap", "--systemd-cgroup", "--directfs=false"] },
    "tune-exclusive": { "path": "$RUNSC", "runtimeArgs": ["--platform=systrap", "--systemd-cgroup", "--file-access-mounts=exclusive"] }
  }
}
EOF

export HOME="$SCRATCH/home"
export XDG_RUNTIME_DIR="$SCRATCH/run"
export DOCKER_CONFIG="$SCRATCH/cli"
unset DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
REAL_UID="$(id -u)"
USER_BUS="/run/user/$REAL_UID/bus"
if [ -S "$USER_BUS" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$USER_BUS"
    # The patched runsc falls back to $XDG_RUNTIME_DIR/bus when the shim drops the variable.
    ln -s "$USER_BUS" "$SCRATCH/run/bus"
fi
SOCK="$SCRATCH/run/d.sock"
export DOCKER_HOST="unix://$SOCK"

# Same network settings as the production unit (see `systemctl --user show docker -p Environment`).
export DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=builtin DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=false
say "=== starting the throwaway rootless daemon"
dockerd-rootless.sh --config-file "$SCRATCH/daemon.json" --data-root "$SCRATCH/data" \
    --exec-root "$SCRATCH/run/x" --pidfile "$SCRATCH/run/d.pid" --host "$DOCKER_HOST" \
    > "$SCRATCH/dockerd.log" 2>&1 &
DAEMON_PID=$!

dk() { timeout 180 docker "$@"; }
READY=0
for _ in $(seq 1 60); do
    if dk version >/dev/null 2>&1; then READY=1; break; fi
    kill -0 "$DAEMON_PID" 2>/dev/null || break
    sleep 1
done
if [ "$READY" != 1 ]; then
    tail -30 "$SCRATCH/dockerd.log" >&2
    die 'the throwaway rootless daemon did not start'
fi
say "driver=$(dk info -f '{{.Driver}}') cgroupDriver=$(dk info -f '{{.CgroupDriver}}') cgroupVersion=$(dk info -f '{{.CgroupVersion}}') security=$(dk info -f '{{.SecurityOptions}}')"

# Git and setpriv come from a runc container, so the image is ready before runsc is involved.
timeout 600 docker pull -q "$BASE_IMAGE" >/dev/null || die "could not pull $BASE_IMAGE"
timeout 300 docker run --name qrp-base "$BASE_IMAGE" apk add --no-cache git setpriv >/dev/null 2>&1 \
    || die 'could not prepare the probe image (runc egress on the throwaway daemon failed)'
dk commit qrp-base "$IMAGE" >/dev/null || die 'could not commit the probe image'
dk rm -f qrp-base >/dev/null

# The tenant contract, from qaap-docker-orchestrator.ts.
HARD=(--init --cap-drop ALL --security-opt no-new-privileges:true --read-only --tmpfs /tmp --cpus 1)

# Allocates up to 1 GiB of touched memory and prints the last size reached.
ALLOC_JS='let t=0;const a=[];for(;t<1024;t+=64){a.push(Buffer.alloc(64<<20,1));console.log(t+64)}'

# Seconds a command takes, or "failed".
measure() {
    local start end
    start="$(date +%s.%N)"
    "$@" >/dev/null 2>&1 || { echo failed; return; }
    end="$(date +%s.%N)"
    awk -v a="$start" -v b="$end" 'BEGIN { printf "%.2f", b - a }'
}

# The systemd scope of a running container, seen from outside the daemon.
scope_of() {
    find "/sys/fs/cgroup/user.slice/user-$REAL_UID.slice/user@$REAL_UID.service" -type d -name "*$1*.scope" 2>/dev/null | head -1
}
scope_value() {
    local scope
    scope="$(scope_of "$1")"
    if [ -n "$scope" ]; then cat "$scope/$2" 2>/dev/null; else echo '?'; fi
}

run_tune() {
    local variant id count state i
    local NPM='cd /w && mkdir -p n$$ && cd n$$ && npm init -y >/dev/null && npm install --no-audit --no-fund vite react react-dom typescript >/dev/null'
    local WORK=(--cpus 2 --memory 4g -e HOME=/tmp -v "$SCRATCH/bind:/w:rw" "$IMAGE")
    say "=== workloads (seconds): files=2000 small files, npm=install, tsc=compile against installed types, git=add+commit+status, find=walk the image"
    for variant in runc runsc-systemd tune-dcache tune-nodirectfs tune-exclusive; do
        local files npm tsc git find
        local FILES='cd /w && mkdir -p b$$ && cd b$$ && i=0; while [ $i -lt 2000 ]; do echo $i > f$i; i=$((i+1)); done; cat f* > /dev/null; rm -rf /w/b$$'
        files="$(measure dk run --rm --runtime "$variant" "${WORK[@]}" sh -c "$FILES")"
        npm="$(measure dk run --rm --runtime "$variant" "${WORK[@]}" sh -c "$NPM")"
        # The tree npm just wrote, read back by the same runtime.
        local TREE
        TREE="$(find "$SCRATCH/bind" -maxdepth 1 -type d -name 'n*' 2>/dev/null | head -1)"
        TREE="${TREE##*/}"
        if [ -n "$TREE" ]; then
            tsc="$(measure dk run --rm --runtime "$variant" "${WORK[@]}" sh -c "cd /w/$TREE && echo 'import * as R from \"react\"; export const v = R.version;' > a.ts; npm pkg set type=module >/dev/null; npm install --no-audit --no-fund @types/react >/dev/null; node node_modules/typescript/bin/tsc --noEmit --skipLibCheck false --module esnext --moduleResolution bundler a.ts; true")"
            git="$(measure dk run --rm --runtime "$variant" "${WORK[@]}" sh -c "cd /w/$TREE && git init -q . && git config user.email p@p && git config user.name p && git add -A && git commit -qm c && git status --porcelain >/dev/null")"
            dk run --rm "${WORK[@]}" rm -rf "/w/$TREE" >/dev/null 2>&1
        else
            tsc=failed; git=failed
        fi
        find="$(measure dk run --rm --runtime "$variant" "$IMAGE" sh -c 'find /usr -type f | wc -l')"
        say "$variant: files=$files npm=$npm tsc=$tsc git=$git find=$find"
    done

    say '=== reload: SIGHUP adds a runtime to a daemon that has a live container'
    id="$(dk run -d --runtime runsc-systemd --memory 1g "$IMAGE" sleep 300)"
    python3 -c "import json,sys; p,r=sys.argv[1:3]; c=json.load(open(p)); c['runtimes']['reloaded']={'path':r,'runtimeArgs':['--platform=systrap','--systemd-cgroup']}; json.dump(c,open(p,'w'))" "$SCRATCH/daemon.json" "$RUNSC"
    kill -HUP "$DAEMON_PID"
    sleep 4
    state="$(dk inspect -f '{{.State.Status}} started={{.State.StartedAt}}' "$id" 2>&1)"
    if kill -0 "$DAEMON_PID" 2>/dev/null && dk info -f '{{json .Runtimes}}' | grep -q reloaded \
        && [ "$(dk run --rm --runtime reloaded "$IMAGE" echo ok 2>&1)" = ok ] && [ "$(dk exec "$id" echo alive 2>&1)" = alive ]; then
        say "reload OK: daemon alive, new runtime works, live container kept: $state"
    else
        say "reload FAILED: $state; daemon log: $(grep -iE 'reload|error' "$SCRATCH/dockerd.log" | tail -3 | cut -c1-200)"
    fi
    dk rm -f "$id" >/dev/null

    say '=== sandbox overhead at rest under runsc-systemd'
    id="$(dk run -d --runtime runsc-systemd --pids-limit 256 --memory 1g "$IMAGE" sleep 300)"
    sleep 4
    say "idle: pids.current=$(scope_value "$id" pids.current) memory.current=$(scope_value "$id" memory.current) pids.max=$(scope_value "$id" pids.max) memory.max=$(scope_value "$id" memory.max) swap.max=$(scope_value "$id" memory.swap.max)"
    dk rm -f "$id" >/dev/null

    say '=== pids.max=256: guest sleeps started, guest processes seen, host tasks charged, whether the sandbox survived'
    for count in 50 100 200 400; do
        id="$(dk run -d --runtime runsc-systemd --pids-limit 256 --memory 2g "$IMAGE" sh -c "i=0; while [ \$i -lt $count ]; do sleep 40 & i=\$((i+1)); done 2>/dev/null; sleep 45")"
        sleep 12
        state="$(dk inspect -f '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' "$id")"
        say "$count sleeps: guest=$(dk exec "$id" sh -c 'ps -o pid= | wc -l' 2>&1 | tail -1 | cut -c1-60) host-tasks=$(scope_value "$id" pids.current) peak=$(scope_value "$id" pids.peak) events=[$(scope_value "$id" pids.events | tr '\n' ' ')] state=$state"
        dk rm -f "$id" >/dev/null
    done

    say '=== threads: a Node process in the sandbox, as a real backend would use them'
    id="$(dk run -d --runtime runsc-systemd --pids-limit 256 --memory 2g "$IMAGE" node -e "const {Worker}=require('worker_threads');for(let i=0;i<40;i++)new Worker('setInterval(()=>{},1000)',{eval:true});setInterval(()=>{},1000)")"
    sleep 10
    say "40 workers: host-tasks=$(scope_value "$id" pids.current) state=$(dk inspect -f '{{.State.Status}} exit={{.State.ExitCode}}' "$id")"
    dk rm -f "$id" >/dev/null

    say '=== fork bomb: 1 CPU, 1 GB, pids.max=256, stopped after 30 s'
    say "host before: load=$(cut -d' ' -f1 /proc/loadavg) tasks=$(cut -d' ' -f4 /proc/loadavg)"
    id="$(dk run -d --runtime runsc-systemd --cpus 1 --memory 1g --pids-limit 256 "$IMAGE" sh -c 'f() { f | f & }; f; sleep 60')"
    for i in 1 2 3; do
        sleep 10
        say "t=$((i * 10))s: host-tasks=$(scope_value "$id" pids.current) memory=$(scope_value "$id" memory.current) events=[$(scope_value "$id" pids.events | tr '\n' ' ')] state=$(dk inspect -f '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' "$id") host-load=$(cut -d' ' -f1 /proc/loadavg) host-tasks-total=$(cut -d' ' -f4 /proc/loadavg)"
    done
    dk rm -f "$id" >/dev/null 2>&1
    sleep 3
    say "host after: load=$(cut -d' ' -f1 /proc/loadavg) tasks=$(cut -d' ' -f4 /proc/loadavg) leftover-scopes=$(find "/sys/fs/cgroup/user.slice/user-$REAL_UID.slice/user@$REAL_UID.service" -type d -name "*$id*" 2>/dev/null | wc -l)"
}

# npm install, tsc and git on one bind tree, under one runtime and CPU quota.
cost_row() {
    local label=$1 runtime=$2 cpus=$3 npm tsc git
    local WORK=(--cpus "$cpus" --memory 4g -e HOME=/tmp -v "$SCRATCH/bind:/w:rw" "$IMAGE")
    dk run --rm "${WORK[@]}" rm -rf /w/t >/dev/null 2>&1
    npm="$(measure dk run --rm --runtime "$runtime" "${WORK[@]}" sh -c 'mkdir -p /w/t && cd /w/t && npm init -y >/dev/null && npm install --no-audit --no-fund vite react react-dom typescript @types/react >/dev/null')"
    tsc="$(measure dk run --rm --runtime "$runtime" "${WORK[@]}" sh -c "cd /w/t && echo 'import * as R from \"react\"; export const v = R.version;' > a.ts; node node_modules/typescript/bin/tsc --noEmit --skipLibCheck false --module esnext --moduleResolution bundler a.ts; true")"
    git="$(measure dk run --rm --runtime "$runtime" "${WORK[@]}" sh -c 'cd /w/t && rm -rf .git; git init -q . && git config user.email p@p && git config user.name p && git add -A && git commit -qm c && git status --porcelain >/dev/null')"
    say "$label: npm=$npm tsc=$tsc git=$git"
}

# Starts many sleeps under one limit and reports what the guest and the host saw.
pids_row() {
    local label=$1 count=$2 limit=$3
    shift 3
    local id
    id="$(dk run -d --runtime runsc-systemd --pids-limit "$limit" --memory 2g "$@" "$IMAGE" sh -c "i=0; f=0; while [ \$i -lt $count ]; do sleep 40 & [ \$? -eq 0 ] || f=\$((f+1)); i=\$((i+1)); done 2>/dev/null; sleep 45")"
    sleep 12
    say "$label: guest=$(dk exec "$id" sh -c 'ps -o pid= | wc -l' 2>&1 | tail -1 | cut -c1-40) host-tasks=$(scope_value "$id" pids.current) limit=$(scope_value "$id" pids.max) state=$(dk inspect -f '{{.State.Status}} exit={{.State.ExitCode}}' "$id")"
    dk rm -f "$id" >/dev/null
}

run_tune2() {
    say '=== cost by CPU quota (seconds; the runsc sentry and gofer share the quota with the app)'
    cost_row 'runc cpus=2' runc 2
    cost_row 'runsc cpus=2' runsc-systemd 2
    cost_row 'runsc cpus=3' runsc-systemd 3
    cost_row 'runsc cpus=4' runsc-systemd 4
    cost_row 'runsc cpus=8' runsc-systemd 8
    cost_row 'runc cpus=8' runc 8

    say '=== pids: how many guest processes a limit carries'
    pids_row '200 sleeps, limit 1024' 200 1024
    pids_row '400 sleeps, limit 1024' 400 1024
    pids_row '500 sleeps, limit 1024' 500 1024
    say '=== nproc: does RLIMIT_NPROC stop the guest before the host limit kills the sandbox?'
    pids_row '200 sleeps, limit 256, nproc 80' 200 256 --ulimit nproc=80:80
    pids_row '200 sleeps, limit 256, nproc 80, uid 1001' 200 256 --ulimit nproc=80:80 --user 1001:1001

    say '=== fork bomb under limit 1024 and nproc 300, uid 1001: stays alive and stops growing?'
    local id i
    id="$(dk run -d --runtime runsc-systemd --cpus 1 --memory 1g --pids-limit 1024 --ulimit nproc=300:300 --user 1001:1001 "$IMAGE" sh -c 'f() { f | f & }; f; sleep 60')"
    for i in 1 2 3; do
        sleep 10
        say "t=$((i * 10))s: host-tasks=$(scope_value "$id" pids.current) memory=$(scope_value "$id" memory.current) state=$(dk inspect -f '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' "$id") host-load=$(cut -d' ' -f1 /proc/loadavg)"
    done
    dk rm -f "$id" >/dev/null 2>&1
    say "host after: load=$(cut -d' ' -f1 /proc/loadavg) tasks=$(cut -d' ' -f4 /proc/loadavg)"
}

# What the host sees of one sandbox's processes.
sandbox_identity() {
    local id=$1 label pid
    for label in runsc-sandbox runsc-gofer; do
        pid="$(pgrep -f "$label.*$id" | head -1)"
        if [ -z "$pid" ]; then
            say "  $label: not found"
            continue
        fi
        say "  $label: host-uid=$(awk '/^Uid:/ {print $3}' "/proc/$pid/status") CapEff=$(awk '/^CapEff:/ {print $2}' "/proc/$pid/status") NoNewPrivs=$(awk '/^NoNewPrivs:/ {print $2}' "/proc/$pid/status") Seccomp=$(awk '/^Seccomp:/ {print $2}' "/proc/$pid/status") uid_map=[$(tr -s ' ' < "/proc/$pid/uid_map" | tr '\n' ';')] can-read-docker-sock=$([ -r "/proc/$pid/root/run/user/$REAL_UID/docker.sock" ] && echo yes || echo no)"
    done
}

# One TCP connection attempt from one runtime, reported as open or closed.
reach() {
    local runtime=$1 network=$2 address=$3 port=$4
    if dk run --rm --runtime "$runtime" --network "$network" --user 1001:1001 "$IMAGE" nc -z -w 4 "$address" "$port" >/dev/null 2>&1; then echo OPEN; else echo closed; fi
}

run_sec() {
    local id gateway relay_port runtime r out
    say '=== A2: task limits around the tenants'
    say "user@$REAL_UID TasksMax=$(systemctl --user show -p TasksMax --value 2>/dev/null) user-slice-TasksMax=$(systemctl show "user-$REAL_UID.slice" -p TasksMax --value 2>/dev/null) service-TasksMax=$(systemctl show "user@$REAL_UID.service" -p TasksMax --value 2>/dev/null) threads-max=$(cat /proc/sys/kernel/threads-max) pid_max=$(cat /proc/sys/kernel/pid_max) tasks-now=$(cat "/sys/fs/cgroup/user.slice/user-$REAL_UID.slice/user@$REAL_UID.service/pids.current" 2>/dev/null)"

    say '=== M1: identity of the sandbox processes on the host, with and without directfs'
    for runtime in runsc-systemd tune-nodirectfs; do
        id="$(dk run -d --runtime "$runtime" "${HARD[@]}" --memory 512m "$IMAGE" sleep 60)"
        sleep 2
        say "$runtime:"
        sandbox_identity "$id"
        dk rm -f "$id" >/dev/null
    done

    say '=== cost of giving up directfs (seconds, nothing else running)'
    cost_row 'runc' runc 2
    cost_row 'runsc' runsc-systemd 2
    cost_row 'runsc --directfs=false' tune-nodirectfs 2

    say '=== inside a sandbox, as the agent uid, next to a root process holding a secret'
    out="$(dk run --rm --runtime runsc-systemd "${HARD[@]}" --tmpfs /work:rw,noexec,nosuid,nodev --cap-add SETUID --cap-add SETGID -e PROBE_SECRET=hunter2 "$IMAGE" sh -c '
        setpriv --reuid=1001 --regid=1001 --clear-groups sh -c "
            id -u
            cat /proc/1/environ 2>/dev/null | grep -c PROBE_SECRET
            touch /x 2>/dev/null && echo root-writable || echo root-readonly
            cp /bin/busybox /tmp/b 2>/dev/null; /tmp/b true 2>/dev/null && echo tmp-exec-allowed || echo tmp-exec-denied
            dmesg 2>/dev/null | grep -ci gvisor
            ls /run/user 2>/dev/null | wc -l
            ls /var/run/docker.sock 2>/dev/null | wc -l
        "' 2>&1 | tr '\n' ' ')"
    say "uid, environ-matches, root, /tmp, dmesg-gvisor, /run/user entries, docker.sock: $out"
    out="$(dk run --rm --runtime runsc-systemd "${HARD[@]}" --user 1001:1001 -v "$SCRATCH/bind:/w:rw" "$IMAGE" sh -c 'touch /w/agent-file 2>&1 && echo wrote || echo denied' 2>&1 | tail -1)"
    say "agent uid on a bind owned by the tenant root: $out"

    say '=== M2 and M3: what a tenant reaches, by address, with production host-loopback settings'
    dk network create --internal qrp-int >/dev/null
    dk network create --internal qrp-other >/dev/null
    gateway="$(dk network inspect -f '{{(index .IPAM.Config 0).Gateway}}' qrp-int)"
    # Stands in for another tenant's relay: runc, publishing a port, on its own network.
    relay_port=18998
    id="$(dk run -d --network qrp-other -p "127.0.0.1:$relay_port:4873" "$IMAGE" node -e "require('http').createServer((_,r)=>r.end('x')).listen(4873,'0.0.0.0')")"
    sleep 3
    say "published relay from the host: $(curl -s -m 4 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$relay_port/" 2>/dev/null) (000 can be the loopback guard, which applies to this uid)"
    for runtime in runc runsc-systemd; do
        say "$runtime, internal network:"
        say "  host loopback 10.0.2.2:4873=$(reach "$runtime" qrp-int 10.0.2.2 4873) :14873=$(reach "$runtime" qrp-int 10.0.2.2 14873) :22=$(reach "$runtime" qrp-int 10.0.2.2 22)"
        say "  gateway $gateway relay:$relay_port=$(reach "$runtime" qrp-int "$gateway" "$relay_port") public 1.1.1.1:443=$(reach "$runtime" qrp-int 1.1.1.1 443)"
        say "  host address $(hostname -I | cut -d' ' -f1):22=$(reach "$runtime" qrp-int "$(hostname -I | cut -d' ' -f1)" 22)"
    done
    dk rm -f "$id" >/dev/null

    say '=== M10: pause and resume'
    id="$(dk run -d --runtime runsc-systemd --memory 512m "$IMAGE" node -e "setInterval(()=>{for(let i=0;i<1e6;i++);},10)")"
    sleep 4
    local scope before after
    scope="$(scope_of "$id")"
    dk pause "$id" >/dev/null 2>&1; r=$?
    sleep 1
    before="$(awk '/^usage_usec/ {print $2}' "$scope/cpu.stat" 2>/dev/null)"
    sleep 3
    after="$(awk '/^usage_usec/ {print $2}' "$scope/cpu.stat" 2>/dev/null)"
    say "pause rc=$r status=$(dk inspect -f '{{.State.Status}}' "$id") cpu-usec-while-paused=$((after - before))"
    dk unpause "$id" >/dev/null 2>&1; r=$?
    sleep 2
    say "unpause rc=$r status=$(dk inspect -f '{{.State.Status}}' "$id") exec=$(dk exec "$id" echo alive 2>&1 | cut -c1-40)"
    dk rm -f "$id" >/dev/null

    say '=== M10: OOM, restart policy and the systemd scope (--memory-swap equal to --memory, so it really dies)'
    id="$(dk run -d --runtime runsc-systemd --memory 128m --memory-swap 128m --restart on-failure:3 "$IMAGE" node -e "$ALLOC_JS")"
    sleep 30
    say "state=$(dk inspect -f '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' "$id")"
    say "failed units for this container: $(systemctl --user list-units --state=failed --plain --no-legend 2>/dev/null | grep -c "$id")"
    say "swap accounting for a default --memory 256m: $(id2="$(dk run -d --runtime runsc-systemd --memory 256m "$IMAGE" sleep 20)"; sleep 2; echo "max=$(scope_value "$id2" memory.max) swap=$(scope_value "$id2" memory.swap.max)"; dk rm -f "$id2" >/dev/null)"
    dk rm -f "$id" >/dev/null 2>&1
    say "leftover scopes: $(find "/sys/fs/cgroup/user.slice/user-$REAL_UID.slice/user@$REAL_UID.service" -type d -name "*$id*" 2>/dev/null | wc -l)"
}

if [ "${QAAP_PROBE_MODE:-contract}" = sec ]; then
    run_sec
    say 'TUNE DONE. Production was not touched.'
    exit 0
fi

if [ "${QAAP_PROBE_MODE:-contract}" = tune2 ]; then
    run_tune2
    say 'TUNE DONE. Production was not touched.'
    exit 0
fi

if [ "${QAAP_PROBE_MODE:-contract}" = tune ]; then
    run_tune
    say 'TUNE DONE. Production was not touched.'
    exit 0
fi

# --- choose the runsc flags: it must boot, and the memory limit must really stop an allocation.
say "=== runtime variants"
RUNTIME=''
BOOT_ONLY=''
for variant in runsc-systemd runsc-plain runsc-nocgroups; do
    out="$(dk run --rm --runtime "$variant" "${HARD[@]}" --memory 256m "$IMAGE" uname -r 2>&1)"
    if [ $? -ne 0 ] || [ "$out" = "$(uname -r)" ]; then
        say "$variant: does not boot :: $(printf '%s' "$out" | grep -v 'docker run --help' | tail -2 | tr '\n' ' ' | cut -c1-400)"
        continue
    fi
    [ -n "$BOOT_ONLY" ] || BOOT_ONLY=$variant
    reached="$(dk run --rm --runtime "$variant" "${HARD[@]}" --memory 256m "$IMAGE" node -e "$ALLOC_JS" 2>/dev/null | tail -1)"
    say "$variant: boots, guest kernel=$out, allocated ${reached:-0} MiB of 1024 under a 256 MiB limit"
    if [ "${reached:-0}" -lt 1024 ]; then
        RUNTIME=$variant
        break
    fi
done
if [ -z "$RUNTIME" ]; then
    if [ -z "$BOOT_ONLY" ]; then
        crit 'runsc boots on the rootless daemon' 'no variant started'
        say '--- daemon log (errors)'
        grep -iE 'error|fail' "$SCRATCH/dockerd.log" | tail -15 | cut -c1-300
        say 'VERDICT: NOT VIABLE on rootless (runsc does not start)'
        exit 1
    fi
    RUNTIME=$BOOT_ONLY
    crit 'memory limit is enforced' "no variant stopped the allocation; continuing with $RUNTIME"
else
    pass "memory limit is enforced ($RUNTIME)"
fi
pass "runsc boots on the rootless daemon ($RUNTIME, systrap)"
RS=(--runtime "$RUNTIME")

# --- tenant contract
say "=== tenant contract on $RUNTIME"

# PIDs: guest tasks are not necessarily host processes, so this limit may not bind under gVisor.
out="$(dk run --rm "${RS[@]}" "${HARD[@]}" --pids-limit 64 "$IMAGE" sh -c \
    'i=0; while [ $i -lt 200 ]; do sleep 20 & i=$((i+1)); done 2>/dev/null; ps -o pid= | wc -l' 2>/dev/null | tail -1)"
if [ "${out:-999}" -lt 100 ]; then pass "pids limit is enforced ($out of 200 under 64)"; else warn 'pids limit is enforced' "${out:-no output} processes under a limit of 64"; fi

# Credential drop used by the backend for every agent child.
out="$(dk run --rm "${RS[@]}" "${HARD[@]}" --cap-add SETUID --cap-add SETGID "$IMAGE" \
    setpriv --reuid=1001 --regid=1001 --clear-groups sh -c 'id -u; touch /etc/x 2>/dev/null && echo WROTE' 2>&1)"
if [ "$out" = 1001 ]; then pass 'setpriv drops to uid 1001 under no-new-privileges'; else crit 'setpriv drops to uid 1001' "$out"; fi

# Bind mounts: uid 0 inside must own files as the rootless user outside, and be able to read them back.
printf 'from-host' > "$SCRATCH/bind/host.txt"
out="$(dk run --rm "${RS[@]}" "${HARD[@]}" -v "$SCRATCH/bind:/w:rw" "$IMAGE" sh -c 'cat /w/host.txt && echo x > /w/from-guest' 2>&1)"
if [ "$out" = from-host ] && [ "$(stat -c %u "$SCRATCH/bind/from-guest" 2>/dev/null)" = "$(id -u)" ]; then
    pass 'bind mount reads and writes with the rootless uid mapping'
else
    crit 'bind mount uid mapping' "out=$out owner=$(stat -c %u "$SCRATCH/bind/from-guest" 2>&1)"
fi

# Real workload on the bind mount: git and SQLite WAL with synchronous=FULL (qaap-persistence).
out="$(dk run --rm "${RS[@]}" "${HARD[@]}" -v "$SCRATCH/bind:/w:rw" -e HOME=/tmp -w /w "$IMAGE" sh -c '
    git init -q r && cd r && git config user.email p@p && git config user.name p &&
    i=0; while [ $i -lt 500 ]; do echo $i > f$i; i=$((i+1)); done &&
    git add . && git commit -qm c && git status --porcelain | wc -l' 2>&1 | tail -1)"
if [ "$out" = 0 ]; then pass 'git init, add, commit on the bind mount'; else crit 'git on the bind mount' "$out"; fi

SQL_JS="const {DatabaseSync:D}=require('node:sqlite');const d=new D('/w/p.db');d.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;CREATE TABLE IF NOT EXISTS t(v);');for(let i=0;i<200;i++)d.exec('INSERT INTO t VALUES(1)');const o=new D('/w/p.db');console.log(d.prepare('PRAGMA journal_mode').get().journal_mode,o.prepare('SELECT count(*) c FROM t').get().c)"
out="$(dk run --rm "${RS[@]}" "${HARD[@]}" -v "$SCRATCH/bind:/w:rw" "$IMAGE" node --no-warnings -e "$SQL_JS" 2>&1 | tail -1)"
if [ "$out" = 'wal 200' ]; then pass 'node:sqlite WAL on the bind mount, two connections'; else crit 'node:sqlite WAL on the bind mount' "$out"; fi

# Dev servers rely on inotify for changes made from inside the container.
out="$(dk run --rm "${RS[@]}" "${HARD[@]}" -v "$SCRATCH/bind:/w:rw" "$IMAGE" node -e \
    "const f=require('fs');const t=setTimeout(()=>{console.log('none');process.exit()},5000);f.watch('/w',()=>{console.log('event');clearTimeout(t);process.exit()});setTimeout(()=>f.writeFileSync('/w/w.txt','x'),300)" 2>&1 | tail -1)"
if [ "$out" = event ]; then pass 'inotify sees changes made in the container'; else warn 'inotify sees changes made in the container' "$out"; fi

# --- networks: DNS (gVisor FAQ, issue 7469), relay on runc to backend on runsc, isolation, egress.
say "=== networks"
dk network create --internal qrp-int >/dev/null || die 'could not create the internal network'
dk network create qrp-ext >/dev/null || die 'could not create the egress network'
SERVE_JS="require('http').createServer((_,r)=>r.end('qaap-ok')).listen(4873,'0.0.0.0')"
dk run -d --name qrp-srv "${RS[@]}" "${HARD[@]}" --network qrp-int --network-alias backend "$IMAGE" node -e "$SERVE_JS" >/dev/null
sleep 3
FETCH='wget -qO- -T 8 http://backend:4873/'
out="$(dk run --rm --network qrp-int "$IMAGE" $FETCH 2>&1)"
if [ "$out" = qaap-ok ]; then pass 'runc container reaches a runsc backend by DNS alias (relay path)'; else crit 'runc to runsc on the internal network' "$out"; fi
out="$(dk run --rm "${RS[@]}" --network qrp-int "$IMAGE" $FETCH 2>&1)"
if [ "$out" = qaap-ok ]; then pass 'runsc container resolves a DNS alias on a user bridge'; else warn 'embedded DNS from runsc (gVisor issue 7469)' "$out"; fi

# The workaround the orchestrator would use: a known address in /etc/hosts instead of embedded DNS.
SRV_IP="$(dk inspect -f '{{(index .NetworkSettings.Networks "qrp-int").IPAddress}}' qrp-srv)"
out="$(dk run --rm "${RS[@]}" --network qrp-int --add-host "backend:$SRV_IP" "$IMAGE" $FETCH 2>&1)"
if [ "$out" = qaap-ok ]; then pass 'runsc reaches the backend by --add-host name'; else crit 'runsc to the backend by --add-host name' "$out"; fi

# The positive control: unless this connects, a "closed" below says nothing about the network.
if [ "$(reach "$RUNTIME" qrp-int "$SRV_IP" 4873)" = OPEN ]; then
    pass 'positive control: the agent uid connects to the backend by address'
else
    crit 'positive control: the agent uid connects to the backend by address' 'nc cannot connect, so the isolation checks below prove nothing'
fi
say "identity of a sandbox on the host:"
sandbox_identity "$(dk inspect -f '{{.Id}}' qrp-srv)"

# Another tenant's relay: runc, on its own network, publishing a port. Only the published side is reachable by design.
dk network create --internal qrp-other >/dev/null
RELAY_ID="$(dk run -d --network qrp-other -p 127.0.0.1:18998:4873 "$IMAGE" node -e "$SERVE_JS")"
sleep 3
RELAY_IP="$(dk inspect -f '{{(index .NetworkSettings.Networks "qrp-other").IPAddress}}' "$RELAY_ID")"
GATEWAY="$(dk network inspect -f '{{(index .IPAM.Config 0).Gateway}}' qrp-int)"
if [ "$(dk run --rm --network qrp-other --user 1001:1001 "$IMAGE" nc -z -w 4 "$RELAY_IP" 4873 >/dev/null 2>&1 && echo OPEN)" = OPEN ]; then
    pass 'positive control: the relay listens on its own network'
else
    crit 'positive control: the relay listens on its own network'
fi
for target in "$RELAY_IP 4873 the other tenant's relay" "$GATEWAY 18998 the published relay through the gateway" "10.0.2.2 4873 host loopback" "10.0.2.2 14873 the host relay port" "$(hostname -I | cut -d' ' -f1) 22 the host's public address"; do
    set -- $target
    address=$1; port=$2; shift 2
    for runtime in runc "$RUNTIME"; do
        if [ "$(reach "$runtime" qrp-int "$address" "$port")" = closed ]; then
            pass "$runtime on the internal network cannot reach $* ($address:$port)"
        else
            crit "$runtime on the internal network reaches $*" "$address:$port"
        fi
    done
done
dk rm -f "$RELAY_ID" >/dev/null

# Whether a per-tenant slice can carry an aggregate limit, which enabling gVisor for all tenants needs.
SLICE_ID="$(dk run -d --runtime "$RUNTIME" --cgroup-parent qaap-probe.slice --memory 256m "$IMAGE" sleep 30 2>&1 | tail -1 | cut -c1-200)"
sleep 2
say "cgroup-parent: scope=[$(scope_of "$SLICE_ID" | sed "s#/sys/fs/cgroup/user.slice/user-$REAL_UID.slice/user@$REAL_UID.service/##")] set-property=$(systemctl --user set-property --runtime qaap-probe.slice TasksMax=500 >/dev/null 2>&1 && echo ok || echo failed) slice-pids.max=$(cat "/sys/fs/cgroup/user.slice/user-$REAL_UID.slice/user@$REAL_UID.service/qaap-probe.slice/pids.max" 2>/dev/null || echo none)"
dk rm -f "$SLICE_ID" >/dev/null 2>&1

# Connect by address: a DNS failure must not pass for network isolation.
if out="$(dk run --rm "${RS[@]}" --network qrp-int "$IMAGE" nc -z -w 6 1.1.1.1 443 2>&1)"; then
    crit 'the internal network has no egress' 'runsc reached 1.1.1.1:443 from an internal network'
else
    pass 'the internal network has no egress (by address)'
fi

# Same order as the orchestrator: create on the internal bridge, connect egress, then start.
dk create --name qrp-two "${RS[@]}" --network qrp-int --add-host "backend:$SRV_IP" "$IMAGE" sh -c \
    'wget -qO- -T 8 http://backend:4873/ && nc -z -w 12 1.1.1.1 443 && echo egress-ok' >/dev/null
dk network connect qrp-ext qrp-two
dk start -a qrp-two > "$SCRATCH/two.out" 2>&1
if grep -q 'egress-ok' "$SCRATCH/two.out" && grep -q 'qaap-ok' "$SCRATCH/two.out"; then
    pass 'two networks connected before start: internal name plus egress'
else
    crit 'two networks connected before start' "$(tr '\n' ' ' < "$SCRATCH/two.out" | cut -c1-300)"
fi
dk rm -f qrp-two >/dev/null

# --- lifecycle: exec (terminals), TTY, restart
say "=== lifecycle"
out="$(dk exec -u 0:0 qrp-srv sh -c 'echo exec-ok' 2>&1)"
if [ "$out" = exec-ok ]; then pass 'docker exec'; else crit 'docker exec' "$out"; fi
out="$(dk exec -t qrp-srv sh -c 'test -t 1 && echo tty-ok' 2>&1 | tr -d '\r')"
if [ "$out" = tty-ok ]; then pass 'docker exec with a TTY'; else crit 'docker exec with a TTY' "$out"; fi
if dk restart -t 5 qrp-srv >/dev/null 2>&1 && [ "$(dk inspect -f '{{.State.Running}}' qrp-srv)" = true ]; then
    pass 'docker restart'
else
    warn 'docker restart' "$(dk logs --tail 3 qrp-srv 2>&1 | cut -c1-200)"
fi
dk rm -f qrp-srv >/dev/null

# --- cost, runc against runsc on the same host
say "=== cost (seconds, runc / runsc)"
FILES='cd /w && mkdir -p b$$ && cd b$$ && i=0; while [ $i -lt 2000 ]; do echo $i > f$i; i=$((i+1)); done; cat f* > /dev/null; rm -rf /w/b$$'
for spec in "start+exit|true" "node startup|node -e 0" "2000 files on bind|sh -c FILES"; do
    label="${spec%%|*}"
    command="${spec##*|}"
    if [ "$command" = 'sh -c FILES' ]; then
        a="$(measure dk run --rm --runtime runc -v "$SCRATCH/bind:/w:rw" "$IMAGE" sh -c "$FILES")"
        b="$(measure dk run --rm "${RS[@]}" -v "$SCRATCH/bind:/w:rw" "$IMAGE" sh -c "$FILES")"
    else
        # shellcheck disable=SC2086 # the command is a fixed word list above
        a="$(measure dk run --rm --runtime runc "$IMAGE" $command)"
        # shellcheck disable=SC2086
        b="$(measure dk run --rm "${RS[@]}" "$IMAGE" $command)"
    fi
    say "$label: $a / $b"
done

say '==='
if [ "$CRITICAL_FAILS" -gt 0 ]; then
    say "VERDICT: NOT VIABLE on rootless as tested ($CRITICAL_FAILS critical, $WARNINGS warnings, flags: $RUNTIME)"
    exit 1
fi
say "VERDICT: VIABLE on rootless ($WARNINGS warnings, flags: $RUNTIME). Production was not touched."
exit 0
