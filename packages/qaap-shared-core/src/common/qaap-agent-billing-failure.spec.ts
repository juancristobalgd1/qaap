// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    describeAgentTurnFailure,
    detectAgentFailureKind,
    extractAgentBillingFailure,
    formatStoredAgentFailureMessage,
    localizeAgentBillingFailureMessage,
    localizeAgentFailureShortReason,
    resolveAgentTurnFailureMessage,
} from './qaap-agent-failure-message';
import { detectAgentAuthFailureMode, extractAgentAuthLoginChallenge } from './qaap-agent-auth-login';
import { parseAgentLogForTranscript, resolveAgentLogDisplayText } from './qaap-cli-transcript-stream';
import { OPENCODE_MODEL_ACCESS_DISABLED_LIVE_LOG } from './test/qaap-agent-failure-log-fixtures';

const WORKSPACE = 'wrk_01KFXW8JT3MNFG0P5H21F14TVD';
const BILLING_URL = `https://opencode.ai/console/${WORKSPACE}/billing?credits=1`;
const MODELS_URL = `https://opencode.ai/console/${WORKSPACE}/models`;

/** OpenCode's title agent (`small=true`) failing on an empty OpenCode Models balance. */
const OPENCODE_TITLE_BALANCE_LINE = 'timestamp=2026-11-25T22:33:03.402Z level=ERROR run=6f18df17 message="stream error" providerID=opencode '
    + 'modelID=gpt-5.4-nano session.id=ses_deb28cb3affeCzWx3xd5Amfmeb small=true agent=title mode=primary '
    + 'error.error="AI_APICallError: Insufficient balance. This request is pay-as-you-go, billed to OpenCode Models credits. '
    + `Top up at ${BILLING_URL}. OpenCode Go covers only requests to the OpenCode Go provider."`;
/** The main turn (`claude-fable-5`) refused because the workspace has the model switched off. */
const OPENCODE_MODEL_ACCESS_LINE = 'timestamp=2026-11-25T22:33:13.809Z level=ERROR run=6f18df17 message="stream error" providerID=opencode '
    + 'modelID=claude-fable-5 session.id=ses_deb28cb3affeCzWx3xd5Amfmeb small=false agent=build mode=primary '
    + `error.error="AI_APICallError: Model access is disabled. Change model access at ${MODELS_URL}."`;
const OPENCODE_PROCESS_LINE = 'timestamp=2026-11-25T22:33:13.838Z level=ERROR run=6f18df17 message=process session.id=ses_deb28cb3affeCzWx3xd5Amfmeb '
    + `messageID=msg_214d748b5001d0XiEG3SkEbWY9 error="Model access is disabled. Change model access at ${MODELS_URL}."`;
/** OpenCode's `--format json` error record for the same refusal: a 403 with a `permission_error` body. */
const OPENCODE_ERROR_RECORD = JSON.stringify({
    type: 'error',
    timestamp: 1795645993878,
    sessionID: 'ses_deb28cb3affeCzWx3xd5Amfmeb',
    error: {
        name: 'APIError',
        data: {
            message: `Model access is disabled. Change model access at ${MODELS_URL}.`,
            statusCode: 403,
            isRetryable: false,
            responseBody: JSON.stringify({ type: 'error', error: { type: 'permission_error', message: `Model access is disabled. Change model access at ${MODELS_URL}.` } }),
            metadata: { url: 'https://opencode.ai/inference/anthropic/v1/messages' },
        },
    },
});

/** The persisted agent message content of the observed failure (desktop app, OpenCode, opencode/claude-fable-5). */
const OBSERVED_OPENCODE_LOG = [OPENCODE_TITLE_BALANCE_LINE, OPENCODE_MODEL_ACCESS_LINE, OPENCODE_PROCESS_LINE, OPENCODE_ERROR_RECORD].join('\n');
/** The same records as the report pasted them: whitespace-collapsed onto one line. */
const OBSERVED_OPENCODE_LOG_ONE_LINE = [OPENCODE_TITLE_BALANCE_LINE, OPENCODE_MODEL_ACCESS_LINE, OPENCODE_PROCESS_LINE].join(' ');

/** The main turn itself failing on the empty balance. */
const OPENCODE_MAIN_BALANCE_LINE = OPENCODE_TITLE_BALANCE_LINE.replace('small=true agent=title', 'small=false agent=build');

const SIGN_IN_COPY = /sign in|Sign-in|log in|login/i;

describe('provider billing failures (no credits, model access disabled)', () => {

    describe('the observed OpenCode turn', () => {
        it('reads as model access disabled, never as a sign-in', () => {
            expect(detectAgentFailureKind(OBSERVED_OPENCODE_LOG)).to.equal('model_access_disabled');
            expect(detectAgentFailureKind(OBSERVED_OPENCODE_LOG_ONE_LINE)).to.equal('model_access_disabled');
        });

        it('says what happened, names OpenCode and links its own model-access page', () => {
            for (const log of [OBSERVED_OPENCODE_LOG, OBSERVED_OPENCODE_LOG_ONE_LINE]) {
                const message = resolveAgentTurnFailureMessage(log, { state: 'failed', exitCode: 1, agentId: 'opencode' });
                expect(message).to.equal(
                    `Access to this model is disabled in your OpenCode account. Enable it at ${MODELS_URL}, or pick another model.`,
                );
                expect(message).not.to.match(SIGN_IN_COPY);
                expect(message).not.to.contain('timestamp=');
            }
        });

        it('labels the row "Model access disabled", not "Sign in required"', () => {
            const persisted = resolveAgentTurnFailureMessage(OBSERVED_OPENCODE_LOG, { state: 'failed', agentId: 'opencode' });
            const reason = describeAgentTurnFailure(persisted);
            expect(reason?.kind).to.equal('model_access_disabled');
            expect(reason?.label).to.equal('Model access disabled');
            expect(localizeAgentFailureShortReason(persisted, { agentLabel: 'OpenCode' })).to.equal('Model access disabled');
            // A raw log persisted verbatim classifies the same way.
            expect(describeAgentTurnFailure(OBSERVED_OPENCODE_LOG_ONE_LINE)?.kind).to.equal('model_access_disabled');
        });

        it('keeps reading as the same failure once persisted and formatted again', () => {
            const persisted = resolveAgentTurnFailureMessage(OBSERVED_OPENCODE_LOG, { state: 'failed', agentId: 'opencode' });
            expect(formatStoredAgentFailureMessage(persisted)).to.equal(persisted);
            expect(detectAgentFailureKind(persisted)).to.equal('model_access_disabled');
        });

        it('offers no sign-in challenge from the provider links', () => {
            expect(extractAgentAuthLoginChallenge(OBSERVED_OPENCODE_LOG, { agentId: 'opencode' })).to.equal(undefined);
            expect(detectAgentAuthFailureMode(OBSERVED_OPENCODE_LOG)).to.equal(undefined);
        });

        it('never draws the --print-logs lines as the agent\'s reply text', () => {
            const parsed = parseAgentLogForTranscript('opencode', OBSERVED_OPENCODE_LOG);
            expect(parsed.segments.filter(segment => segment.type === 'text')).to.deep.equal([]);
            const plain = parseAgentLogForTranscript('opencode', [OPENCODE_TITLE_BALANCE_LINE, OPENCODE_MODEL_ACCESS_LINE, OPENCODE_PROCESS_LINE].join('\n'));
            expect(plain.segments).to.deep.equal([]);
            expect(plain.content).to.equal('');
        });

        it('keeps the raw provider lines as the failed message body, for the card\'s details', () => {
            const body = resolveAgentLogDisplayText('opencode', OBSERVED_OPENCODE_LOG);
            expect(body).to.contain('Model access is disabled');
            expect(body).not.to.contain('"type":"error"');
        });
    });

    describe('the live OpenCode turn (gate note first, runner stop line last)', () => {
        const MODELS_LINK = `https://opencode.ai/console/${WORKSPACE}/models`;

        it('reads as model access disabled with the OpenCode model-access link', () => {
            expect(detectAgentFailureKind(OPENCODE_MODEL_ACCESS_DISABLED_LIVE_LOG)).to.equal('model_access_disabled');
            expect(resolveAgentTurnFailureMessage(OPENCODE_MODEL_ACCESS_DISABLED_LIVE_LOG, { state: 'failed', exitCode: 1, agentId: 'opencode' }))
                .to.equal(`Access to this model is disabled in your OpenCode account. Enable it at ${MODELS_LINK}, or pick another model.`);
        });

        it('has no reply text when stored as the message body and parsed again by the transcript', () => {
            const parsed = parseAgentLogForTranscript('opencode', OPENCODE_MODEL_ACCESS_DISABLED_LIVE_LOG);
            expect(parsed.segments).to.deep.equal([]);
            expect(parsed.content).to.equal('');
        });
    });

    describe('OpenCode Models without balance on the main turn', () => {
        it('reads as credits exhausted with the OpenCode top-up link', () => {
            expect(detectAgentFailureKind(OPENCODE_MAIN_BALANCE_LINE)).to.equal('credits_exhausted');
            expect(extractAgentBillingFailure(OPENCODE_MAIN_BALANCE_LINE)).to.deep.equal({
                kind: 'credits_exhausted',
                providerLabel: 'OpenCode',
                url: BILLING_URL,
            });
            const message = resolveAgentTurnFailureMessage(OPENCODE_MAIN_BALANCE_LINE, { state: 'failed', agentId: 'opencode' });
            expect(message).to.equal(`Your OpenCode account has no credits left. Top up at ${BILLING_URL}, or pick another model.`);
            expect(describeAgentTurnFailure(message)?.label).to.equal('No OpenCode credits left');
        });

        it('ignores the balance error of the title side request alone (the turn itself did not fail on it)', () => {
            expect(detectAgentFailureKind(OPENCODE_TITLE_BALANCE_LINE)).to.equal(undefined);
        });
    });

    describe('other providers', () => {
        it('reads Anthropic "credit balance is too low" as credits exhausted, not as an API-key sign-in', () => {
            const envelope = '{"type":"result","subtype":"success","is_error":true,"result":"Credit balance is too low"}';
            const apiError = 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. '
                + 'Please go to Plans & Billing to upgrade or purchase credits."}}';
            for (const log of [envelope, apiError]) {
                expect(detectAgentFailureKind(log)).to.equal('credits_exhausted');
                const message = resolveAgentTurnFailureMessage(log, { state: 'failed', agentId: 'claude' });
                expect(message).not.to.match(SIGN_IN_COPY);
                expect(describeAgentTurnFailure(message)?.kind).to.equal('credits_exhausted');
            }
            expect(resolveAgentTurnFailureMessage(apiError, { state: 'failed', agentId: 'claude' }))
                .to.equal('Your Anthropic account has no credits left. Add credits with Anthropic, or pick another model.');
        });

        it('keeps OpenAI insufficient_quota and OpenRouter 402 on their existing (non sign-in) kinds', () => {
            const openai = '{"error":{"type":"insufficient_quota","message":"You exceeded your current quota, please check your plan and billing details."}}';
            expect(detectAgentFailureKind(openai)).to.equal('quota');
            expect(describeAgentTurnFailure(resolveAgentTurnFailureMessage(openai, { state: 'failed', agentId: 'codex' }))?.kind).to.equal('usage_limit');
            const openrouter = '402 {"error":{"message":"This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, '
                + 'but can only afford 1000. To increase, visit https://openrouter.ai/settings/credits and upgrade to a paid account","code":402}}';
            expect(detectAgentFailureKind(openrouter)).to.equal('provider_credits');
            expect(resolveAgentTurnFailureMessage(openrouter, { state: 'failed', agentId: 'pi' })).not.to.match(SIGN_IN_COPY);
        });
    });

    describe('provider links', () => {
        it('only links https pages on the provider\'s exact host and billing / model path', () => {
            const spoofed = [
                'Model access is disabled. Change model access at https://opencode.ai.evil.example/console/wrk_1/models.',
                'Model access is disabled. Change model access at http://opencode.ai/console/wrk_1/models.',
                'Model access is disabled. Change model access at https://user:pw@opencode.ai/console/wrk_1/models.',
                'Model access is disabled. Change model access at https://opencode.ai/inference/anthropic/v1/messages.',
                'Model access is disabled. Change model access at https://example.com/console/wrk_1/models.',
            ];
            for (const text of spoofed) {
                const failure = extractAgentBillingFailure(text);
                expect(failure?.kind, text).to.equal('model_access_disabled');
                expect(failure?.url, text).to.equal(undefined);
                expect(resolveAgentTurnFailureMessage(text, { state: 'failed' })).not.to.contain('http');
            }
        });

        it('never puts a model-access link on a credits message or the reverse', () => {
            const text = `AI_APICallError: Insufficient balance. Top up at ${MODELS_URL}.`;
            expect(extractAgentBillingFailure(text)?.url).to.equal(undefined);
        });

        it('falls back to copy without a link or a provider', () => {
            expect(localizeAgentBillingFailureMessage({ kind: 'credits_exhausted' }))
                .to.equal('Your provider account has no credits left. Add credits with the provider, or pick another model.');
            expect(localizeAgentBillingFailureMessage({ kind: 'model_access_disabled', providerLabel: 'OpenCode' }))
                .to.equal('Access to this model is disabled in your OpenCode account. Enable it in your OpenCode settings, or pick another model.');
            expect(describeAgentTurnFailure(localizeAgentBillingFailureMessage({ kind: 'credits_exhausted' }))?.label).to.equal('No credits left');
        });
    });

    it('does not read prose that merely mentions a balance as a billing failure', () => {
        expect(detectAgentFailureKind('Error: insufficient balance in test account fixture')).not.to.equal('credits_exhausted');
        expect(detectAgentFailureKind('I updated the README section about model access.')).to.equal(undefined);
    });
});
