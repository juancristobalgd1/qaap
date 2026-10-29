// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import { pathToFileURL } from 'url';
import { resolveQaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';

/** File name of the standalone OpenCode plugin shipped in this package's `resources/`. */
export const QAAP_TOOL_GATE_OPENCODE_PLUGIN_FILE = 'qaap-tool-gate-opencode.mjs';

/** Absolute path of the OpenCode gate plugin, resolved from the compiled module location at spawn time. */
export function resolveQaapToolGateOpencodePluginPath(): string {
    return path.resolve(__dirname, '..', '..', 'resources', QAAP_TOOL_GATE_OPENCODE_PLUGIN_FILE);
}

/**
 * `OPENCODE_CONFIG_CONTENT` for a gated run: the Qaap plugin first, then whatever inline config the
 * environment already carried. Unparseable inherited content is dropped rather than trusted.
 */
export function buildOpencodeGateConfigContent(inherited: string | undefined): string {
    let config: Record<string, unknown> = {};
    try {
        const parsed = inherited ? JSON.parse(inherited) as unknown : undefined;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            config = parsed as Record<string, unknown>;
        }
    } catch {
        config = {};
    }
    const plugin = pathToFileURL(resolveQaapToolGateOpencodePluginPath()).toString();
    const others = Array.isArray(config.plugin) ? config.plugin.filter(entry => entry !== plugin) : [];
    return JSON.stringify({ ...config, plugin: [plugin, ...others] });
}

/**
 * `ask` rules cannot work next to the gate. Headless `opencode run` rejects every `ask` itself (its
 * `permission.ask` plugin hook is not called in 1.19), so approval has to happen in the plugin's
 * `tool.execute.before`, where the gate asks the user. Keep the `deny` and `allow` rules.
 */
export function dropOpencodeAskPermissions(permission: string | undefined): string | undefined {
    if (!permission) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(permission) as Record<string, unknown>;
        const kept = Object.fromEntries(Object.entries(parsed).filter(([, action]) => action !== 'ask'));
        return Object.keys(kept).length > 0 ? JSON.stringify(kept) : undefined;
    } catch {
        return permission;
    }
}

/**
 * Seeds the OpenCode gate wiring into a harness child env. Call it only after `QAAP_GATE_URL` and
 * `QAAP_GATE_TOKEN` were seeded: without them the plugin would fail every call closed, and the
 * built-in `ask` rules (which reject headless) are the better fallback, so nothing is touched.
 * An untrusted folder additionally switches off project config, plugins, MCP servers and agents.
 */
export function applyOpencodeGateEnv(env: NodeJS.ProcessEnv, trustedFolder: boolean): void {
    if (!env.QAAP_GATE_URL || !env.QAAP_GATE_TOKEN) {
        return;
    }
    env.OPENCODE_CONFIG_CONTENT = buildOpencodeGateConfigContent(env.OPENCODE_CONFIG_CONTENT);
    const permission = dropOpencodeAskPermissions(env.OPENCODE_PERMISSION);
    if (permission) {
        env.OPENCODE_PERMISSION = permission;
    } else {
        delete env.OPENCODE_PERMISSION;
    }
    if (!trustedFolder) {
        Object.assign(env, resolveQaapHarnessCapabilities('opencode').untrustedFolderEnv ?? {});
    }
}

/** True for harnesses whose tool calls reach the gate through an OpenCode plugin. */
export function usesOpencodeGatePlugin(agentId: string | undefined): boolean {
    return agentId?.trim().toLowerCase() === 'opencode' && resolveQaapHarnessCapabilities(agentId).gate === 'plugin';
}
