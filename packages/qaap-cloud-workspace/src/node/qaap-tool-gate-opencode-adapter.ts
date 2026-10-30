// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import { pathToFileURL } from 'url';
import { QAAP_OPENCODE_GATE_PROBE } from './qaap-tool-gate-opencode-probe';
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
export function buildOpencodeGateConfigContent(inherited: string | undefined, askPermissions: Record<string, string> = {}): string {
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
    const permission = config.permission && typeof config.permission === 'object' && !Array.isArray(config.permission) ? config.permission : {};
    return JSON.stringify({
        ...config,
        plugin: [plugin, ...others],
        ...(Object.keys(askPermissions).length > 0 ? { permission: { ...permission, ...askPermissions } } : {}),
    });
}

/**
 * Splits OpenCode permission rules into `ask` entries and the rest. Headless `opencode run` rejects every
 * `ask` (its `permission.ask` plugin hook is not called in 1.19), so an `ask` rule is a fail-closed
 * baseline: the Qaap plugin removes it from the inline config only after it reached the gate (`/arm`).
 */
export function splitOpencodeAskPermissions(permission: string | undefined): { ask: Record<string, string>; rest: string | undefined } {
    if (!permission) {
        return { ask: {}, rest: undefined };
    }
    try {
        const parsed = JSON.parse(permission) as Record<string, string>;
        const ask = Object.fromEntries(Object.entries(parsed).filter(([, action]) => action === 'ask'));
        const rest = Object.fromEntries(Object.entries(parsed).filter(([, action]) => action !== 'ask'));
        return { ask, rest: Object.keys(rest).length > 0 ? JSON.stringify(rest) : undefined };
    } catch {
        return { ask: {}, rest: permission };
    }
}

/**
 * Seeds the OpenCode gate wiring into a harness child env. Call it only after `QAAP_GATE_URL` and
 * `QAAP_GATE_TOKEN` were seeded, and only wire the plugin when the probe proved this OpenCode loads it
 * and fires `tool.execute.before` (`probeOk`). Otherwise nothing is touched: the built-in `ask` rules
 * keep refusing gated tools, which is the fail-closed fallback.
 * The `ask` rules move into the inline config so the plugin can lift them once it armed. An untrusted
 * folder additionally switches off project config, plugins, MCP servers and agents.
 */
export function applyOpencodeGateEnv(env: NodeJS.ProcessEnv, trustedFolder: boolean, probeOk: boolean = QAAP_OPENCODE_GATE_PROBE.verdict()?.ok === true): void {
    if (!env.QAAP_GATE_URL || !env.QAAP_GATE_TOKEN || !probeOk) {
        return;
    }
    const { ask, rest } = splitOpencodeAskPermissions(env.OPENCODE_PERMISSION);
    env.OPENCODE_CONFIG_CONTENT = buildOpencodeGateConfigContent(env.OPENCODE_CONFIG_CONTENT, ask);
    if (rest) {
        env.OPENCODE_PERMISSION = rest;
    } else {
        delete env.OPENCODE_PERMISSION;
    }
    if (!trustedFolder) {
        Object.assign(env, resolveQaapHarnessCapabilities('opencode').untrustedFolderEnv ?? {});
    }
}

/** True when the env carries the Qaap plugin, i.e. the runner must see it arm. */
export function opencodeGatePluginSeeded(env: NodeJS.ProcessEnv): boolean {
    return !!env.OPENCODE_CONFIG_CONTENT && env.OPENCODE_CONFIG_CONTENT.includes(pathToFileURL(resolveQaapToolGateOpencodePluginPath()).toString());
}

/** Seconds the plugin gets to report in before the spawn (`QAAP_GATE_ARM_TIMEOUT_SEC`, default 20). */
export function resolveOpencodeArmTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
    const seconds = Number(env.QAAP_GATE_ARM_TIMEOUT_SEC);
    return (seconds > 0 ? seconds : 20) * 1000;
}

/**
 * Cancels a gated OpenCode run whose plugin never armed. The inline `ask` baseline already keeps tools
 * from running in the meantime; this turns a silently refusing run into a clear failure.
 * Returns a function that stops the watch.
 */
export function startOpencodeArmWatch(options: {
    readonly isArmed: () => boolean;
    readonly isRunning: () => boolean;
    readonly onTimeout: () => void;
    readonly timeoutMs: number;
}): () => void {
    const timer = setTimeout(() => {
        if (options.isRunning() && !options.isArmed()) {
            options.onTimeout();
        }
    }, options.timeoutMs);
    timer.unref?.();
    return () => clearTimeout(timer);
}

/** True for harnesses whose tool calls reach the gate through an OpenCode plugin. */
export function usesOpencodeGatePlugin(agentId: string | undefined): boolean {
    return agentId?.trim().toLowerCase() === 'opencode' && resolveQaapHarnessCapabilities(agentId).gate === 'plugin';
}
