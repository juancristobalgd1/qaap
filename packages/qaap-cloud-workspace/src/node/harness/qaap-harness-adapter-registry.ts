// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { resolveApprovalAgentId } from '../../common/qaap-agent-approval-flags';
import type { QaapAgentPromptTransport } from '../qaap-agent-task-runner-utils';
import type { QaapHarnessAdapter } from './qaap-harness-adapter';
import { QaapAntigravityHarnessAdapter } from './legacy/qaap-antigravity-harness-adapter';
import { QaapClaudeHarnessAdapter } from './legacy/qaap-claude-harness-adapter';
import { QaapCodexHarnessAdapter } from './legacy/qaap-codex-harness-adapter';
import { QaapCopilotHarnessAdapter } from './legacy/qaap-copilot-harness-adapter';
import { QaapCursorHarnessAdapter } from './legacy/qaap-cursor-harness-adapter';
import { QaapGenericHarnessAdapter } from './legacy/qaap-generic-harness-adapter';
import { QaapGrokHarnessAdapter } from './legacy/qaap-grok-harness-adapter';
import { QaapOpenClaudeHarnessAdapter } from './legacy/qaap-openclaude-harness-adapter';
import { QaapOpencodeHarnessAdapter } from './legacy/qaap-opencode-harness-adapter';
import { QaapPiHarnessAdapter } from './legacy/qaap-pi-harness-adapter';
import { QaapQaiqHarnessAdapter } from './legacy/qaap-qaiq-harness-adapter';
import { QaapShellHarnessAdapter } from './legacy/qaap-shell-harness-adapter';
import { QaapStdinPromptHarnessAdapter } from './legacy/qaap-stdin-prompt-harness-adapter';

/** What the runner knows about a harness's CLI when it asks how the prompt travels. */
export interface QaapHarnessDetectedCli {
    readonly id?: string;
    readonly bin?: string;
    readonly template?: string;
}

/**
 * Resolves the {@link QaapHarnessAdapter} of an agent id. Ids are matched case-insensitively; an id without an
 * adapter (custom agents, `QAAP_AGENT_COMMAND`, harness instances) gets the generic adapter, which behaves like
 * the runner did for a harness with no special case.
 *
 * The order of `adapters` matters for {@link resolvePromptTransport}: the transport rules used to be one ordered
 * list in the runner and a rule could match on the detected binary of another harness, so the adapters are
 * asked in that same order and the first one that claims the probe wins.
 */
export class QaapHarnessAdapterRegistry {

    protected readonly byId: ReadonlyMap<string, QaapHarnessAdapter>;

    constructor(protected readonly adapters: readonly QaapHarnessAdapter[], protected readonly fallback: QaapHarnessAdapter) {
        this.byId = new Map(adapters.map(adapter => [adapter.agentId, adapter]));
    }

    /** The adapter registered for the id, or undefined. */
    find(agentId: string | undefined): QaapHarnessAdapter | undefined {
        return this.byId.get(agentId?.trim().toLowerCase() ?? '');
    }

    /** The adapter registered for the id, or the generic one. */
    get(agentId: string | undefined): QaapHarnessAdapter {
        return this.find(agentId) ?? this.fallback;
    }

    /**
     * The adapter of the harness whose approval protocol a command speaks: custom ids such as `qaiq-gemini` describe
     * a model or provider, not another protocol, so the id is inferred from the command when it is not a known one.
     */
    forApprovalProtocol(command: string, agentId: string | undefined): QaapHarnessAdapter {
        return this.get(resolveApprovalAgentId(command, agentId) ?? agentId);
    }

    /** Ids that have a dedicated adapter. */
    listAgentIds(): readonly string[] {
        return [...this.byId.keys()];
    }

    /** How the prompt travels to the harness: argv, stdin (with or without a placeholder) or a private file. */
    resolvePromptTransport(agentId: string | undefined, detected?: QaapHarnessDetectedCli): QaapAgentPromptTransport {
        const probe = {
            agentId: (agentId ?? detected?.id ?? '').trim().toLowerCase(),
            bin: detected?.bin?.trim().toLowerCase(),
            template: detected?.template,
        };
        for (const adapter of [...this.adapters, this.fallback]) {
            const transport = adapter.matchPromptTransport(probe);
            if (transport) {
                return transport;
            }
        }
        return { kind: 'argv' };
    }
}

/**
 * The adapters in prompt-transport priority order (see {@link QaapHarnessAdapterRegistry}): Cursor, Grok and
 * Antigravity first because they also claim a detected binary, then the harnesses that take the prompt on stdin
 * without a placeholder, Copilot, and the ones that take `-`.
 */
export function createQaapHarnessAdapters(): readonly QaapHarnessAdapter[] {
    return [
        new QaapCursorHarnessAdapter(),
        new QaapGrokHarnessAdapter(),
        new QaapAntigravityHarnessAdapter(),
        new QaapClaudeHarnessAdapter(),
        new QaapQaiqHarnessAdapter(),
        new QaapOpenClaudeHarnessAdapter(),
        new QaapOpencodeHarnessAdapter(),
        new QaapStdinPromptHarnessAdapter('qwen', { kind: 'plain-stdin', placeholder: 'omit' }),
        new QaapPiHarnessAdapter(),
        new QaapCopilotHarnessAdapter(),
        new QaapCodexHarnessAdapter(),
        new QaapStdinPromptHarnessAdapter('kimi', { kind: 'plain-stdin', placeholder: 'dash' }),
        new QaapStdinPromptHarnessAdapter('goose', { kind: 'plain-stdin', placeholder: 'dash' }),
        new QaapStdinPromptHarnessAdapter('hermes', { kind: 'plain-stdin', placeholder: 'dash' }),
        new QaapStdinPromptHarnessAdapter('openclaw', { kind: 'plain-stdin', placeholder: 'dash' }),
        new QaapShellHarnessAdapter(),
    ];
}

/** Shared registry for backend callers that do not inject one (same pattern as the capability registry). */
export const QAAP_HARNESS_ADAPTER_REGISTRY = new QaapHarnessAdapterRegistry(createQaapHarnessAdapters(), new QaapGenericHarnessAdapter());
