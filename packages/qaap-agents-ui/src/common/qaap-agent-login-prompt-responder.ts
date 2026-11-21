// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type {
    QaapHarnessLoginPhase,
    QaapHarnessLoginPromptResponder,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-auth-profile';

const DEFAULT_ACTIVE_PHASES: readonly QaapHarnessLoginPhase[] = ['waiting', 'challenge', 'code-submitted'];
const BUFFER_LIMIT = 16_000;

export interface QaapAgentLoginPromptResponderDriverOptions {
    readonly responders: readonly QaapHarnessLoginPromptResponder[];
    /** Writes the configured response to the login CLI's stdin. */
    readonly send: (text: string) => void;
}

/**
 * Watches escape-free login CLI output across active phases (`waiting`, `challenge`, `code-submitted`)
 * and automatically answers declared interactive prompts (for example, Copilot CLI asking to store
 * the OAuth token in `~/.copilot/config.json` when no OS keychain is available on a headless VPS).
 *
 * Pure and DOM-/terminal-free so every harness responder can be unit-tested deterministically.
 */
export class QaapAgentLoginPromptResponderDriver {

    protected buffer = '';
    protected stopped = false;
    protected readonly fired = new Set<number>();
    protected readonly compiled: readonly {
        readonly index: number;
        readonly pattern: RegExp;
        readonly response: string;
        readonly phases: readonly QaapHarnessLoginPhase[];
        readonly once: boolean;
    }[];

    constructor(protected readonly options: QaapAgentLoginPromptResponderDriverOptions) {
        this.compiled = options.responders.map((responder, index) => ({
            index,
            pattern: new RegExp(responder.match, 'i'),
            response: responder.response,
            phases: responder.phases ?? DEFAULT_ACTIVE_PHASES,
            once: responder.once !== false,
        }));
    }

    stop(): void {
        this.stopped = true;
    }

    reset(): void {
        this.buffer = '';
        this.fired.clear();
        this.stopped = false;
    }

    /** Visible (escape-free) CLI output and the current login flow phase. */
    feed(text: string, phase: QaapHarnessLoginPhase): void {
        if (this.stopped || !text || this.compiled.length === 0) {
            return;
        }
        this.buffer = `${this.buffer}${text}`.slice(-BUFFER_LIMIT);
        let matchedAny = false;
        for (const entry of this.compiled) {
            if (entry.once && this.fired.has(entry.index)) {
                continue;
            }
            if (!entry.phases.includes(phase)) {
                continue;
            }
            if (!entry.pattern.test(this.buffer)) {
                continue;
            }
            if (entry.once) {
                this.fired.add(entry.index);
            }
            matchedAny = true;
            this.options.send(entry.response);
        }
        if (matchedAny) {
            // Clear the matched text so a non-`once` responder never re-triggers on the same prompt.
            this.buffer = '';
        }
    }
}
