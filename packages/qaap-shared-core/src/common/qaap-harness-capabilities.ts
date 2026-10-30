// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapToolKind } from './qaap-tool-gate-protocol';

/** How a harness reports tool calls to the Qaap tool gate. `none` means no gate runs for it. */
export type QaapGateTransport = 'native-stdio' | 'hook' | 'plugin' | 'extension' | 'none';

/**
 * What the backend really does under "Ask before changes" for a harness that cannot ask:
 * `runs-unchecked` (no permission system; every action runs) or `refuses` (gated actions are refused).
 */
export type QaapWhenAskUnsupported = 'runs-unchecked' | 'refuses';

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
    /** Which usage parser reads this harness's output; `none` when no parser is wired. */
    usage: 'qaiq' | 'claude' | 'codex' | 'opencode' | 'pi-json' | 'none';
    costSource: QaapCostSource;
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
        canAsk: true,
        askTtlSec: STDIO_ASK_TTL_SEC,
        whenAskUnsupported: 'refuses',
        shellGuard: 'gate',
        usage: 'qaiq',
    },
    {
        ...createDefaultHarnessCapabilities('openclaude'),
        gate: 'native-stdio',
        canAsk: true,
        askTtlSec: STDIO_ASK_TTL_SEC,
        whenAskUnsupported: 'refuses',
        shellGuard: 'gate',
        usage: 'claude',
    },
    // Without a gate, claude, codex and opencode have their skip flags stripped under request-approval,
    // so gated actions are refused rather than run.
    { ...createDefaultHarnessCapabilities('claude'), whenAskUnsupported: 'refuses', usage: 'claude' },
    // Codex: a per-task CODEX_HOME overlay installs a PreToolUse hook that calls the HTTP gate. Spike on
    // codex-cli 0.165: a hook may block for at least 150 s (the `timeout` is accepted up to 900 s) and the
    // gate answers first (askTtlSec stays below the hook timeout, because a hook timeout fails OPEN).
    // Folder trust is enforced in the overlay config (`[projects]` untrusted), not with CLI flags.
    // Cost comes from the reported tokens through the price table; ChatGPT auth is a subscription.
    {
        ...createDefaultHarnessCapabilities('codex'),
        gate: 'hook',
        canAsk: true,
        askTtlSec: STDIO_ASK_TTL_SEC,
        whenAskUnsupported: 'refuses',
        shellGuard: 'gate',
        usage: 'codex',
        costSource: 'price-table',
    },
    { ...createDefaultHarnessCapabilities('opencode'), whenAskUnsupported: 'refuses', usage: 'opencode' },
    // Pi has no permission system of its own; Qaap's `-e` extension routes every tool_call through the
    // HTTP gate, which can block for as long as an ask lives (spike: no handler timeout up to 900 s).
    // Folder trust picks `--approve` / `--no-approve`: untrusted folders skip project extensions.
    {
        ...createDefaultHarnessCapabilities('pi'),
        gate: 'extension',
        canAsk: true,
        askTtlSec: STDIO_ASK_TTL_SEC,
        whenAskUnsupported: 'refuses',
        shellGuard: 'gate',
        untrustedFolderArgs: ['--no-approve'],
        trustedFolderArgs: ['--approve'],
        usage: 'pi-json',
        costSource: 'reported',
    },
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
