// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { resolveQaapCloudWorkspaceResource } from '../../qaap-cloud-workspace-resource';
import { QAAP_TOOL_GATE_PI_EXTENSION_FILE } from '../../qaap-tool-gate-pi-adapter';

/**
 * Launch side of the ACP bridge (`resources/qaap-acp-bridge.mjs`, design "Desviación F1: puente"): which harnesses
 * run through it, and the argv that starts it. The runner still starts one process per turn; the bridge speaks ACP
 * to the agent next to it and prints Claude stream-json.
 */

export const QAAP_ACP_BRIDGE_FILE = 'qaap-acp-bridge.mjs';

/** ACP flavors the bridge knows (`FLAVORS` in the bridge), each behind its own flag until its E2E passes. */
export type QaapAcpFlavorId = 'opencode' | 'copilot';

const FLAVOR_FLAGS: Readonly<Record<QaapAcpFlavorId, string>> = {
    opencode: 'QAAP_HARNESS_ACP_OPENCODE',
    copilot: 'QAAP_HARNESS_ACP_COPILOT',
};

/** The agent command each flavor starts in ACP mode. */
const FLAVOR_AGENT_ARGV: Readonly<Record<QaapAcpFlavorId, readonly string[]>> = {
    opencode: ['opencode', 'acp'],
    copilot: ['copilot', '--acp'],
};

export function resolveQaapAcpBridgePath(): string {
    return resolveQaapCloudWorkspaceResource(QAAP_ACP_BRIDGE_FILE);
}

/** The gate client the bridge loads (`askGate`); shared with Pi's gate extension so the fail-closed logic exists once. */
export function resolveQaapAcpGateClientPath(): string {
    return resolveQaapCloudWorkspaceResource(QAAP_TOOL_GATE_PI_EXTENSION_FILE);
}

/** The ACP flavor of a harness id, when its flag is on (`1`); undefined keeps the native one-shot CLI. */
export function resolveQaapAcpFlavor(agentId: string | undefined, env: NodeJS.ProcessEnv = process.env): QaapAcpFlavorId | undefined {
    const id = agentId?.trim().toLowerCase();
    if (id !== 'opencode' && id !== 'copilot') {
        return undefined;
    }
    return env[FLAVOR_FLAGS[id]]?.trim() === '1' ? id : undefined;
}

export interface QaapAcpBridgeLaunch {
    readonly flavor: QaapAcpFlavorId;
    readonly nodeBin: string;
    readonly bridgePath: string;
    readonly gateClientPath: string;
    readonly mode: 'ask' | 'auto' | 'readonly';
    /** Provider/model id; never a credential. */
    readonly model?: string;
    /** Binary that replaces the flavor's default (Settings → Harness binary path). */
    readonly agentBin?: string;
}

/** The bridge's argv. Nothing secret goes here: credentials stay in the env or in 0600 files. */
export function buildQaapAcpBridgeArgv(launch: QaapAcpBridgeLaunch): string[] {
    const [defaultBin, ...agentArgs] = FLAVOR_AGENT_ARGV[launch.flavor];
    return [
        launch.nodeBin,
        launch.bridgePath,
        '--flavor', launch.flavor,
        '--mode', launch.mode,
        '--gate-client', launch.gateClientPath,
        ...(launch.model ? ['--model', launch.model] : []),
        '--',
        launch.agentBin ?? defaultBin,
        ...agentArgs,
    ];
}

/** {@link buildQaapAcpBridgeArgv} as a shell command line for the runner's template path. */
export function buildQaapAcpBridgeCommand(launch: QaapAcpBridgeLaunch, quoteShellArg: (value: string) => string): string {
    return buildQaapAcpBridgeArgv(launch).map(quoteShellArg).join(' ');
}

/**
 * The model a native OpenCode / Copilot command line selects (`--model x`, `--model=x`, `-m x`), so the bridge can
 * set the same one through the session's config option.
 */
export function extractQaapAcpModelFromCommand(command: string): string | undefined {
    const match = /(?:^|\s)(?:--model(?:=|\s+)|-m\s+)(?:'([^']*)'|"([^"]*)"|(\S+))/.exec(command);
    const model = match ? (match[1] ?? match[2] ?? match[3]) : undefined;
    return model?.trim() ? model.trim() : undefined;
}
