#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

forbidden_pattern='(^|/)(node_modules|out|dist|build|release|portable|coverage|test-results|playwright-report|runs|\.cache|tmp)(/|$)|(^|/)\.env($|\.)|\.log$|(^|/)DEVELOPMENT_LOG\.md$'
forbidden_files="$(git ls-files | grep -E "$forbidden_pattern" || true)"
if [[ -n "$forbidden_files" ]]; then
  printf 'Blocked tracked files:\n%s\n' "$forbidden_files" >&2
  exit 1
fi

large_files=""
while IFS= read -r file; do
  [[ -f "$file" ]] || continue
  size="$(wc -c < "$file" | tr -d ' ')"
  if (( size > 10485760 )); then
    large_files+="${size} ${file}"$'\n'
  fi
done < <(git ls-files)
if [[ -n "$large_files" ]]; then
  printf 'Tracked files over 10MB:\n%s' "$large_files" >&2
  exit 1
fi

if git grep -n -I -E '(/Users/[^/[:space:]]+|[A-Za-z]:\\Users\\[^\\[:space:]]+|(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|(^|[^A-Za-z0-9])gh[opusr]_[A-Za-z0-9]{20,})' -- ':!package-lock.json' ':!scripts/verify-public-release.sh'; then
  printf 'Possible local path or secret found. Review before publishing.\n' >&2
  exit 1
fi

npm run test:unit
npm run build

printf 'Public release verification passed.\n'
