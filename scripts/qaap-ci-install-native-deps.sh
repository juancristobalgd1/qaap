#!/usr/bin/env bash
# Native headers needed by node-gyp rebuilds during npm ci on GitHub-hosted
# Ubuntu (native-keymap → x11 + xkbfile). Browser-only CI still runs npm ci
# against the full workspace lockfile, so these packages must be present.
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
    exit 0
fi

sudo apt-get update
sudo apt-get install -y --no-install-recommends libx11-dev libxkbfile-dev
