#!/usr/bin/env bash
# Normalize QAAP_VPS_PUBLIC_URL for health checks / monitors.
#
# Production traffic goes through Caddy on :443 (e.g. https://<ip>.sslip.io).
# THEIA_PORT 4873 is only bound on the VPS loopback and must never be the public
# probe target. Older setup docs minted secrets as http://<ip>:4873 — rewrite
# those to the Caddy HTTPS origin so deploy/monitor stay green without waiting
# for a secret rotate.
#
# Usage: qaap_normalize_vps_public_url <url>
# Prints the URL to use on stdout. Emits a GitHub Actions warning when rewriting.

set -euo pipefail

qaap_normalize_vps_public_url() {
    local url="${1:-}"
    if [ -z "$url" ]; then
        printf '%s' ""
        return 0
    fi

    local scheme host port path rest
    if [[ "$url" =~ ^(https?)://([^/:]+):4873(/.*)?$ ]]; then
        scheme="${BASH_REMATCH[1]}"
        host="${BASH_REMATCH[2]}"
        path="${BASH_REMATCH[3]:-}"
        if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            host="${host}.sslip.io"
        fi
        local rewritten="https://${host}${path}"
        if [ -n "${GITHUB_ACTIONS:-}" ]; then
            echo "::warning::QAAP_VPS_PUBLIC_URL still points at :4873 (${url}). Probing ${rewritten} instead. Update the secret to the Caddy HTTPS URL." >&2
        else
            echo "warning: rewriting stale QAAP_VPS_PUBLIC_URL ${url} → ${rewritten}" >&2
        fi
        printf '%s' "$rewritten"
        return 0
    fi

    # Bare http://<ip>.sslip.io without TLS — prefer https (Caddy terminates TLS).
    if [[ "$url" =~ ^http://([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\.sslip\.io)(/.*)?$ ]]; then
        host="${BASH_REMATCH[1]}"
        path="${BASH_REMATCH[2]:-}"
        local rewritten="https://${host}${path}"
        if [ -n "${GITHUB_ACTIONS:-}" ]; then
            echo "::warning::QAAP_VPS_PUBLIC_URL uses http for sslip.io; probing ${rewritten}." >&2
        fi
        printf '%s' "$rewritten"
        return 0
    fi

    printf '%s' "$url"
}

# When executed (not sourced), normalize argv[1] and print it.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    qaap_normalize_vps_public_url "${1:-}"
    printf '\n'
fi
