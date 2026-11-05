#!/usr/bin/env bash
# Run inside an isolated host CI checkout. Commit/deploy the updated pointer using the host pipeline.
set -euo pipefail

module=${1:?Usage: update-waba-submodule.sh SUBMODULE_PATH RELEASE_COMMIT}
commit=${2:?A release commit is required}
[[ $commit =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected a full GitHub commit SHA' >&2; exit 1; }

cd "$(git rev-parse --show-toplevel)"
entry=$(git ls-files --stage -- "$module")
[[ $entry == 160000\ * && $entry != *$'\n'* ]] || { echo 'Expected one tracked WABA submodule' >&2; exit 1; }
[[ -e "$module/.git" ]] || { echo 'Initialize the WABA submodule before updating it' >&2; exit 1; }
[[ -z $(git -C "$module" status --porcelain) ]] || { echo 'WABA submodule has local changes' >&2; exit 1; }

git -C "$module" fetch --no-tags https://github.com/chandan539/waba-app.git "$commit"
git -C "$module" checkout --detach "$commit"
git add -- "$module"
