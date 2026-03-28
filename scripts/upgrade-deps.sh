#!/usr/bin/env bash
# Upgrade shadow-cljs and vite across root and examples/
set -euo pipefail

DEPS=(shadow-cljs vite)
DIRS=(. examples/*)

for dir in "${DIRS[@]}"; do
  [[ -f "$dir/package.json" ]] || continue
  echo "📦 $dir"
  (cd "$dir" && pnpm up -L "${DEPS[@]}" 2>/dev/null) || true
done
