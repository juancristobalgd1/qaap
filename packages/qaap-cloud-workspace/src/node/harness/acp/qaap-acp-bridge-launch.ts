// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { createHash } from 'crypto';
import * as fs from 'fs';
import { resolveQaapHarnessCapabilities, type QaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import { QAAP_AGENT_DELEGATION_TOKEN_FILE_ENV, QAAP_AGENT_DELEGATION_URL_ENV } from '../../../common/qaap-agent-delegation-protocol';
import {
    QAAP_DELEGATION_SANDBOX_NODE,
    stageQaapSandboxScripts,
    type QaapDelegationMcpConfigOptions,
    type QaapDelegationWiring,
} from '../../qaap-agent-delegation-launch';
import type { AgentPromptOwner } from '../../qaap-agent-task-runner-utils';
import { resolveQaapCloudWorkspaceResource } from '../../qaap-cloud-workspace-resource';
import type { QaapTaskSandbox } from '../../qaap-task-sandbox';
import { QAAP_TOOL_GATE_PI_EXTENSION_FILE } from '../../qaap-tool-gate-pi-adapter';

/**
 * Launch side of the ACP bridge (`resources/qaap-acp-bridge.mjs`, design "Desviación F1: puente"): which harnesses
 * run through it, and the argv that starts it. The runner still starts one process per turn; the bridge speaks ACP
 * to the agent next to it and prints Claude stream-json.
 */

export const QAAP_ACP_BRIDGE_FILE = 'qaap-acp-bridge.mjs';

/** ACP flavors the bridge knows (`FLAVORS` in the bridge), each behind its own flag until its E2E passes. */
export type QaapAcpFlavorId = 'opencode' | 'copilot' | 'grok';

const FLAVOR_FLAGS: Readonly<Record<QaapAcpFlavorId, string>> = {
    opencode: 'QAAP_HARNESS_ACP_OPENCODE',
    copilot: 'QAAP_HARNESS_ACP_COPILOT',
    grok: 'QAAP_HARNESS_ACP_GROK',
};

/** The agent command each flavor starts in ACP mode. */
const FLAVOR_AGENT_ARGV: Readonly<Record<QaapAcpFlavorId, readonly string[]>> = {
    opencode: ['opencode', 'acp'],
    copilot: ['copilot', '--acp'],
    // `--permission-mode default` (a global flag, before the subcommand) makes Grok ask before edits and commands;
    // without it Grok runs them unasked. It also overrides an `always-approve` in the user's Grok config.
    grok: ['grok', '--permission-mode', 'default', 'agent', 'stdio'],
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
    if (id !== 'opencode' && id !== 'copilot' && id !== 'grok') {
        return undefined;
    }
    return env[FLAVOR_FLAGS[id]]?.trim() === '1' ? id : undefined;
}

export interface QaapAcpBridgeLaunch {
    readonly flavor: QaapAcpFlavorId;
    readonly nodeBin: string;
    readonly bridgePath: string;
    readonly gateClientPath: string;
    /** sha256 of the gate client's bytes; the bridge refuses a client that differs. */
    readonly gateClientSha256?: string;
    readonly mode: 'ask' | 'auto' | 'readonly';
    /** Provider/model id; never a credential. */
    readonly model?: string;
    /** Binary that replaces the flavor's default (Settings → Harness binary path). */
    readonly agentBin?: string;
    /** 0600 file with the MCP servers for `session/new` (delegation); it holds paths only, never a token. */
    readonly mcpServersFile?: string;
    /** Prompt file of a harness whose native CLI takes `--prompt-file` (Grok); otherwise the prompt comes on stdin. */
    readonly promptFile?: string;
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
        ...(launch.gateClientSha256 ? ['--gate-client-sha256', launch.gateClientSha256] : []),
        ...(launch.model ? ['--model', launch.model] : []),
        ...(launch.mcpServersFile ? ['--mcp-servers', launch.mcpServersFile] : []),
        ...(launch.promptFile ? ['--prompt-file', launch.promptFile] : []),
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

/**
 * The `--prompt-file` path of a native command line, unquoted. The runner appends it after every template value, so
 * the LAST occurrence is the runner's own (an earlier one could only come from a value such as the model name).
 */
export function extractQaapAcpPromptFileFromCommand(command: string): string | undefined {
    const matches = [...command.matchAll(/(?:^|\s)--prompt-file\s+(?:'((?:[^']|'\\'')*)'|"([^"]*)"|(\S+))/g)];
    const match = matches[matches.length - 1];
    const file = match ? (match[1]?.replace(/'\\''/g, "'") ?? match[2] ?? match[3]) : undefined;
    return file?.trim() ? file : undefined;
}

/** What {@link resolveQaapAcpSpawnCommand} needs from the turn. */
export interface QaapAcpSpawnRequest {
    readonly flavor: QaapAcpFlavorId;
    readonly taskId: string;
    /** The native command line the template produced (the model is read from it). */
    readonly command: string;
    readonly autoApprove?: boolean;
    readonly readOnlyWorkspace?: boolean;
    /** The task sandbox the agent runs in, if any. */
    readonly sandbox?: Pick<QaapTaskSandbox, 'name' | 'sharedRoot'>;
    readonly owner?: AgentPromptOwner;
    readonly agentBin?: string;
    /** The child env; gets `ELECTRON_RUN_AS_NODE` when the backend's node is Electron (the bridge strips it for the agent). */
    readonly env: NodeJS.ProcessEnv;
    readonly quoteShellArg: (value: string) => string;
    /** Refuse to run without a task sandbox (hosted deployments). */
    readonly requireSandbox?: boolean;
    /** See {@link QaapAcpBridgeLaunch.mcpServersFile}. */
    readonly mcpServersFile?: string;
}

/** The turn's command line in ACP mode. In a task sandbox the bridge and its gate client are copied fresh for the turn. */
export function resolveQaapAcpSpawnCommand(request: QaapAcpSpawnRequest): string {
    const mode = request.readOnlyWorkspace ? 'readonly' : request.autoApprove === false ? 'ask' : 'auto';
    let nodeBin = process.execPath;
    let bridgePath = resolveQaapAcpBridgePath();
    let gateClientPath = resolveQaapAcpGateClientPath();
    // The bridge loads only these bytes, whatever is at the path by then (a staged copy is writable by the agent's uid).
    const gateClientSha256 = createHash('sha256').update(fs.readFileSync(gateClientPath)).digest('hex');
    if (request.requireSandbox && !request.sandbox) {
        throw new Error(`The ${request.flavor} ACP harness runs only inside a task sandbox here (set QAAP_TASK_SANDBOX=1 or turn its ACP flag off).`);
    }
    if (request.sandbox) {
        [bridgePath, gateClientPath] = stageQaapSandboxScripts(request.taskId, request.sandbox, [
            { fileName: QAAP_ACP_BRIDGE_FILE, source: bridgePath },
            { fileName: QAAP_TOOL_GATE_PI_EXTENSION_FILE, source: gateClientPath },
        ], request.owner);
        nodeBin = QAAP_DELEGATION_SANDBOX_NODE;
    } else if (typeof process.versions.electron === 'string') {
        request.env.ELECTRON_RUN_AS_NODE = '1';
    }
    const model = extractQaapAcpModelFromCommand(request.command);
    const promptFile = extractQaapAcpPromptFileFromCommand(request.command);
    return buildQaapAcpBridgeCommand({
        flavor: request.flavor, nodeBin, bridgePath, gateClientPath, gateClientSha256, mode,
        ...(model ? { model } : {}),
        ...(request.agentBin ? { agentBin: request.agentBin } : {}),
        ...(request.mcpServersFile ? { mcpServersFile: request.mcpServersFile } : {}),
        ...(promptFile ? { promptFile } : {}),
    }, request.quoteShellArg);
}

/** Ask TTL of a harness gated through the bridge: the gate holds the permission request, nothing in ACP times it out. */
export const QAAP_ACP_ASK_TTL_SEC = 600;

/**
 * The capabilities the backend must enforce for this harness right now: the static entry, changed by an active ACP
 * flavor whose only checkpoint is the bridge (Copilot, Grok: from `runs-unchecked` to a gate that can ask; enforcement
 * `client-boundary`, since a hostile agent can still mutate without asking and only the sandbox bounds it).
 * OpenCode keeps its pre-execution plugin, so its entry is unchanged.
 */
export function resolveQaapRuntimeHarnessCapabilities(agentId: string | undefined, env: NodeJS.ProcessEnv = process.env): QaapHarnessCapabilities {
    const capabilities = resolveQaapHarnessCapabilities(agentId);
    const flavor = resolveQaapAcpFlavor(agentId, env);
    if (flavor !== 'copilot' && flavor !== 'grok') {
        return capabilities;
    }
    return {
        ...capabilities,
        // The bridge passes the delegation server as stdio (Grok) or, for Copilot (which ignores stdio MCP), behind
        // its loopback HTTP proxy; the runner side is the same.
        delegateMcp: 'acp-stdio',
        transport: 'acp',
        gate: 'acp',
        canAsk: true,
        askTtlSec: QAAP_ACP_ASK_TTL_SEC,
        whenAskUnsupported: 'refuses',
        enforcement: 'client-boundary',
    };
}

/** Whether the bridge prints Claude stream-json (ending in a `result` line) for this flavor, rather than plain text. */
export function qaapAcpFlavorPrintsStreamJson(flavor: QaapAcpFlavorId | undefined): boolean {
    return flavor === 'opencode';
}

/**
 * The `session/new` MCP servers of a delegating turn (`acp-stdio`): the delegation shim, run by the sandbox's or this
 * backend's node, with the backend URL and the PATH of the 0600 token file. The token itself is never in this list.
 */
export function buildQaapAcpDelegationMcpServers(
    options: QaapDelegationMcpConfigOptions,
    wiring: Pick<QaapDelegationWiring, 'mcpServerName' | 'url'>,
    tokenFile: string,
): string {
    return JSON.stringify([{
        name: wiring.mcpServerName,
        command: options.nodeBin,
        args: [options.shimPath],
        env: [
            { name: QAAP_AGENT_DELEGATION_URL_ENV, value: wiring.url },
            { name: QAAP_AGENT_DELEGATION_TOKEN_FILE_ENV, value: tokenFile },
            ...(options.electronRunAsNode ? [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }] : []),
        ],
    }]);
}
