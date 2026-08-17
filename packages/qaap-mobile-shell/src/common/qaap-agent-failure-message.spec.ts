// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    detectAgentFailureKind,
    extractAgentLogFailureHint,
    extractLastFailedToolFromMessage,
    formatStoredAgentFailureMessage,
    localizeAgentFailureMessage,
    localizeGenericAgentFailureMessage,
    resolveAgentTurnFailureMessage,
    resolveAgentTurnFailureTechnicalContent,
} from './qaap-agent-failure-message';

describe('qaap-agent-failure-message', () => {

    it('detectAgentFailureKind recognizes quota and credit exhaustion', () => {
        expect(detectAgentFailureKind('{"error":{"type":"invalid_request","message":"quota exceeded"}}'))
            .to.equal('quota');
        expect(detectAgentFailureKind('Free credits for Kimi K2.6 are exhausted.'))
            .to.equal('quota');
    });

    it('does not classify an ordinary invalid request as exhausted quota', () => {
        expect(detectAgentFailureKind('{"error":{"type":"invalid_request","message":"malformed input"}}'))
            .to.equal(undefined);
    });

    it('detectAgentFailureKind recognizes rate limits', () => {
        expect(detectAgentFailureKind('HTTP 429: rate_limit_exceeded'))
            .to.equal('rate_limit');
        expect(detectAgentFailureKind('Too many requests — try again later'))
            .to.equal('rate_limit');
    });

    it('detectAgentFailureKind recognizes model unavailable messages', () => {
        expect(detectAgentFailureKind('There was an issue with the selected model.'))
            .to.equal('model_unavailable');
        expect(detectAgentFailureKind('model_not_found: kimi-k2.6'))
            .to.equal('model_unavailable');
    });

    it('detectAgentFailureKind recognizes tool-support errors before model availability', () => {
        // OpenRouter's 404 when `tools` is sent to a model without a tool-capable endpoint.
        expect(detectAgentFailureKind('404 No endpoints found that support tool use.'))
            .to.equal('tool_unsupported');
        expect(detectAgentFailureKind('The model tencent/hy3:free does not support tools.'))
            .to.equal('tool_unsupported');
        expect(detectAgentFailureKind('Error: function calling is not supported by this model'))
            .to.equal('tool_unsupported');
        // Must win over model_unavailable when both could plausibly match the sentence.
        expect(detectAgentFailureKind('The selected model does not support tool use.'))
            .to.equal('tool_unsupported');
    });

    it('detectAgentFailureKind recognizes a missing agent CLI as setup, not a crash', () => {
        expect(detectAgentFailureKind('stderr\nError: command not found: qaiq\n'))
            .to.equal('cli_missing');
        expect(detectAgentFailureKind('openclaude: command not found'))
            .to.equal('cli_missing');
        expect(detectAgentFailureKind('spawn qaiq ENOENT'))
            .to.equal('cli_missing');
        expect(detectAgentFailureKind('\'qaiq\' is not recognized as an internal or external command'))
            .to.equal('cli_missing');
        expect(detectAgentFailureKind('bash: /usr/local/bin/openclaude: No such file or directory'))
            .to.equal('cli_missing');
        expect(detectAgentFailureKind('Cannot find the qaiq executable'))
            .to.equal('cli_missing');
    });

    it('detectAgentFailureKind recognizes auth, timeout, and network failures', () => {
        expect(detectAgentFailureKind('invalid_api_key'))
            .to.equal('auth');
        expect(detectAgentFailureKind('Codex auth is required for gpt-5.5. Set CODEX_API_KEY or run qaiq login.'))
            .to.equal('auth');
        expect(detectAgentFailureKind('request timed out after 90s'))
            .to.equal('timeout');
        expect(detectAgentFailureKind('fetch failed: ECONNREFUSED'))
            .to.equal('network');
    });

    it('extractAgentLogFailureHint surfaces JSON and terminal error lines', () => {
        expect(extractAgentLogFailureHint('{"error":{"message":"provider rejected the request"}}'))
            .to.equal('provider rejected the request');
        expect(extractAgentLogFailureHint('info\nError: something went wrong\n'))
            .to.equal('Error: something went wrong');
        expect(extractAgentLogFailureHint(
            'info\nCodex auth is required for gpt-5.5. Set CODEX_API_KEY or run qaiq login.\n',
        )).to.equal('Codex auth is required for gpt-5.5. Set CODEX_API_KEY or run qaiq login.');
    });

    it('resolveAgentTurnFailureMessage prefers provider quota text over generic copy', () => {
        const friendly = resolveAgentTurnFailureMessage(
            'Error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 54h16m14s.',
            { state: 'failed', exitCode: 0 },
        );
        expect(friendly).to.match(/Individual quota reached/i);
        expect(friendly).to.match(/Resets in/i);
        expect(friendly).to.not.match(/^Error:/i);
    });

    it('resolveAgentTurnFailureMessage maps known logs to product copy', () => {
        const friendly = resolveAgentTurnFailureMessage(
            'There was an issue with the selected model.',
            { state: 'failed', exitCode: 1 },
        );
        expect(friendly).to.equal(localizeAgentFailureMessage('model_unavailable'));
    });

    it('resolveAgentTurnFailureMessage maps a missing agent CLI to setup copy', () => {
        const friendly = resolveAgentTurnFailureMessage(
            'stderr\nError: command not found: qaiq\n',
            { state: 'failed', exitCode: 1 },
        );
        expect(friendly).to.equal(localizeAgentFailureMessage('cli_missing'));
        expect(friendly).to.not.contain('command not found');
    });

    it('resolveAgentTurnFailureMessage returns humanized copy when the log is empty', () => {
        expect(resolveAgentTurnFailureMessage('', { state: 'failed', exitCode: 1 }))
            .to.equal(localizeGenericAgentFailureMessage('failed', 1));
        expect(resolveAgentTurnFailureMessage('', { state: 'interrupted' }))
            .to.equal(localizeGenericAgentFailureMessage('interrupted'));
    });

    it('formatStoredAgentFailureMessage upgrades legacy exit-code copy', () => {
        expect(formatStoredAgentFailureMessage('Agent failed (exit 1).'))
            .to.equal(localizeGenericAgentFailureMessage('failed', 1));
        expect(formatStoredAgentFailureMessage('Agent interrupted.'))
            .to.equal(localizeGenericAgentFailureMessage('interrupted'));
    });

    it('formatStoredAgentFailureMessage maps a missing agent CLI to setup copy', () => {
        expect(formatStoredAgentFailureMessage('Error: command not found: qaiq'))
            .to.equal(localizeAgentFailureMessage('cli_missing'));
    });

    it('extractLastFailedToolFromMessage returns the last tool with error output', () => {
        const failed = extractLastFailedToolFromMessage({
            role: 'agent',
            content: '',
            segments: [
                {
                    type: 'tool',
                    toolUseId: 't1',
                    name: 'Write',
                    args: '{}',
                    finished: true,
                    result: 'ok',
                },
                {
                    type: 'tool',
                    toolUseId: 't2',
                    name: 'Bash',
                    args: '{"command":"qaiq run"}',
                    finished: true,
                    result: 'Error: command not found: qaiq\nexit code 127',
                },
            ],
        });
        expect(failed?.name).to.equal('Bash');
        expect(failed?.exitCode).to.equal(127);
    });

    it('extractLastFailedToolFromMessage ignores glob hits with error in file paths', () => {
        const failed = extractLastFailedToolFromMessage({
            role: 'agent',
            content: '',
            segments: [{
                type: 'tool',
                toolUseId: 't1',
                name: 'Glob',
                args: '{}',
                finished: true,
                result: [
                    'package.json',
                    'node_modules/postcss/lib/css-syntax-error.js',
                ].join('\n'),
            }],
        });
        expect(failed).to.equal(undefined);
    });

    it('resolveAgentTurnFailureMessage prefers failed tool context over generic copy', () => {
        const friendly = resolveAgentTurnFailureMessage('', {
            state: 'failed',
            exitCode: 1,
            agentMessage: {
                role: 'agent',
                content: '',
                segments: [{
                    type: 'tool',
                    toolUseId: 't1',
                    name: 'Bash',
                    args: '{}',
                    finished: true,
                    result: 'Error: command not found: qaiq',
                }],
            },
        });
        expect(friendly).to.equal(localizeAgentFailureMessage('cli_missing'));
    });

    it('resolveAgentTurnFailureMessage names the failed tool when the log is empty', () => {
        const friendly = resolveAgentTurnFailureMessage(undefined, {
            state: 'failed',
            exitCode: 1,
            agentMessage: {
                role: 'agent',
                content: '',
                segments: [{
                    type: 'tool',
                    toolUseId: 't1',
                    name: 'Bash',
                    args: '{}',
                    finished: true,
                    result: 'Error: EACCES permission denied\nexit code 13',
                }],
            },
        });
        expect(friendly).to.match(/Bash/i);
        expect(friendly).to.not.equal(localizeGenericAgentFailureMessage('failed', 1));
    });

    it('resolveAgentTurnFailureTechnicalContent prefers failed tool stderr', () => {
        const technical = resolveAgentTurnFailureTechnicalContent({
            role: 'agent',
            content: '',
            error: 'Bash failed: command not found',
            segments: [{
                type: 'tool',
                toolUseId: 't1',
                name: 'Bash',
                args: '{}',
                finished: true,
                result: 'Error: command not found: qaiq',
            }],
        });
        expect(technical).to.equal('Error: command not found: qaiq');
    });
});
