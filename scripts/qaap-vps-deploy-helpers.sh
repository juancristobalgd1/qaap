#!/usr/bin/env bash
# Shared Docker Compose helpers used by the deploy and rollback transactions.

refresh_caddy() {
    if ! docker compose config --services | grep -Fxq caddy; then
        return 0
    fi

    echo '[qaap-vps] validating Caddy configuration'
    QAAP_THEIA_IMAGE="${QAAP_THEIA_IMAGE:?QAAP_THEIA_IMAGE must be fixed before compose run}" \
        docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    echo '[qaap-vps] recreating Caddy to refresh the bind-mounted configuration'
    QAAP_THEIA_IMAGE="${QAAP_THEIA_IMAGE:?QAAP_THEIA_IMAGE must be fixed before compose up}" \
        docker compose up -d --no-build --no-deps --force-recreate caddy
}

drain_request() {
    docker compose exec -T theia node -e '
        const [method, path, body] = process.argv.slice(1);
        const req = require("http").request({
            host: "127.0.0.1", port: process.env.PORT || 4873, method,
            path: "/qaap/api/cloud/runtime/" + path,
            headers: { "content-type": "application/json" }, timeout: 5000,
        }, res => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => { if (res.statusCode !== 200) { process.exit(2); } process.stdout.write(data); });
        });
        req.on("timeout", () => req.destroy(new Error("timeout")));
        req.on("error", () => process.exit(1));
        if (body) { req.write(body); }
        req.end();
    ' "$1" "$2" "${3:-}" 2>/dev/null
}

drain_agent_turns() {
    local drain_timeout_seconds="${DRAIN_TIMEOUT_SECONDS:-900}"
    if [[ -z "$(docker compose ps -q theia 2>/dev/null | tr -d '\r')" ]]; then
        return 0
    fi
    local answer running
    if ! answer="$(drain_request POST drain '{"draining":true}')"; then
        echo '[qaap-vps] serving container has no agent drain endpoint; switching without drain'
        return 0
    fi
    DRAIN_ACTIVE=1
    local deadline=$((SECONDS + drain_timeout_seconds))
    while :; do
        running="$(printf '%s' "$answer" | sed -n 's/.*"runningTasks":\([0-9][0-9]*\).*/\1/p')"
        if [[ "${running:-0}" -eq 0 ]]; then
            echo '[qaap-vps] no agent turns running; switching'
            return 0
        fi
        if (( SECONDS >= deadline )); then
            echo "[qaap-vps] drain timed out after ${drain_timeout_seconds}s with $running turn(s) running; switching anyway" >&2
            return 0
        fi
        echo "[qaap-vps] waiting for $running agent turn(s) to finish..."
        sleep 10
        answer="$(drain_request GET drain-status)" || answer='{"runningTasks":0}'
    done
}

undo_drain_on_failure() {
    if [[ "${DRAIN_ACTIVE:-0}" -eq 1 ]]; then
        echo '[qaap-vps] deploy failed before the switch; ending agent drain' >&2
        drain_request POST drain '{"draining":false}' >/dev/null || true
    fi
}
