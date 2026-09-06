#!/usr/bin/env bash
# Test publication/retention using a real tar and fake Docker (no live volumes).
set -euo pipefail
SOURCE="$(cd "$(dirname "$0")" && pwd)"
TEST_ROOT="$(mktemp -d -t qaap-backup-test.XXXXXXXX)"
cleanup() { case "$TEST_ROOT" in */qaap-backup-test.*) rm -rf -- "$TEST_ROOT" ;; *) exit 2 ;; esac; }
trap cleanup EXIT
mkdir -p "$TEST_ROOT/scripts" "$TEST_ROOT/bin" "$TEST_ROOT/data/workspace" "$TEST_ROOT/data/root/.qaap" "$TEST_ROOT/data/root/.theia"
mkdir -p "$TEST_ROOT/data/tmp/qaap-worktrees" "$TEST_ROOT/data/tmp/qaap-parallel" "$TEST_ROOT/data/home/qaap-tenants"
sed 's/\r$//' "$SOURCE/qaap-vps-backup.sh" > "$TEST_ROOT/scripts/qaap-vps-backup.sh"
printf 'saved data' > "$TEST_ROOT/data/workspace/example"
cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == compose ]]; then echo 'test-container'; exit 0; fi
[[ "$*" == *'test-container:ro'* ]] || { echo 'Expected readonly source volumes' >&2; exit 2; }
partial="$(printf '%s' "$*" | sed -n 's/.*\(qaap-[0-9-]*\.tar\.gz\.partial\).*/\1/p')"
[[ -n "$partial" ]] || exit 2
if [[ "${TEST_CORRUPT:-0}" == 1 ]]; then
    printf 'broken archive' > "$QAAP_BACKUP_DIR/$partial"
else
    tar -czf "$QAAP_BACKUP_DIR/$partial" -C "$TEST_DATA" workspace root/.qaap root/.theia tmp/qaap-worktrees tmp/qaap-parallel home/qaap-tenants
fi
exit "${TEST_TAR_EXIT:-0}"
MOCK
printf '#!/usr/bin/env bash\nexit "${TEST_LOCK_EXIT:-0}"\n' > "$TEST_ROOT/bin/flock"
chmod +x "$TEST_ROOT/bin/"*
export PATH="$TEST_ROOT/bin:$PATH" TEST_DATA="$TEST_ROOT/data"
expect_failure() {
    local result=0
    bash "$TEST_ROOT/scripts/qaap-vps-backup.sh" > "$TEST_ROOT/output" 2>&1 || result=$?
    [[ "$result" != 0 ]] || { cat "$TEST_ROOT/output"; echo 'Expected failure' >&2; exit 1; }
    [[ -z "$(find "$QAAP_BACKUP_DIR" -name '*.tar.gz')" ]] || { echo 'Failed backup was published'; exit 1; }
    [[ -z "$(find "$QAAP_BACKUP_DIR" -name '*.partial')" ]] || { echo 'Partial archive leaked'; exit 1; }
}
export QAAP_BACKUP_DIR="$TEST_ROOT/nonzero"
mkdir -p "$QAAP_BACKUP_DIR"
export TEST_TAR_EXIT=2
expect_failure
unset TEST_TAR_EXIT
export QAAP_BACKUP_DIR="$TEST_ROOT/corrupt" TEST_CORRUPT=1
mkdir -p "$QAAP_BACKUP_DIR"
expect_failure
unset TEST_CORRUPT
export QAAP_BACKUP_DIR="$TEST_ROOT/locked" TEST_LOCK_EXIT=1
mkdir -p "$QAAP_BACKUP_DIR"
expect_failure
unset TEST_LOCK_EXIT
export QAAP_BACKUP_DIR="$TEST_ROOT/valid backups" QAAP_BACKUP_KEEP=1
mkdir -p "$QAAP_BACKUP_DIR"
touch "$QAAP_BACKUP_DIR/qaap-20000101-000000.tar.gz" "$QAAP_BACKUP_DIR/qaap-20000101-000000.tar.gz.sha256"
bash "$TEST_ROOT/scripts/qaap-vps-backup.sh" > "$TEST_ROOT/output" 2>&1 || { cat "$TEST_ROOT/output"; exit 1; }
mapfile -t archives < <(find "$QAAP_BACKUP_DIR" -name '*.tar.gz')
[[ "${#archives[@]}" == 1 && ! -f "$QAAP_BACKUP_DIR/qaap-20000101-000000.tar.gz.sha256" ]] || exit 1
(cd "$QAAP_BACKUP_DIR" && sha256sum -c "$(basename "${archives[0]}").sha256")
echo 'PASS: tar failure, corruption, lock contention, atomic publication, checksum and space-safe retention'
