// Qaap delegation extension for Pi (`pi -e builtin:mcp -e <this file>`). Standalone: Node built-ins only.
// Pi has built-in MCP support but reads servers only from mcp.json files, so this extension registers the
// per-task `qaaq_<nonce>` server (the stdio shim, qaap-delegate-mcp.mjs) for the session instead.
// The server config, which holds the delegation token, comes from a 0600 file whose path is the only thing in
// Pi's environment. The variable is removed once read so Pi's shell tool (and anything it starts) never sees it.
// Keep the variable name in step with QAAP_AGENT_DELEGATION_PI_CONFIG_ENV (a spec checks it).

import { readFileSync } from 'node:fs';

export const PI_CONFIG_ENV = 'QAAP_DELEGATION_PI_CONFIG';

/** Reads and validates the config file; undefined when absent or unusable (delegation is then simply off). */
export function readPiDelegationConfig(env = process.env) {
    const file = typeof env[PI_CONFIG_ENV] === 'string' ? env[PI_CONFIG_ENV].trim() : '';
    delete env[PI_CONFIG_ENV];
    if (!file) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        const config = parsed?.config;
        if (typeof parsed?.serverName !== 'string' || !/^qaaq_[0-9a-f]{16}$/.test(parsed.serverName)
            || typeof config?.command !== 'string' || !Array.isArray(config.args)) {
            return undefined;
        }
        return { serverName: parsed.serverName, config };
    } catch {
        return undefined;
    }
}

export default function qaapDelegation(pi) {
    const wiring = readPiDelegationConfig();
    if (!wiring || typeof pi.registerMcpServer !== 'function') {
        return;
    }
    try {
        pi.registerMcpServer(wiring.serverName, wiring.config);
    } catch (error) {
        process.stderr.write(`[qaap] could not register the delegation server (${error instanceof Error ? error.name : 'error'})\n`);
    }
}
