// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    extractAgentAuthLoginChallenge,
    isAgentLoginSuccessOutput,
    type QaapAgentAuthLoginChallenge,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-auth-login';
import {
    parseAgentLoginExitMarker,
    stripAgentLoginShellEcho,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-connect-plan';

/** No URL, code or success within this window means the CLI is stuck: show its output instead. */
export const QAAP_AGENT_LOGIN_CHALLENGE_TIMEOUT_MS = 20_000;
/** After the user pastes a code back, the CLI gets this long to report success. */
export const QAAP_AGENT_LOGIN_CODE_TIMEOUT_MS = 45_000;
/** Status check, workspace and hidden terminal must be ready within this window. */
export const QAAP_AGENT_LOGIN_PREPARE_TIMEOUT_MS = 15_000;
/** The server caps npm at 120 s; past this the install request itself is stuck. */
export const QAAP_AGENT_LOGIN_INSTALL_TIMEOUT_MS = 150_000;
const OUTPUT_LIMIT = 16_000;
const TAIL_LINES = 8;

export type QaapAgentLoginFailureReason = 'timeout' | 'exited' | 'unavailable' | 'install-failed';

/** Every state the Connect dialog can show. Only `preparing`, `installing` and `waiting` spin. */
export type QaapAgentLoginFlowState =
    | { readonly phase: 'preparing'; readonly startedAt?: number }
    | { readonly phase: 'install-required'; readonly canInstall: boolean; readonly message?: string }
    | { readonly phase: 'installing'; readonly startedAt?: number }
    | { readonly phase: 'settings-api-key' }
    /** No sign-in this dialog can run (tenant-terminal onboarding, hosted policy): instructions only. */
    | { readonly phase: 'manual'; readonly message: string }
    | { readonly phase: 'waiting'; readonly startedAt: number }
    | { readonly phase: 'challenge'; readonly challenge: QaapAgentAuthLoginChallenge }
    | { readonly phase: 'code-submitted'; readonly challenge: QaapAgentAuthLoginChallenge; readonly submittedAt: number }
    | { readonly phase: 'connected' }
    | {
        readonly phase: 'failed';
        readonly reason: QaapAgentLoginFailureReason;
        readonly tail: readonly string[];
        readonly exitCode?: number;
        readonly message?: string;
    };

export interface QaapAgentLoginFlowOptions {
    readonly agentId: string;
    readonly onDidChange: (state: QaapAgentLoginFlowState) => void;
}

/** Last meaningful terminal lines, without the wrapper command echo or the exit marker. */
export function resolveAgentLoginOutputTail(output: string, limit = TAIL_LINES): string[] {
    return stripAgentLoginShellEcho(output)
        .split('\n')
        .map(line => line.trimEnd())
        .filter(line => line.trim().length > 0)
        .slice(-limit);
}

/**
 * Connect-dialog state machine, independent of the DOM and of the terminal so it can be specced.
 * The host feeds it terminal output, process exit and clock ticks; it never waits forever.
 */
export class QaapAgentLoginFlow {

    protected current: QaapAgentLoginFlowState = { phase: 'preparing' };
    protected output = '';

    constructor(protected readonly options: QaapAgentLoginFlowOptions) { }

    get state(): QaapAgentLoginFlowState {
        return this.current;
    }

    get isSettled(): boolean {
        return this.current.phase === 'connected' || this.current.phase === 'failed'
            || this.current.phase === 'settings-api-key' || this.current.phase === 'install-required'
            || this.current.phase === 'manual';
    }

    /** Back to the initial spinner for a Retry (status is re-checked before the CLI runs again). */
    restart(now: number): void {
        this.output = '';
        this.set({ phase: 'preparing', startedAt: now });
    }

    requireInstall(canInstall: boolean, message?: string): void {
        this.set({ phase: 'install-required', canInstall, ...(message ? { message } : {}) });
    }

    startInstall(now: number): void {
        this.set({ phase: 'installing', startedAt: now });
    }

    installFailed(message?: string): void {
        this.set({ phase: 'failed', reason: 'install-failed', tail: [], ...(message ? { message } : {}) });
    }

    requireSettingsApiKey(): void {
        this.set({ phase: 'settings-api-key' });
    }

    showManualInstructions(message: string): void {
        this.set({ phase: 'manual', message });
    }

    /** The login command was sent to the terminal; the watchdog starts now. */
    commandStarted(now: number): void {
        this.output = '';
        this.set({ phase: 'waiting', startedAt: now });
    }

    unavailable(message?: string): void {
        this.set({ phase: 'failed', reason: 'unavailable', tail: [], ...(message ? { message } : {}) });
    }

    appendOutput(chunk: string): void {
        if (!this.isRunning()) {
            return;
        }
        this.output = `${this.output}${chunk}`.slice(-OUTPUT_LIMIT);
        const exitCode = parseAgentLoginExitMarker(this.output);
        if (exitCode !== undefined) {
            this.exited(exitCode);
            return;
        }
        const visible = stripAgentLoginShellEcho(this.output);
        if (isAgentLoginSuccessOutput(visible)) {
            this.connected();
            return;
        }
        if (this.current.phase === 'code-submitted') {
            return;
        }
        const challenge = extractAgentAuthLoginChallenge(visible, { preferMode: 'session', agentId: this.options.agentId });
        // A bare mode (e.g. the echoed `--device-auth` flag) is not something the user can act on.
        if (!challenge || (!challenge.url && !challenge.userCode)) {
            return;
        }
        if (this.current.phase === 'challenge' && sameChallenge(this.current.challenge, challenge)) {
            return;
        }
        this.set({ phase: 'challenge', challenge });
    }

    /** The login command ended (exit marker). 0 is success; anything else shows the CLI output. */
    exited(code: number): void {
        if (!this.isRunning()) {
            return;
        }
        if (code === 0) {
            this.connected();
            return;
        }
        this.set({ phase: 'failed', reason: 'exited', exitCode: code, tail: resolveAgentLoginOutputTail(this.output) });
    }

    /** The user pasted the authorization code back into the CLI. */
    codeSubmitted(now: number): void {
        if (this.current.phase !== 'challenge' && this.current.phase !== 'code-submitted') {
            return;
        }
        this.set({ phase: 'code-submitted', challenge: this.current.challenge, submittedAt: now });
    }

    tick(now: number): void {
        const state = this.current;
        if (state.phase === 'preparing' && state.startedAt !== undefined && now - state.startedAt >= QAAP_AGENT_LOGIN_PREPARE_TIMEOUT_MS) {
            this.unavailable();
            return;
        }
        if (state.phase === 'installing' && state.startedAt !== undefined && now - state.startedAt >= QAAP_AGENT_LOGIN_INSTALL_TIMEOUT_MS) {
            this.installFailed();
            return;
        }
        const timedOut = (state.phase === 'waiting' && now - state.startedAt >= QAAP_AGENT_LOGIN_CHALLENGE_TIMEOUT_MS)
            || (state.phase === 'code-submitted' && now - state.submittedAt >= QAAP_AGENT_LOGIN_CODE_TIMEOUT_MS);
        if (timedOut) {
            this.set({ phase: 'failed', reason: 'timeout', tail: resolveAgentLoginOutputTail(this.output) });
        }
    }

    connected(): void {
        if (this.current.phase !== 'connected') {
            this.set({ phase: 'connected' });
        }
    }

    protected isRunning(): boolean {
        const phase = this.current.phase;
        return phase === 'waiting' || phase === 'challenge' || phase === 'code-submitted';
    }

    protected set(state: QaapAgentLoginFlowState): void {
        this.current = state;
        this.options.onDidChange(state);
    }
}

function sameChallenge(left: QaapAgentAuthLoginChallenge, right: QaapAgentAuthLoginChallenge): boolean {
    return left.url === right.url && left.userCode === right.userCode
        && left.mode === right.mode && !!left.codeEntry === !!right.codeEntry;
}
