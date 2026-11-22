// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapToolKind } from './qaap-tool-gate-protocol';

/** How a harness reports tool calls to the Qaap tool gate. `none` means no gate runs for it. */
export type QaapGateTransport = 'native-stdio' | 'hook' | 'plugin' | 'extension' | 'acp' | 'none';

/** How Qaap talks to the harness process: its own CLI protocol (`native`) or the Agent Client Protocol (`acp`). */
export type QaapHarnessTransportKind = 'native' | 'acp';

/**
 * What Qaap really enforces for a harness. `gate-preexec`: a tool call is held until the gate answers (stdio control
 * protocol, hook, plugin, extension). `client-boundary`: the agent asks permission by courtesy (ACP) and Qaap can only
 * detect, not prevent, an unrequested write. `none`: no gate runs for it.
 */
export type QaapHarnessEnforcement = 'gate-preexec' | 'client-boundary' | 'none';

/** How a conversation can be continued without re-sending the transcript. No harness resumes natively yet (F3). */
export type QaapHarnessResumeSupport = 'none' | 'native' | 'acp-load' | 'acp-resume';

/**
 * What the backend really does under "Ask before changes" for a harness that cannot ask:
 * `runs-unchecked` (no permission system; every action runs) or `refuses` (gated actions are refused).
 */
export type QaapWhenAskUnsupported = 'runs-unchecked' | 'refuses';

/**
 * How the harness receives Qaap's delegation MCP server (`qaaq`, see `qaap-agent-delegation-protocol.ts`).
 * `claude-mcp-config`: `--mcp-config <file>` on the command line, a 0600 file in a private per-task directory
 * that holds the token (Claude Code). `codex-config`: an `[mcp_servers.qaaq]` table in the per-task `CODEX_HOME`
 * overlay. `opencode-config`: an `mcp` entry in the inline `OPENCODE_CONFIG_CONTENT`, which names only a 0600
 * token file (never the token itself). `pi-extension`: Pi has built-in MCP support but reads servers only from
 * `mcp.json` files, so a Qaap extension (`-e`) registers the server for the session with `pi.registerMcpServer`
 * from a 0600 per-task config file. `none`: the harness gets no delegation tools.
 */
export type QaapDelegateMcpTransport = 'claude-mcp-config' | 'codex-config' | 'opencode-config' | 'pi-extension'
    | 'acp-stdio' | 'acp-http' | 'acp-mcp-over-acp' | 'none';

/** Where the cost of a turn comes from. `none` when Qaap cannot show a cost for the harness. */
export type QaapCostSource = 'reported' | 'price-table' | 'estimate' | 'none';

/**
 * What Qaap can rely on for one harness. Entries describe the wiring that exists today; a harness
 * flips `canAsk` (and its gate transport) only when its adapter lands.
 */
export interface QaapHarnessCapabilities {
    agentId: string;
    gate: QaapGateTransport;
    /** True only if the gate can block for at least {@link askTtlSec}. */
    canAsk: boolean;
    /** Behaviour under request-approval when {@link canAsk} is false. Unknown ids assume the worst. */
    whenAskUnsupported: QaapWhenAskUnsupported;
    /** Max time a single ask may block (harness limit minus margin). 0 when {@link canAsk} is false. */
    askTtlSec: number;
    shellGuard: 'gate' | 'shell-shim' | 'none';
    /** Flags that make the harness ignore repo config when the folder is untrusted. */
    untrustedFolderArgs: string[];
    /** Flags used when the folder is trusted. */
    trustedFolderArgs: string[];
    /** Env vars that make the harness ignore repo config (plugins, agents, MCP, instructions) when the folder is untrusted. */
    untrustedFolderEnv?: Readonly<Record<string, string>>;
    /** How the delegation MCP server reaches this harness; absent = `none`. */
    delegateMcp?: QaapDelegateMcpTransport;
    /** Which usage parser reads this harness's output; `none` when no parser is wired. */
    usage: 'qaiq' | 'claude' | 'codex' | 'opencode' | 'pi-json' | 'acp' | 'none';
    costSource: QaapCostSource;
    /** Own CLI protocol or ACP. Every harness is `native` until the ACP adapter lands (F1). */
    transport: QaapHarnessTransportKind;
    /** What the backend really enforces; derived from {@link gate} for the entries that exist today. */
    enforcement: QaapHarnessEnforcement;
    /** Conversation continuation without re-sending the transcript; `none` until sessions persist (F3). */
    resume: QaapHarnessResumeSupport;
    mapToolKind(rawToolName: string, input: Record<string, unknown>): QaapToolKind;
}

/** Placeholder ask window for harnesses on the stdio control protocol, which has no hook timeout. */
const STDIO_ASK_TTL_SEC = 600;

const SHELL_TOOL_NAMES = new Set(['bash', 'shell', 'run_shell_command', 'exec_command', 'execute_command', 'command', 'terminal']);
const EDIT_TOOL_NAMES = new Set(['edit', 'multiedit', 'multi_edit', 'str_replace', 'str_replace_editor', 'apply_patch', 'patch', 'replace']);
const WRITE_TOOL_NAMES = new Set(['write', 'write_file', 'create_file']);
const READ_TOOL_NAMES = new Set(['read', 'read_file', 'glob', 'grep', 'find', 'ls', 'list_directory', 'search']);
const WEB_TOOL_NAMES = new Set(['webfetch', 'web_fetch', 'websearch', 'web_search', 'fetch']);

/**
 * Default mapping from a harness tool name to a {@link QaapToolKind}. Harnesses with unusual names
 * can supply their own `mapToolKind`; unknown names map to `other`.
 */
export function mapQaapToolKind(rawToolName: string): QaapToolKind {
    const name = rawToolName.trim().toLowerCase();
    if (name.startsWith('mcp__') || name.startsWith('mcp.')) {
        return 'mcp';
    }
    if (SHELL_TOOL_NAMES.has(name)) {
        return 'shell';
    }
    if (EDIT_TOOL_NAMES.has(name)) {
        return 'edit';
    }
    if (WRITE_TOOL_NAMES.has(name)) {
        return 'write';
    }
    if (READ_TOOL_NAMES.has(name)) {
        return 'read';
    }
    if (WEB_TOOL_NAMES.has(name)) {
        return 'web';
    }
    return 'other';
}

/** Conservative defaults: no gate, cannot ask, no parser, no cost. Used for unknown and custom ids. */
function createDefaultHarnessCapabilities(agentId: string): QaapHarnessCapabilities {
    return {
        agentId,
        gate: 'none',
        canAsk: false,
        askTtlSec: 0,
        whenAskUnsupported: 'runs-unchecked',
        shellGuard: 'none',
        untrustedFolderArgs: [],
        trustedFolderArgs: [],
        usage: 'none',
        costSource: 'none',
        transport: 'native',
        enforcement: 'none',
        resume: 'none',
        mapToolKind: rawToolName => mapQaapToolKind(rawToolName),
    };
}

/**
 * Explicit entries for every builtin harness (see `qaap-builtin-agents.ts`). Adding a harness without
 * an entry here is caught by the spec, so a new CLI never silently inherits a capability it lacks.
 */
const QAAP_HARNESS_CAPABILITY_ENTRIES: readonly QaapHarnessCapabilities[] = [
    {
        ...createDefaultHarnessCapabilities('qaiq'),
        gate: 'native-stdio',
        enforcement: 'gate-preexec',
        canAsk: true,
        askTtlSec: STDIO_ASK_TTL_SEC,
        whenAskUnsupported: 'refuses',
        shellGuard: 'gate',
        usage: 'qaiq',
    },
    {
        ...createDefaultHarnessCapabilities('openclaude'),
        gate: 'native-stdio',
        enforcement: 'gate-preexec',
        canAsk: true,
        askTtlSec: STDIO_ASK_TTL_SEC,
        whenAskUnsupported: 'refuses',
        shellGuard: 'gate',
        usage: 'claude',
    },
    // Claude Code speaks the same stream-json control protocol as QAIQ (a fork of it): with
    // `--permission-prompt-tool stdio` every `can_use_tool` request reaches the in-process gate and a pending
    // ask has no timeout. Untrusted folders load user settings only, so a repo's own hooks and
    // `permissions.allow` rules cannot ungate or reroute tools (a hook deny still beats allow anyway). `--setting-sources`
    // does not cover `.mcp.json`; `--strict-mcp-config` does, so a repo MCP server never starts in an untrusted folder.
    {
        ...createDefaultHarnessCapabilities('claude'),
        gate: 'native-stdio',
        enforcement: 'gate-preexec',
        canAsk: true,
        askTtlSec: STDIO_ASK_TTL_SEC,
        whenAskUnsupported: 'refuses',
        shellGuard: 'gate',
        untrustedFolderArgs: ['--setting-sources', 'user', '--strict-mcp-config'],
        usage: 'claude',
        costSource: 'reported',
        // `--mcp-config` servers still load under `--strict-mcp-config` (it drops only the other sources).
        delegateMcp: 'claude-mcp-config',
    },
    // Codex: a per-task CODEX_HOME overlay installs a PreToolUse hook that calls the HTTP gate. Spike on
    // codex-cli 0.165: a hook may block for at least 150 s (the `timeout` is accepted up to 900 s) and the
    // gate answers first (askTtlSec stays below the hook timeout, because a hook timeout fails OPEN).
    // Folder trust is enforced in the overlay config (`[projects]` untrusted), not with CLI flags.
    // Cost comes from the reported tokens through the price table; ChatGPT auth is a subscription.
    {
        ...createDefaultHarnessCapabilities('codex'),
        gate: 'hook',
        enforcement: 'gate-preexec',
        canAsk: true,
        askTtlSec: STDIO_ASK_TTL_SEC,
        whenAskUnsupported: 'refuses',
        shellGuard: 'gate',
        usage: 'codex',
        delegateMcp: 'codex-config',
        costSource: 'price-table',
    },
    // OpenCode: Qaap's plugin (`OPENCODE_CONFIG_CONTENT`) awaits the HTTP gate in `tool.execute.before`, so the
    // gate can ask for as long as an ask lives. Untrusted folders set `OPENCODE_DISABLE_PROJECT_CONFIG`, which
    // stops project plugins, MCP servers, agents, commands and AGENTS.md from loading (verified on 1.19.5).
    // Cost: step_finish carries tokens (and a catalog `cost`); Qaap prices tokens from its own table.
    {
        ...createDefaultHarnessCapabilities('opencode'),
        gate: 'plugin',
        enforcement: 'gate-preexec',
        canAsk: true,
        askTtlSec: STDIO_ASK_TTL_SEC,
        whenAskUnsupported: 'refuses',
        shellGuard: 'gate',
        untrustedFolderEnv: {
            OPENCODE_DISABLE_PROJECT_CONFIG: '1',
            OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
            OPENCODE_DISABLE_CLAUDE_CODE: '1',
        },
        usage: 'opencode',
        delegateMcp: 'opencode-config',
        costSource: 'price-table',
    },
    // Pi has no permission system of its own; Qaap's `-e` extension routes every tool_call through the
    // HTTP gate, which can block for as long as an ask lives (spike: no handler timeout up to 900 s).
    // Folder trust picks `--approve` / `--no-approve`: untrusted folders skip project extensions.
    {
        ...createDefaultHarnessCapabilities('pi'),
        gate: 'extension',
        enforcement: 'gate-preexec',
        canAsk: true,
        askTtlSec: STDIO_ASK_TTL_SEC,
        whenAskUnsupported: 'refuses',
        shellGuard: 'gate',
        untrustedFolderArgs: ['--no-approve'],
        trustedFolderArgs: ['--approve'],
        usage: 'pi-json',
        costSource: 'reported',
        // Pi's built-in MCP client (`-e builtin:mcp`) runs Qaap's shim, registered by a Qaap extension.
        delegateMcp: 'pi-extension',
    },
    // Cursor, Antigravity, Copilot and Grok run unchecked: no permission gate and no ask window. Explicit
    // entries keep them covered by the registry spec, so a future gate is a deliberate change here.
    { ...createDefaultHarnessCapabilities('cursor') },
    { ...createDefaultHarnessCapabilities('antigravity') },
    { ...createDefaultHarnessCapabilities('copilot') },
    { ...createDefaultHarnessCapabilities('grok') },
];

/**
 * Lookup for harness capabilities. Ids are matched case-insensitively. Unknown and custom ids get the
 * conservative default: no gate and `canAsk` false.
 */
export class QaapHarnessCapabilityRegistry {
    protected readonly entries: ReadonlyMap<string, QaapHarnessCapabilities>;

    constructor(entries: readonly QaapHarnessCapabilities[] = QAAP_HARNESS_CAPABILITY_ENTRIES) {
        this.entries = new Map(entries.map(entry => [entry.agentId, entry]));
    }

    /** Returns the capabilities for an agent id, or the conservative default when the id is unknown. */
    get(agentId: string): QaapHarnessCapabilities {
        const normalized = agentId.trim().toLowerCase();
        return this.entries.get(normalized) ?? createDefaultHarnessCapabilities(normalized);
    }

    /** Ids that have an explicit entry. */
    listAgentIds(): readonly string[] {
        return [...this.entries.keys()];
    }
}

/** Shared registry for frontend and backend callers that do not inject one. */
export const QAAP_HARNESS_CAPABILITY_REGISTRY = new QaapHarnessCapabilityRegistry();

/** Resolves capabilities for an optional agent id; a missing id gets the conservative default. */
export function resolveQaapHarnessCapabilities(agentId: string | undefined): QaapHarnessCapabilities {
    return QAAP_HARNESS_CAPABILITY_REGISTRY.get(agentId ?? '');
}
