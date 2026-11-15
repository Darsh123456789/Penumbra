#!/usr/bin/env bash
# Runs web/scripts/relay_check.ts under Node 22 (type stripping) against web/public/data.
# OLD_ENGINE: a copy of web/src/engine.ts from before the relay hook (default: from git, commit fab4876).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; T="$(mktemp -d)"
patch() { sed -e "s#const BASE = import.meta.env.BASE_URL + 'data/';#const BASE = '';#" -e "s#from './engine'#from './engine.ts'#"; }
patch < "$ROOT/web/src/engine.ts" > "$T/engine.ts"; patch < "$ROOT/web/src/relay.ts" > "$T/relay.ts"
git -C "$ROOT" show "${OLD_ENGINE_REV:-fab4876}:web/src/engine.ts" | patch > "$T/engine_old.ts"
cp "$ROOT/web/scripts/relay_check.ts" "$T/check.ts"
node --experimental-strip-types --no-warnings "$T/check.ts" "$ROOT/web/public/data/" "$T/relay_check.json"
