// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    describeAgentTurnFailure,
    detectAgentFailureKind,
    extractRetiredModelId,
    detectAgentFailureProviderLabel,
    extractAgentLogFailureHint,
    formatProviderPreflightNote,
    extractLastFailedToolFromMessage,
    formatStoredAgentFailureMessage,
    localizeAgentFailureMessage,
    localizeAgentFailureShortReason,
    localizeGenericAgentFailureMessage,
    localizeMissingCodingAgentMessage,
    localizeRetiredModelMessage,
    resolveAgentTurnFailureMessage,
    resolveAgentTurnFailureTechnicalContent,
    summarizeCollapsedAgentFailure,
} from './qaap-agent-failure-message';
import { rememberQaapHostedRuntime } from './qaap-hosted-agent-auth-policy';
import {
    CODEX_MODEL_NOT_SUPPORTED_LOG,
    CODEX_USAGE_LIMIT_LOG,
    NVIDIA_MODEL_END_OF_LIFE_LOG,
    PROVIDER_ENDPOINT_404_LOG,
} from './test/qaap-agent-failure-log-fixtures';

describe('qaap-agent-failure-message', () => {
    it('asks a sign-in harness to sign in when its provider rejects an API key; QAIQ keeps the Settings copy', () => {
        const codexLog = 'unexpected status 401 Unauthorized: Incorrect API key provided: sk-proj-***dUA';
        const codex = resolveAgentTurnFailureMessage(codexLog, { state: 'failed', agentId: 'codex' });
        expect(codex).to.match(/needs you to sign in/i);
        expect(codex).not.to.match(/401|sk-proj|API key/i);
        expect(resolveAgentTurnFailureMessage(codexLog, { state: 'failed', agentId: 'qaiq' })).to.match(/Check your API key in Settings/);
    });

    afterEach(() => {
        rememberQaapHostedRuntime(false);
    });

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
        expect(detectAgentFailureKind('command not found: cursor-agent'))
            .to.equal('cli_missing');
        expect(detectAgentFailureKind('bash: /usr/local/bin/openclaude: No such file or directory'))
            .to.equal('cli_missing');
        expect(detectAgentFailureKind('Cannot find the qaiq executable'))
            .to.equal('cli_missing');
    });

    it('classifies the Codex ChatGPT-plan usage limit as quota and keeps its retry time', () => {
        const line = 'You\'ve hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at Nov 19th, 2026 12:56 AM.';
        expect(detectAgentFailureKind(line)).to.equal('quota');
        expect(detectAgentFailureKind(CODEX_USAGE_LIMIT_LOG)).to.equal('quota');
        expect(resolveAgentTurnFailureMessage(CODEX_USAGE_LIMIT_LOG, { state: 'failed', agentId: 'codex' }))
            .to.match(/try again at Nov 19th, 2026 12:56 AM/);
    });

    it('classifies the Codex unsupported-model 404 as model_unavailable', () => {
        const line = '{"error":{"message":"The \'gpt-5.6-sol\' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}}';
        expect(detectAgentFailureKind(line)).to.equal('model_unavailable');
        expect(detectAgentFailureKind(CODEX_MODEL_NOT_SUPPORTED_LOG)).to.equal('model_unavailable');
    });

    it('detectAgentFailureKind classifies the OpenCode free usage limit as quota', () => {
        expect(detectAgentFailureKind(
            'ERROR 2026-10-24T10:00:00 service=session.processor level=ERROR message="stream error" small=false error.error="AI_APICallError: Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go"',
        )).to.equal('quota');
        expect(detectAgentFailureKind('[qaap] OpenCode reported: AI_APICallError: Free usage limit reached.'))
            .to.equal('quota');
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
        // opencode run --format json error event (NamedError shape: { name, data: { message } }).
        expect(extractAgentLogFailureHint(
            '{"type":"error","timestamp":1,"sessionID":"ses_1","error":{"name":"UnknownError","data":{"message":"Unexpected server error err_ded1d204"}}}',
        )).to.equal('Unexpected server error err_ded1d204');
        expect(extractAgentLogFailureHint('info\nError: something went wrong\n'))
            .to.equal('Error: something went wrong');
        expect(extractAgentLogFailureHint(
            'info\nCodex auth is required for gpt-5.5. Set CODEX_API_KEY or run qaiq login.\n',
        )).to.equal('Codex auth is required for gpt-5.5. Set CODEX_API_KEY or run qaiq login.');
        expect(extractAgentLogFailureHint('FIND: formato de par\uFFFDmetros incorrecto'))
            .to.equal('FIND: formato de parmetros incorrecto');
        expect(extractAgentLogFailureHint('The command line is too long.'))
            .to.equal('The command line is too long.');
        expect(extractAgentLogFailureHint('La l\uFFFDnea de comandos es demasiado larga.'))
            .to.equal('La lnea de comandos es demasiado larga.');
    });

    it('summarizeCollapsedAgentFailure falls back to the exit code', () => {
        const generic = localizeGenericAgentFailureMessage('failed', 1);
        expect(summarizeCollapsedAgentFailure({
            formatted: generic,
            generic,
            exitCode: 1,
        })).to.equal('Exit code 1');
    });

    it('summarizeCollapsedAgentFailure shows the Windows FIND line without opening details', () => {
        const generic = localizeGenericAgentFailureMessage('failed', 1);
        expect(summarizeCollapsedAgentFailure({
            formatted: generic,
            generic,
            technicalContent: 'FIND: formato de par\uFFFDmetros incorrecto',
            persistedError: generic,
        })).to.equal('FIND: formato de parmetros incorrecto');
        expect(resolveAgentTurnFailureMessage(
            'FIND: formato de par\uFFFDmetros incorrecto',
            { state: 'failed', exitCode: 1 },
        )).to.match(/FIND: formato de parmetros incorrecto/);
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

    it('localizeMissingCodingAgentMessage does not promote Cursor on hosted', () => {
        expect(localizeMissingCodingAgentMessage()).to.match(/Cursor Agent/);
        rememberQaapHostedRuntime(true);
        const hosted = localizeMissingCodingAgentMessage();
        expect(hosted).to.match(/cloud-ready/i);
        expect(hosted).to.match(/not available here/i);
    });
});

describe('localizeAgentFailureShortReason', () => {
    it('names the persisted sign-in failure', () => {
        expect(localizeAgentFailureShortReason(
            'This agent needs you to sign in before it can continue. Open the agent terminal to complete login, then retry.',
        )).to.equal('Sign in required');
    });

    it('returns undefined only when there is no error', () => {
        expect(localizeAgentFailureShortReason(undefined)).to.equal(undefined);
        expect(localizeAgentFailureShortReason('   ')).to.equal(undefined);
    });

    it('falls back to "stopped unexpectedly" for unclassified failures', () => {
        expect(localizeAgentFailureShortReason('Process exited with code 1')).to.equal('The agent stopped unexpectedly');
    });
});

describe('BYOK provider key failures', () => {
    // Production smoke, Oct 20 2026: QAIQ on `nvidia/nemotron-3-super-120b-a12b:free` (OpenRouter BYOK key)
    // died in 0.9 s without reaching the API and blamed the model.
    const qaiqModelIssueLog = [
        '{"type":"system","subtype":"init","model":"nvidia/nemotron-3-super-120b-a12b:free","tools":[]}',
        JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: true,
            duration_ms: 912,
            duration_api_ms: 0,
            num_turns: 1,
            error: 'invalid_request',
            result: 'There\'s an issue with the selected model (nvidia/nemotron-3-super-120b-a12b:free). '
                + 'It may not exist or you may not have access to it. Run --model to pick a different model.',
        }),
    ].join('\n');

    it('leaves the ambiguous QAIQ model error as a model problem until the provider has been asked', () => {
        expect(detectAgentFailureKind(qaiqModelIssueLog)).to.equal('model_unavailable');
    });

    it('names the rejected OpenRouter key once the runner preflight appended its note', () => {
        const log = `${qaiqModelIssueLog}\n${formatProviderPreflightNote('OpenRouter', 'key_rejected', 401)}\n`;
        expect(detectAgentFailureKind(log)).to.equal('provider_key_rejected');
        const message = resolveAgentTurnFailureMessage(log, { state: 'failed', agentId: 'qaiq' });
        expect(message).to.equal('Your OpenRouter key was rejected. Update it in Settings → BYOK, then retry.');
        expect(message).not.to.match(/model/i);
        const reason = describeAgentTurnFailure(message);
        expect(reason?.kind).to.equal('provider_key');
        expect(reason?.label).to.equal('API key rejected');
    });

    it('reads a valid key on a refused free model as the OpenRouter privacy setting', () => {
        const log = `${qaiqModelIssueLog}\n${formatProviderPreflightNote('OpenRouter', 'free_model_refused', 200)}`;
        expect(detectAgentFailureKind(log)).to.equal('provider_data_policy');
        expect(resolveAgentTurnFailureMessage(log, { state: 'failed', agentId: 'qaiq' }))
            .to.match(/^This OpenRouter free model may be unavailable right now, or your OpenRouter privacy settings block free endpoints\./);
    });

    it('classifies a raw OpenRouter 401 body as a rejected key, not a sign-in', () => {
        const log = 'API Error: 401 {"error":{"message":"No auth credentials found","code":401}} (openrouter.ai)';
        expect(detectAgentFailureKind(log)).to.equal('provider_key_rejected');
        expect(resolveAgentTurnFailureMessage(log, { state: 'failed', agentId: 'qaiq' }))
            .to.equal('Your OpenRouter key was rejected. Update it in Settings → BYOK, then retry.');
        expect(detectAgentFailureKind('API Error: 401 OpenRouter: User not found.')).to.equal('provider_key_rejected');
    });

    it('does not turn a sign-in harness 401 or tool output into a BYOK key failure', () => {
        expect(detectAgentFailureKind('unexpected status 401 Unauthorized: Incorrect API key provided: sk-***'))
            .to.equal('auth');
        expect(detectAgentFailureKind('Error: User not found.')).not.to.equal('provider_key_rejected');
        // "key … revoked" only counts on a line that names a BYOK provider: a deploy key in tool output does not.
        expect(detectAgentFailureKind('git: deploy key has been revoked')).not.to.equal('provider_key_rejected');
        expect(detectAgentFailureKind('API Error: 403 OpenRouter: API key is disabled')).to.equal('provider_key_rejected');
    });

    it('classifies the OpenRouter free-model daily cap (429) as its own limit, not a generic rate limit', () => {
        const log = 'API Error: 429 {"error":{"message":"Rate limit exceeded: free-models-per-day. '
            + 'Add 10 credits to unlock 1000 free model requests per day","code":429}} openrouter';
        expect(detectAgentFailureKind(log)).to.equal('provider_free_limit');
        const message = resolveAgentTurnFailureMessage(log, { state: 'failed', agentId: 'qaiq' });
        expect(message).to.match(/^OpenRouter free-model limit reached\./);
        expect(describeAgentTurnFailure(message)?.kind).to.equal('usage_limit');
    });

    it('names OpenRouter when the free-tier 429 only says so in limit_source (production QAIQ log)', () => {
        const log = 'API Error: 429 {"error":{"message":"Rate limit exceeded: free-models-per-day. ","code":429,'
            + '"metadata":{"headers":{"X-RateLimit-Limit":"50","X-RateLimit-Remaining":"0"},'
            + '"limit_source":"openrouter_free_tier_daily","remedy_hint":"Wait for the daily reset or purchase credits"}}}';
        expect(detectAgentFailureProviderLabel(log)).to.equal('OpenRouter');
        expect(resolveAgentTurnFailureMessage(log, { state: 'failed', agentId: 'qaiq' }))
            .to.match(/^OpenRouter free-model limit reached\. Wait for the daily reset, add credits with OpenRouter/);
    });

    it('classifies the OpenRouter data-policy 404 and an out-of-credits 402', () => {
        const policy = 'API Error: 404 {"error":{"message":"No endpoints found matching your data policy (Free model publication). '
            + 'Configure: https://openrouter.ai/settings/privacy","code":404}}';
        expect(detectAgentFailureKind(policy)).to.equal('provider_data_policy');
        expect(describeAgentTurnFailure(resolveAgentTurnFailureMessage(policy))?.label).to.equal('Blocked by provider settings');
        const credits = 'API Error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402}}';
        expect(detectAgentFailureKind(credits)).to.equal('provider_credits');
        expect(resolveAgentTurnFailureMessage(credits)).to.match(/^Your OpenRouter key is out of credits\./);
    });

    it('keeps the stored provider copy stable across a reload', () => {
        const stored = localizeAgentFailureMessage('provider_key_rejected', 'OpenRouter');
        expect(formatStoredAgentFailureMessage(stored)).to.equal(stored);
        expect(detectAgentFailureProviderLabel(stored)).to.equal('OpenRouter');
        expect(localizeAgentFailureMessage('provider_key_rejected')).to.equal('Your provider key was rejected. Update it in Settings → BYOK, then retry.');
    });
});

describe('retired model failures', () => {
    const MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1';

    it('turns a raw NVIDIA 410 end-of-life error into a model-retired message naming the model', () => {
        expect(detectAgentFailureKind(NVIDIA_MODEL_END_OF_LIFE_LOG)).to.equal('model_unavailable');
        const message = resolveAgentTurnFailureMessage(NVIDIA_MODEL_END_OF_LIFE_LOG, { state: 'failed', agentId: 'qaiq' });
        expect(message).to.equal(localizeRetiredModelMessage(MODEL));
        expect(message).to.include('no longer available from its provider');
        expect(message).not.to.include('{"status"');
    });

    it('classifies the provider-endpoint 404 as a model the provider no longer serves', () => {
        expect(detectAgentFailureKind(PROVIDER_ENDPOINT_404_LOG)).to.equal('model_unavailable');
        const message = resolveAgentTurnFailureMessage(PROVIDER_ENDPOINT_404_LOG, { state: 'failed', agentId: 'qaiq' });
        expect(message).to.equal(localizeRetiredModelMessage());
        expect(message).to.include('Choose another model');
    });

    it('formats a persisted raw 410 error and labels it "Model unavailable"', () => {
        const persisted = `API Error: 410 {"status":410,"detail":"Model ${MODEL} has reached its end of life."}`;
        expect(formatStoredAgentFailureMessage(persisted)).to.equal(localizeRetiredModelMessage(MODEL));
        const reason = describeAgentTurnFailure(persisted);
        expect(reason?.kind).to.equal('model');
        expect(reason?.label).to.equal('Model unavailable');
    });

    it('keeps reading its own persisted copy as a model failure', () => {
        const stored = localizeRetiredModelMessage(MODEL);
        expect(detectAgentFailureKind(stored)).to.equal('model_unavailable');
        expect(formatStoredAgentFailureMessage(stored)).to.equal(stored);
        expect(describeAgentTurnFailure(stored)?.kind).to.equal('model');
    });

    it('extracts the model id from quoted, unquoted and JSON-escaped provider texts', () => {
        expect(extractRetiredModelId(`The model '${MODEL}' has reached its end of life`)).to.equal(MODEL);
        expect(extractRetiredModelId(`Model ${MODEL} has reached its end of life.`)).to.equal(MODEL);
        expect(extractRetiredModelId(`{"detail":"model \\"${MODEL}\\" is no longer available"}`)).to.equal(MODEL);
        expect(extractRetiredModelId('This model has reached its end of life.')).to.equal(undefined);
    });

    it('does not mistake unrelated 404s, deprecation warnings or other model errors for a retired model', () => {
        expect(detectAgentFailureKind('npm warn deprecated inflight@1.0.6: This module is not supported')).to.equal(undefined);
        expect(detectAgentFailureKind('Error: Request failed with status code 404')).to.not.equal('model_unavailable');
        const selected = 'There\'s an issue with the selected model (deepseek/deepseek-v4-flash:free). It may not exist or you may not have access to it.';
        expect(resolveAgentTurnFailureMessage(selected, { state: 'failed' })).to.include('The model provider refused');
    });
});
