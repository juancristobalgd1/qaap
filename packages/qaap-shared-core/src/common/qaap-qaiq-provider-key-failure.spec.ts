// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    describeAgentTurnFailure,
    detectAgentFailureKind,
    extractSelectedModelAccessFailure,
    formatStoredAgentFailureMessage,
    isQaiqProviderKeyMissingFailure,
    localizeQaiqProviderKeyMissingMessage,
    resolveAgentTurnFailureMessage,
} from './qaap-agent-failure-message';
import {
    listByokVendorCredentialEnv,
    findQaiqByokProvider,
    vendorHasByokCredential,
    vendorHasDedicatedByokCredential,
} from './qaap-qaiq-byok-provider-registry';

const MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
const CLI_TEXT = `There's an issue with the selected model (${MODEL}). It may not exist or you may not have access to it. Run --model to pick a different model.`;

/** The production task log (stream-json) of a QAIQ turn with no OpenRouter key, Oct 2026. */
const NO_KEY_LOG = [
    JSON.stringify({ type: 'system', subtype: 'init', model: MODEL, apiKeySource: 'none', tools: [] }),
    JSON.stringify({
        type: 'assistant',
        error: 'invalid_request',
        message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: CLI_TEXT }] },
    }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: CLI_TEXT, usage: { input_tokens: 0, output_tokens: 0 } }),
].join('\n');

describe('QAIQ provider key failures', () => {

    describe('the CLI\'s "issue with the selected model" (provider refused the model)', () => {
        it('keeps the model_unavailable kind so the curated-model fallback still runs', () => {
            expect(detectAgentFailureKind(NO_KEY_LOG)).to.equal('model_unavailable');
        });

        it('names the model and the key/credits/privacy causes instead of a generic error', () => {
            const message = resolveAgentTurnFailureMessage(NO_KEY_LOG, { state: 'failed', exitCode: 1, agentId: 'qaiq' });
            expect(message).to.equal(
                `The model provider refused ${MODEL}. The model may be unavailable or retired at the provider right now, `
                + 'its API key may be missing or invalid, the account may be out of credits, '
                + 'or (for free OpenRouter models) your privacy settings may block it. '
                + 'Pick another model, or check the key in Settings → BYOK.',
            );
            expect(message).to.not.match(/--model/);
        });

        it('rewrites the raw CLI text persisted by older turns and labels it "Model access denied"', () => {
            expect(formatStoredAgentFailureMessage(CLI_TEXT)).to.match(new RegExp(`^The model provider refused ${MODEL.replace(/[.]/g, '\\.')}\\.`));
            const reason = describeAgentTurnFailure(CLI_TEXT);
            expect(reason?.kind).to.equal('model_access');
            expect(reason?.label).to.equal('Model access denied');
            const persisted = resolveAgentTurnFailureMessage(NO_KEY_LOG, { state: 'failed' });
            expect(describeAgentTurnFailure(persisted)?.label).to.equal('Model access denied');
            // Stored English copy re-localizes as itself; the earlier wording keeps its label too.
            expect(formatStoredAgentFailureMessage(persisted)).to.equal(persisted);
            // Its "out of credits" / "API key" wording must not re-classify it as quota or auth.
            expect(detectAgentFailureKind(persisted)).to.equal('model_unavailable');
            expect(describeAgentTurnFailure(`The model provider rejected access to ${MODEL}. Its API key may be missing.`)?.label)
                .to.equal('Model access denied');
        });

        it('yields to a provider key check that explains the same 404 (rejected BYOK key)', () => {
            const withPreflight = `${CLI_TEXT}\n[qaap] provider check: OpenRouter key_rejected (HTTP 401).`;
            expect(detectAgentFailureKind(withPreflight)).to.equal('provider_key_rejected');
            expect(describeAgentTurnFailure(withPreflight)?.kind).to.equal('provider_key');
        });

        it('extracts the model only from that sentence', () => {
            expect(extractSelectedModelAccessFailure(CLI_TEXT)).to.equal(MODEL);
            expect(extractSelectedModelAccessFailure('There was an issue with the selected model.')).to.equal(undefined);
        });
    });

    describe('the runner\'s preflight refusal (no key for the provider)', () => {
        const refusal = localizeQaiqProviderKeyMissingMessage('OpenRouter');

        it('leads with the BYOK fix and offers another agent, never an administrator or a sign-in', () => {
            expect(refusal).to.equal(
                'Add your OpenRouter API key in Settings → BYOK to use QAIQ, pick a model from a provider you have a key for, '
                + 'or pick another agent from the agent chip. '
                + 'Keys are personal: each account adds its own.',
            );
            expect(refusal).to.not.match(/administrator|sign in/i);
            expect(localizeQaiqProviderKeyMissingMessage()).to.match(/^Add an AI provider API key \(for example OpenRouter\) in Settings/);
        });

        it('is the turn\'s failure reason verbatim, labelled "API key needed", not auth or model', () => {
            expect(resolveAgentTurnFailureMessage(`${refusal}\n`, { state: 'failed', exitCode: 1, agentId: 'qaiq' })).to.equal(refusal);
            expect(detectAgentFailureKind(refusal)).to.equal(undefined);
            expect(formatStoredAgentFailureMessage(refusal)).to.equal(refusal);
            expect(describeAgentTurnFailure(refusal)?.label).to.equal('API key needed');
            expect(isQaiqProviderKeyMissingFailure(refusal)).to.equal(true);
            expect(isQaiqProviderKeyMissingFailure(localizeQaiqProviderKeyMissingMessage())).to.equal(true);
            expect(isQaiqProviderKeyMissingFailure(CLI_TEXT)).to.equal(false);
        });
    });

    describe('vendorHasDedicatedByokCredential', () => {
        const noPrefs = (): unknown => undefined;

        it('does not count the OpenAI alias as an OpenRouter key (the lenient check does)', () => {
            const env = (key: string): string | undefined => key === 'OPENAI_API_KEY' ? 'sk-openai' : undefined;
            expect(vendorHasByokCredential(noPrefs, 'openrouter', env)).to.equal(true);
            expect(vendorHasDedicatedByokCredential(noPrefs, 'openrouter', env)).to.equal(false);
            expect(vendorHasDedicatedByokCredential(noPrefs, 'openai', env)).to.equal(true);
        });

        it('counts the Settings key, the vendor env key, or an OpenAI key pointed at the vendor endpoint', () => {
            expect(vendorHasDedicatedByokCredential(key => key === 'ai-features.openrouter.openrouterApiKey' ? 'sk-or' : undefined, 'openrouter'))
                .to.equal(true);
            expect(vendorHasDedicatedByokCredential(noPrefs, 'openrouter', key => key === 'OPENROUTER_API_KEY' ? 'sk-or' : undefined)).to.equal(true);
            const pointed: Record<string, string> = { OPENAI_API_KEY: 'sk-or', OPENAI_BASE_URL: 'https://openrouter.ai/api/v1/' };
            expect(vendorHasDedicatedByokCredential(noPrefs, 'openrouter', key => pointed[key])).to.equal(true);
        });

        it('is undefined for a vendor outside the registry', () => {
            expect(vendorHasDedicatedByokCredential(noPrefs, 'unknown-vendor')).to.equal(undefined);
        });

        it('lists only each vendor\'s own env names', () => {
            expect(listByokVendorCredentialEnv(findQaiqByokProvider('openrouter')!)).to.deep.equal(['OPENROUTER_API_KEY']);
            expect(listByokVendorCredentialEnv(findQaiqByokProvider('openai')!)).to.deep.equal(['OPENAI_API_KEY']);
            expect(listByokVendorCredentialEnv(findQaiqByokProvider('huggingface')!)).to.deep.equal(['HUGGINGFACE_API_KEY', 'HF_TOKEN']);
        });
    });
});
