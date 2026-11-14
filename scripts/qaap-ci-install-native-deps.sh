#!/usr/bin/env bash
# Native headers needed by node-gyp rebuilds during npm ci on GitHub-hosted
# Ubuntu (native-keymap → x11 + xkbfile). Browser-only CI still runs npm ci
# against the full workspace lockfile, so these packages must be present.
# The apt retry and mirror fallback live in qaap-ci-apt-install.sh.
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
    exit 0
fi

bash "$(dirname "$0")/qaap-ci-apt-install.sh" libx11-dev libxkbfile-dev
