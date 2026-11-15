// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_GITHUB_DEVICE_MAX_LIVE_FLOWS, QaapGithubDeviceFlowError, QaapGithubDeviceFlows } from './qaap-github-device-flow';

describe('QaapGithubDeviceFlows', () => {
    const originalFetch = globalThis.fetch;
    let now: number;
    let calls: string[];
    let replies: Array<Record<string, unknown>>;

    beforeEach(() => {
        now = 1_000_000;
        calls = [];
        replies = [];
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            calls.push(String(input));
            const body = replies.shift() ?? { error: 'unexpected' };
            return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    const startReply = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
        device_code: 'DEVICE-SECRET',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
        ...overrides,
    });

    it('returns an opaque flow id and never the device code', async () => {
        const flows = new QaapGithubDeviceFlows(() => now);
        replies.push(startReply());
        const start = await flows.start('client-1');
        expect(JSON.stringify(start)).to.not.include('DEVICE-SECRET');
        expect(start).to.deep.include({ userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', interval: 5, expiresIn: 900 });
        expect(start.flowId).to.match(/^[0-9a-f-]{36}$/);
        expect(calls).to.deep.equal(['https://github.com/login/device/code']);
    });

    it('answers pending without calling GitHub when the client polls before the interval', async () => {
        const flows = new QaapGithubDeviceFlows(() => now);
        replies.push(startReply());
        const { flowId } = await flows.start('client-1');
        const callsAfterStart = calls.length;
        now += 4_000;
        expect(await flows.poll(flowId)).to.deep.equal({ status: 'pending', interval: 5 });
        expect(calls.length).to.equal(callsAfterStart);
    });

    it('keeps polling after authorization_pending and returns the token on success', async () => {
        const flows = new QaapGithubDeviceFlows(() => now);
        replies.push(startReply());
        const { flowId } = await flows.start('client-1');
        now += 5_000;
        replies.push({ error: 'authorization_pending' });
        expect(await flows.poll(flowId)).to.deep.equal({ status: 'pending', interval: 5 });
        now += 5_000;
        replies.push({ access_token: 'gho_TOKEN' });
        expect(await flows.poll(flowId)).to.deep.equal({ status: 'complete', accessToken: 'gho_TOKEN' });
        expect(calls[calls.length - 1]).to.equal('https://github.com/login/oauth/access_token');
        // A finished flow is removed: a second poll is expired, not a second token exchange.
        expect(await flows.poll(flowId)).to.deep.equal({ status: 'expired' });
        expect(flows.size).to.equal(0);
    });

    it('adds five seconds to the interval on slow_down', async () => {
        const flows = new QaapGithubDeviceFlows(() => now);
        replies.push(startReply());
        const { flowId } = await flows.start('client-1');
        now += 5_000;
        replies.push({ error: 'slow_down' });
        expect(await flows.poll(flowId)).to.deep.equal({ status: 'pending', interval: 10 });
        now += 5_000;
        // Still inside the new 10 s interval: no GitHub call.
        const callsBefore = calls.length;
        expect(await flows.poll(flowId)).to.deep.equal({ status: 'pending', interval: 10 });
        expect(calls.length).to.equal(callsBefore);
    });

    it('ends the flow with expired when GitHub reports expired_token', async () => {
        const flows = new QaapGithubDeviceFlows(() => now);
        replies.push(startReply());
        const { flowId } = await flows.start('client-1');
        now += 5_000;
        replies.push({ error: 'expired_token' });
        expect(await flows.poll(flowId)).to.deep.equal({ status: 'expired' });
        expect(flows.size).to.equal(0);
    });

    it('ends the flow with denied when the user refuses access', async () => {
        const flows = new QaapGithubDeviceFlows(() => now);
        replies.push(startReply());
        const { flowId } = await flows.start('client-1');
        now += 5_000;
        replies.push({ error: 'access_denied' });
        expect(await flows.poll(flowId)).to.deep.equal({ status: 'denied' });
        expect(flows.size).to.equal(0);
    });

    it('reports an unexpected GitHub error with its description and drops the flow', async () => {
        const flows = new QaapGithubDeviceFlows(() => now);
        replies.push(startReply());
        const { flowId } = await flows.start('client-1');
        now += 5_000;
        replies.push({ error: 'incorrect_client_credentials', error_description: 'The client_id is incorrect.' });
        let error: unknown;
        try {
            await flows.poll(flowId);
        } catch (err) {
            error = err;
        }
        expect(error).to.be.instanceOf(QaapGithubDeviceFlowError);
        expect((error as Error).message).to.equal('The client_id is incorrect.');
        expect(flows.size).to.equal(0);
    });

    it('drops the oldest flow when more than the live limit are started', async () => {
        const flows = new QaapGithubDeviceFlows(() => now);
        const ids: string[] = [];
        for (let i = 0; i <= QAAP_GITHUB_DEVICE_MAX_LIVE_FLOWS; i++) {
            replies.push(startReply({ device_code: `DEVICE-${i}` }));
            ids.push((await flows.start('client-1')).flowId);
        }
        expect(flows.size).to.equal(QAAP_GITHUB_DEVICE_MAX_LIVE_FLOWS);
        now += 5_000;
        expect(await flows.poll(ids[0])).to.deep.equal({ status: 'expired' });
        replies.push({ access_token: 'gho_LATEST' });
        expect(await flows.poll(ids[ids.length - 1])).to.deep.equal({ status: 'complete', accessToken: 'gho_LATEST' });
    });

    it('purges a flow once its lifetime has passed, without calling GitHub', async () => {
        const flows = new QaapGithubDeviceFlows(() => now);
        replies.push(startReply({ expires_in: 60 }));
        const { flowId, expiresIn } = await flows.start('client-1');
        expect(expiresIn).to.equal(60);
        now += 61_000;
        const callsBefore = calls.length;
        expect(await flows.poll(flowId)).to.deep.equal({ status: 'expired' });
        expect(calls.length).to.equal(callsBefore);
    });

    it('caps a long GitHub lifetime at fifteen minutes', async () => {
        const flows = new QaapGithubDeviceFlows(() => now);
        replies.push(startReply({ expires_in: 86_400 }));
        expect((await flows.start('client-1')).expiresIn).to.equal(900);
    });
});
