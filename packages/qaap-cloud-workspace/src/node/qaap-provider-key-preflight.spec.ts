// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { detectAgentFailureKind } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';
import { maybeRetryTurnWithFallbackModelViaGraphExtracted } from './qaap-agent-conversation-store-thought-brief2';
import { maybeRetryTurnWithFallbackModelExtracted } from './qaap-agent-conversation-store-tool-pills2';
import { QaapProviderKeyFetch, runProviderKeyPreflight, shouldProbeProviderKey } from './qaap-provider-key-preflight';

const FREE_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
const QAIQ_MODEL_ISSUE = JSON.stringify({
    type: 'result',
    is_error: true,
    duration_api_ms: 0,
    error: 'invalid_request',
    result: `There's an issue with the selected model (${FREE_MODEL}). It may not exist or you may not have access to it. `
        + 'Run --model to pick a different model.',
});
const KEY = 'sk-or-v1-secret';

interface FakeCall { url: string; auth?: string; redirect: string }

/** `/key` answers `status`/`body`; the public model catalogue answers `endpoints` (default: one endpoint). */
function fakeFetch(status: number, body?: unknown, endpoints: { status: number; body?: unknown } = { status: 200, body: { data: { endpoints: [{ name: 'x' }] } } }):
    { fetchImpl: QaapProviderKeyFetch; calls: FakeCall[] } {
    const calls: FakeCall[] = [];
    return {
        calls,
        fetchImpl: async (url, init) => {
            calls.push({ url, auth: init.headers.Authorization, redirect: init.redirect });
            return url.endsWith('/endpoints')
                ? { status: endpoints.status, json: async () => endpoints.body }
                : { status, json: async () => body };
        },
    };
}

describe('qaap-provider-key-preflight', () => {
    it('turns the ambiguous QAIQ model error into a rejected-key note on a 401', async () => {
        const { fetchImpl, calls } = fakeFetch(401, { error: { message: 'User not found.', code: 401 } });
        const result = await runProviderKeyPreflight({ log: QAIQ_MODEL_ISSUE, env: { OPENROUTER_API_KEY: KEY }, modelId: FREE_MODEL, fetchImpl });
        expect(calls).to.deep.equal([{ url: 'https://openrouter.ai/api/v1/key', auth: `Bearer ${KEY}`, redirect: 'error' }]);
        expect(result?.verdict).to.equal('key_rejected');
        const note = result?.note;
        expect(note).to.equal('[qaap] provider check: OpenRouter key_rejected (HTTP 401).');
        expect(note).not.to.contain(KEY);
        expect(detectAgentFailureKind(`${QAIQ_MODEL_ISSUE}\n${note}`)).to.equal('provider_key_rejected');
    });

    it('reports no credits on a 402 or an exhausted key limit', async () => {
        expect((await runProviderKeyPreflight({
            log: QAIQ_MODEL_ISSUE, env: { OPENROUTER_API_KEY: KEY }, modelId: FREE_MODEL, fetchImpl: fakeFetch(402).fetchImpl,
        }))?.verdict).to.equal('no_credits');
        expect((await runProviderKeyPreflight({
            log: QAIQ_MODEL_ISSUE, env: { OPENROUTER_API_KEY: KEY }, modelId: FREE_MODEL,
            fetchImpl: fakeFetch(200, { data: { limit: 5, limit_remaining: 0 } }).fetchImpl,
        }))?.verdict).to.equal('no_credits');
    });

    it('blames the privacy setting when a valid key is refused a free model, and nothing for a paid one', async () => {
        const ok = fakeFetch(200, { data: { limit: undefined, limit_remaining: undefined, is_free_tier: true } });
        expect((await runProviderKeyPreflight({ log: QAIQ_MODEL_ISSUE, env: { OPENROUTER_API_KEY: KEY }, modelId: FREE_MODEL, fetchImpl: ok.fetchImpl }))?.note)
            .to.equal('[qaap] provider check: OpenRouter free_model_refused (HTTP 200).');
        // The catalogue lookup is public: same fixed host, no key, no redirects.
        expect(ok.calls[1]).to.deep.equal({
            url: 'https://openrouter.ai/api/v1/models/nvidia/nemotron-3-super-120b-a12b%3Afree/endpoints', auth: undefined, redirect: 'error',
        });
        expect(await runProviderKeyPreflight({
            log: QAIQ_MODEL_ISSUE, env: { OPENROUTER_API_KEY: KEY }, modelId: 'openai/gpt-5.5', fetchImpl: ok.fetchImpl,
        })).to.equal(undefined);
    });

    it('writes no note when the free model is unknown or has no endpoints (Qaap routing or a retired model)', async () => {
        for (const endpoints of [{ status: 404, body: { error: { message: 'Model not found' } } }, { status: 200, body: { data: { endpoints: [] } } }]) {
            const fake = fakeFetch(200, { data: {} }, endpoints);
            expect(await runProviderKeyPreflight({ log: QAIQ_MODEL_ISSUE, env: { OPENROUTER_API_KEY: KEY }, modelId: FREE_MODEL, fetchImpl: fake.fetchImpl }))
                .to.equal(undefined);
        }
    });

    it('never calls a custom base URL, and skips runs without a key or an OpenRouter route', async () => {
        const { fetchImpl, calls } = fakeFetch(401);
        expect(await runProviderKeyPreflight({
            log: QAIQ_MODEL_ISSUE, env: { OPENROUTER_API_KEY: KEY, OPENROUTER_BASE_URL: 'http://169.254.169.254/api/v1' }, modelId: FREE_MODEL, fetchImpl,
        })).to.equal(undefined);
        expect(await runProviderKeyPreflight({ log: QAIQ_MODEL_ISSUE, env: {}, modelId: FREE_MODEL, fetchImpl })).to.equal(undefined);
        expect(await runProviderKeyPreflight({ log: QAIQ_MODEL_ISSUE, env: { OPENROUTER_API_KEY: KEY }, modelId: 'gpt-5.5', fetchImpl })).to.equal(undefined);
        expect(calls).to.have.length(0);
        expect(shouldProbeProviderKey({
            log: QAIQ_MODEL_ISSUE, env: { OPENROUTER_API_KEY: KEY, OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1' }, modelId: FREE_MODEL,
        })).to.equal(true);
    });

    it('does not probe failures that are not about the model or the key', async () => {
        const { fetchImpl, calls } = fakeFetch(401);
        expect(await runProviderKeyPreflight({
            log: 'Error: spawn qaiq ENOENT', env: { OPENROUTER_API_KEY: KEY }, modelId: FREE_MODEL, fetchImpl,
        })).to.equal(undefined);
        expect(calls).to.have.length(0);
    });

    it('swallows network errors and timeouts', async () => {
        const failing: QaapProviderKeyFetch = async () => {
            throw new Error('getaddrinfo ENOTFOUND openrouter.ai');
        };
        expect(await runProviderKeyPreflight({ log: QAIQ_MODEL_ISSUE, env: { OPENROUTER_API_KEY: KEY }, modelId: FREE_MODEL, fetchImpl: failing }))
            .to.equal(undefined);
        const hanging: QaapProviderKeyFetch = (_url, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
        expect(await runProviderKeyPreflight({
            log: QAIQ_MODEL_ISSUE, env: { OPENROUTER_API_KEY: KEY }, modelId: FREE_MODEL, fetchImpl: hanging, timeoutMs: 10,
        })).to.equal(undefined);
    });
});

describe('model fallback after a confirmed provider-key failure', () => {
    // Every model of the agent runs on the same BYOK key: a fallback retry would only fail again.
    for (const verdict of ['key_rejected', 'no_credits'] as const) {
        it(`does not retry with a fallback model when the preflight confirmed ${verdict}`, async () => {
            const task = { id: 't1', state: 'failed', providerKeyVerdict: verdict } as unknown as QaapAgentTask;
            const ctx = {} as unknown as QaapAgentConversationStoreContext;
            expect(maybeRetryTurnWithFallbackModelExtracted(ctx, 'c1', 'u1', 'a1', task, {} as QaapAgentConversation, undefined, 'qaiq')).to.equal(false);
            expect(await maybeRetryTurnWithFallbackModelViaGraphExtracted(ctx, 'c1', 'u1', 'a1', task, {} as QaapAgentConversation, undefined, 'qaiq'))
                .to.equal(false);
        });
    }
});
