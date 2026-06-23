#!/usr/bin/env bash
# Importa docs/qa/issues/QA-*.md a GitHub Issues (requiere Issues habilitados en el repo).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

if ! gh repo view --json hasIssuesEnabled --jq '.hasIssuesEnabled' 2>/dev/null | grep -q true; then
  echo "Issues deshabilitados. Actívalos en:"
  echo "  https://github.com/juancristobalgd1/qaap/settings"
  echo "  General → Features → Issues"
  exit 1
fi

create_issue() {
  local file="$1"
  local title priority labels
  title=$(sed -n '1s/^## //p' "$file")
  priority=$(sed -n '/^\*\*Prioridad:\*\*/s/.*\*\*\(.*\)\*\*.*/\1/p' "$file" | head -1)
  labels="qa"
  case "$priority" in
    Alta) labels="bug,priority:high,qa" ;;
    Media) labels="bug,priority:medium,qa" ;;
  esac
  echo "→ $title"
  gh issue create --title "$title" --body-file "$file" --label "$labels"
}

for f in docs/qa/issues/QA-*.md; do
  create_issue "$f"
  sleep 1
done

echo "Done."
