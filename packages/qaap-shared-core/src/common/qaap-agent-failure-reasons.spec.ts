// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    describeAgentTurnFailure,
    detectAgentFailureKind,
    extractAgentLogFailureHint,
    extractLastFailedToolFromMessage,
    formatStoredAgentFailureMessage,
    isAgentTurnInterruptedError,
    localizeAgentFailureMessage,
    localizeAgentFailureShortReason,
    localizeAgentTurnTimeoutMessage,
    localizeGenericAgentFailureMessage,
    resolveAgentTurnFailureMessage,
} from './qaap-agent-failure-message';
import { localizeAgentAuthFailureMessage } from './qaap-agent-auth-login';
import {
    CLAUDE_NOT_LOGGED_IN_LOG,
    CREDITS_DEPLETED_LOG,
    MODEL_UNAVAILABLE_LOG,
    PRODUCTION_ROW_ERRORS,
    RATE_LIMIT_RETRY_LOOP_IDLE_LOG,
    RECOVERED_AGENT_MESSAGE,
    RECOVERED_RETRY_THEN_IDLE_LOG,
    RECOVERED_THEN_KILLED_LOG,
    RECOVERED_THEN_PROVIDER_TERMINATED_LOG,
    REPEATED_TOOL_FAILURES_LOG,
    RESULTLESS_TOOL_AGENT_MESSAGE,
    RUNNER_IDLE_TIMEOUT_LOG,
    SUCCESS_ENVELOPE_LOG,
    TERMINAL_NPM_AGENT_MESSAGE,
} from './test/qaap-agent-failure-log-fixtures';

/** What the backend persists for a failed turn, then reduced to the row's short reason. */
function persistAndDescribe(log: string, options: Parameters<typeof resolveAgentTurnFailureMessage>[1]): {
    readonly persisted: string;
    readonly label: string | undefined;
} {
    const persisted = resolveAgentTurnFailureMessage(log, options);
    return { persisted, label: localizeAgentFailureShortReason(persisted) };
}

describe('agent failure reasons (real logs)', () => {
    describe('the final result envelope wins', () => {
        it('names the provider error, not the 429 retry, failed npm test or 403 the agent recovered from', () => {
            expect(detectAgentFailureKind(RECOVERED_THEN_PROVIDER_TERMINATED_LOG)).to.equal(undefined);
            expect(extractAgentLogFailureHint(RECOVERED_THEN_PROVIDER_TERMINATED_LOG)).to.equal('API Error: terminated');
            const { persisted, label } = persistAndDescribe(RECOVERED_THEN_PROVIDER_TERMINATED_LOG, {
                state: 'failed', exitCode: 1, agentMessage: RECOVERED_AGENT_MESSAGE,
            });
            expect(persisted).to.equal('The agent hit an error: API Error: terminated');
            expect(label).to.equal('The agent stopped unexpectedly');
        });

        it('reads the end of a long log, where the run died', () => {
            const noise = Array.from({ length: 400 }, (_, index) => JSON.stringify({ type: 'stream_event', event: { type: 'ping', index } })).join('\n');
            const log = `${JSON.stringify({ error: { message: 'provider rejected the request' } })}\n${noise}\n${RECOVERED_THEN_PROVIDER_TERMINATED_LOG}`;
            expect(log.length).to.be.greaterThan(12_000);
            expect(extractAgentLogFailureHint(log)).to.equal('API Error: terminated');
        });

        it('ignores tool failures once the CLI reported success', () => {
            expect(extractAgentLogFailureHint(SUCCESS_ENVELOPE_LOG)).to.equal(undefined);
            expect(resolveAgentTurnFailureMessage(SUCCESS_ENVELOPE_LOG, { state: 'failed', exitCode: 1 }))
                .to.equal(localizeGenericAgentFailureMessage('failed', 1));
        });
    });

    describe('blame a tool only when it was the last step', () => {
        it('recovery false positive: an earlier failed npm test is not why a killed run died', () => {
            expect(extractLastFailedToolFromMessage(RECOVERED_AGENT_MESSAGE)).to.equal(undefined);
            const { persisted, label } = persistAndDescribe(RECOVERED_THEN_KILLED_LOG, {
                state: 'failed', exitCode: 1, agentMessage: RECOVERED_AGENT_MESSAGE,
            });
            expect(persisted).to.equal(localizeGenericAgentFailureMessage('failed', 1));
            expect(persisted).not.to.match(/Bash|npm|rate|quota/i);
            expect(label).to.equal('The agent stopped unexpectedly');
        });

        it('names the command when it was the last step, quoting npm\'s cause rather than its footer', () => {
            const { persisted, label } = persistAndDescribe(RECOVERED_THEN_KILLED_LOG, {
                state: 'failed', exitCode: 1, agentMessage: TERMINAL_NPM_AGENT_MESSAGE,
            });
            expect(persisted).to.equal('Bash failed: npm error Missing script: "test"');
            expect(label).to.equal('A command failed');
        });

        it('does not count a tool that finished without a result as a failure', () => {
            expect(extractLastFailedToolFromMessage(RESULTLESS_TOOL_AGENT_MESSAGE)).to.equal(undefined);
            expect(resolveAgentTurnFailureMessage('', { state: 'failed', exitCode: 1, agentMessage: RESULTLESS_TOOL_AGENT_MESSAGE }))
                .to.equal(localizeGenericAgentFailureMessage('failed', 1));
        });

        it('a 403 printed by the last command is a failed command, not a sign-in', () => {
            const persisted = resolveAgentTurnFailureMessage('', {
                state: 'failed',
                exitCode: 1,
                agentMessage: {
                    role: 'agent',
                    content: '',
                    segments: [{ type: 'tool', toolUseId: 't1', name: 'Bash', args: '{}', finished: true, result: 'Error: Request failed with status code 403' }],
                },
            });
            expect(persisted).to.equal('Bash failed: Error: Request failed with status code 403');
            expect(localizeAgentFailureShortReason(persisted)).to.equal('A command failed');
        });
    });

    describe('sign-in comes only from the CLI error envelope', () => {
        it('signed-out Claude Code asks to sign in, naming the agent when the caller knows it', () => {
            expect(detectAgentFailureKind(CLAUDE_NOT_LOGGED_IN_LOG)).to.equal('auth');
            const persisted = resolveAgentTurnFailureMessage(CLAUDE_NOT_LOGGED_IN_LOG, { state: 'failed', exitCode: 1, agentId: 'claude' });
            expect(persisted).to.equal(localizeAgentAuthFailureMessage({ mode: 'session' }));
            expect(localizeAgentFailureShortReason(persisted)).to.equal('Sign in required');
            expect(localizeAgentFailureShortReason(persisted, { agentLabel: 'Claude Code' })).to.equal('Sign in to Claude Code');
        });

        it('a bare 401/403/forbidden in tool output or prose is not auth', () => {
            expect(detectAgentFailureKind('curl: (22) The requested URL returned error: 403 Forbidden')).to.equal(undefined);
            expect(detectAgentFailureKind('Wrote src/pages/unauthorized.tsx and the access denied banner.')).to.equal(undefined);
        });

        it('a git push 403 (`fatal:`) is a repository permission, not an expired agent session', () => {
            const gitPush = [
                'To https://github.com/acme/app.git',
                'remote: Permission to acme/app.git denied to qaap-bot.',
                'fatal: unable to access \'https://github.com/acme/app.git/\': The requested URL returned error: 403',
            ].join('\n');
            expect(detectAgentFailureKind(gitPush)).to.equal(undefined);
        });

        it('a tool\'s `Error: … 403` line in a plain-text CLI log is not auth', () => {
            const plainTextRun = [
                '> Fetching the release notes',
                'Error: Request failed with status code 403',
                '    at settle (node_modules/axios/lib/core/settle.js:19:12)',
                'Retrying with the cached copy instead.',
                'Agent exited: tool loop aborted',
            ].join('\n');
            expect(detectAgentFailureKind(plainTextRun)).to.equal(undefined);
            const persisted = resolveAgentTurnFailureMessage(plainTextRun, { state: 'failed', exitCode: 1 });
            expect(persisted).not.to.equal(localizeAgentAuthFailureMessage({ mode: 'session' }));
            expect(localizeAgentFailureShortReason(persisted)).not.to.match(/^Sign in/);
        });

        it('the last line of a plain-text CLI log still reads as auth', () => {
            const plainTextRun = [
                '> Fetching the release notes',
                'Done reading 3 files.',
                'Error: 401 Unauthorized',
            ].join('\n');
            expect(detectAgentFailureKind(plainTextRun)).to.equal('auth');
        });

        it('a 401 in the CLI\'s own error line still is', () => {
            expect(detectAgentFailureKind('unexpected status 401 Unauthorized: missing bearer token')).to.equal('auth');
            expect(detectAgentFailureKind('API Error: 403 {"error":{"type":"forbidden"}}')).to.equal('auth');
        });
    });

    describe('the short reasons', () => {
        it('maps provider envelopes to usage, model and command reasons', () => {
            expect(persistAndDescribe(CREDITS_DEPLETED_LOG, { state: 'failed', exitCode: 1 }).label).to.equal('Quota reached');
            expect(persistAndDescribe(MODEL_UNAVAILABLE_LOG, { state: 'failed', exitCode: 1 }).label).to.equal('Model unavailable');
            const repeated = persistAndDescribe(REPEATED_TOOL_FAILURES_LOG, { state: 'failed', exitCode: 1 });
            expect(repeated.persisted).to.match(/^The agent hit an error: Stopped: repeated tool failures detected\./);
            expect(repeated.label).to.equal('A command failed');
        });

        it('test output that mentions a timeout is not the agent timing out', () => {
            const testRun = [
                '> app@1.0.0 test',
                '> vitest run',
                ' FAIL  src/api.spec.ts > fetches the profile',
                'Error: Test timed out in 5000ms.',
                ' Tests  1 failed | 41 passed (42)',
                'Process exited with code 1',
            ].join('\n');
            expect(detectAgentFailureKind(testRun)).to.equal(undefined);
            expect(detectAgentFailureKind('[qaap] task timed out after 1200s without output.')).to.equal('timeout');
            expect(detectAgentFailureKind('API Error: Request timed out.')).to.equal('timeout');
        });

        it('the runner idle timer becomes a timeout pause the user can continue', () => {
            const { persisted, label } = persistAndDescribe(RUNNER_IDLE_TIMEOUT_LOG, { state: 'interrupted' });
            expect(persisted).to.equal(localizeAgentTurnTimeoutMessage('idle', 20));
            expect(persisted).to.equal('Timed out after 20 minutes without output. Continue runs it again from your original request.');
            expect(detectAgentFailureKind(persisted)).to.equal('timeout');
            expect(label).to.equal('Timed out');
            expect(isAgentTurnInterruptedError(persisted)).to.equal(true);
        });

        it('a CLI killed while still retrying a rate limit reports the rate limit, not the idle timer', () => {
            const { persisted, label } = persistAndDescribe(RATE_LIMIT_RETRY_LOOP_IDLE_LOG, { state: 'interrupted' });
            expect(persisted).to.equal(localizeAgentFailureMessage('rate_limit'));
            expect(label).to.equal('Quota reached');
        });

        it('a recovered retry before the run went quiet keeps the idle timeout', () => {
            const { persisted, label } = persistAndDescribe(RECOVERED_RETRY_THEN_IDLE_LOG, { state: 'interrupted' });
            expect(persisted).to.equal(localizeAgentTurnTimeoutMessage('idle', 20));
            expect(label).to.equal('Timed out');
        });

        it('a provider `Request failed:` usage line is a usage limit, not a failed tool', () => {
            expect(localizeAgentFailureShortReason('Request failed: 429 quota exceeded')).to.equal('Quota reached');
            expect(localizeAgentFailureShortReason('Bash failed: Error: Request failed with status code 429')).to.equal('A command failed');
        });

        it('the approval-wait pause round-trips through the stored copy as a continuable timeout', () => {
            const stored = localizeAgentTurnTimeoutMessage('approval_wait', 24 * 60);
            expect(stored).to.equal('Waited 24 hours for your approval. Continue runs it again from your original request.');
            expect(formatStoredAgentFailureMessage(stored)).to.equal(stored);
            expect(detectAgentFailureKind(stored)).to.equal('timeout');
            expect(isAgentTurnInterruptedError(stored)).to.equal(true);
            expect(localizeAgentFailureShortReason(stored)).to.equal('Timed out');
        });

        it('reduces the raw production row texts and keeps them as the detail', () => {
            const bashExit = describeAgentTurnFailure(PRODUCTION_ROW_ERRORS.bashExitCode);
            expect(bashExit).to.deep.equal({
                kind: 'command_failed',
                label: 'A command failed',
                detail: PRODUCTION_ROW_ERRORS.bashExitCode,
                interrupted: false,
            });
            expect(describeAgentTurnFailure(PRODUCTION_ROW_ERRORS.bashNpmFooter)?.label).to.equal('A command failed');
            const permission = describeAgentTurnFailure(PRODUCTION_ROW_ERRORS.permissionHint);
            expect(permission?.label).to.equal('The agent stopped unexpectedly');
            expect(permission?.detail).to.equal(PRODUCTION_ROW_ERRORS.permissionHint);
        });

        it('treats timeout pauses and restarts as interruptions, old watchdog copy included', () => {
            const legacy = describeAgentTurnFailure(PRODUCTION_ROW_ERRORS.legacyWatchdog);
            expect(legacy?.label).to.equal('Timed out');
            expect(legacy?.interrupted).to.equal(true);
            const restart = describeAgentTurnFailure(PRODUCTION_ROW_ERRORS.backendRestart);
            expect(restart?.label).to.equal('The agent stopped unexpectedly');
            expect(restart?.interrupted).to.equal(true);
            expect(isAgentTurnInterruptedError(PRODUCTION_ROW_ERRORS.bashExitCode)).to.equal(false);
        });

        it('localizes the persisted timeout copy and keeps it stable', () => {
            const cap = localizeAgentTurnTimeoutMessage('max_duration', 180);
            expect(cap).to.equal('Timed out at the 180-minute task limit. Continue runs it again from your original request.');
            expect(formatStoredAgentFailureMessage(cap)).to.equal(cap);
            expect(describeAgentTurnFailure(cap)).to.deep.equal({ kind: 'timeout', label: 'Timed out', detail: cap, interrupted: true });
        });
    });
});
