// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Request, Response } from '@theia/core/shared/express';
import { QaapFrameCheckResult } from '@theia/qaap-adapters/lib/common/qaap-frame-check';
import { QaapFrameCheckEndpoint, QaapFrameCheckResolver } from './qaap-frame-check-endpoint';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';

class TestQaapFrameCheckEndpoint extends QaapFrameCheckEndpoint {
    checked: string[] = [];
    signals: AbortSignal[] = [];
    next: () => Promise<QaapFrameCheckResult> = async () => ({ embeddable: false, reason: 'X-Frame-Options: deny' });
    resolver: QaapFrameCheckResolver | undefined;
    override readonly deadlineMs: number = 50;
    login = 'tester';

    constructor() {
        super();
        (this as unknown as { auth: Partial<QaapGithubAuthGuard> }).auth = {
            authenticate: () => ({ kind: 'skip', userLogin: this.login }),
        } as Partial<QaapGithubAuthGuard>;
    }

    async run(url: string): Promise<QaapFrameCheckResult> {
        let body: QaapFrameCheckResult | undefined;
        const res = {
            status: () => res,
            set: () => res,
            json: (value: QaapFrameCheckResult) => {
                body = value;
                return res;
            },
        };
        await this.handle({ query: { url }, headers: {} } as unknown as Request, res as unknown as Response);
        return body!;
    }

    tokensLeft(login: string): boolean {
        return this.rateLimiter.tryTake(login);
    }

    protected override check(start: URL, appOrigin: string, signal: AbortSignal): Promise<QaapFrameCheckResult> {
        this.checked.push(start.href);
        this.signals.push(signal);
        return this.next();
    }

    resolve(host: string, signal = new AbortController().signal): Promise<string> {
        return this.resolvePublicAddress(host, signal);
    }

    protected override createResolver(): QaapFrameCheckResolver {
        return this.resolver!;
    }
}

function fakeResolver(v4: string[] | Error, v6: string[] | Error, onCancel?: () => void): QaapFrameCheckResolver {
    const answer = (value: string[] | Error): Promise<string[]> => value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    return { resolve4: () => answer(v4), resolve6: () => answer(v6), cancel: () => onCancel?.() };
}

describe('QaapFrameCheckEndpoint', () => {

    const savedEnv = { ...process.env };

    beforeEach(() => {
        process.env.QAAP_OAUTH_PUBLIC_URL = 'https://qaap.example';
        process.env.QAAP_PREVIEW_BASE_DOMAIN = 'preview.qaap.example';
    });

    afterEach(() => {
        process.env = { ...savedEnv };
    });

    it('never fetches Qaap isolated preview hosts and reports them internal and embeddable', async () => {
        const endpoint = new TestQaapFrameCheckEndpoint();
        const result = await endpoint.run('https://0123456789abcdef0123456789abcdef.preview.qaap.example/');
        expect(endpoint.checked).to.deep.equal([]);
        expect(result).to.deep.equal({ embeddable: true, internal: true });
    });

    it('still checks external sites', async () => {
        const endpoint = new TestQaapFrameCheckEndpoint();
        const result = await endpoint.run('https://claude.ai/');
        expect(endpoint.checked).to.deep.equal(['https://claude.ai/']);
        expect(result.embeddable).to.equal(false);
    });

    it('answers unknown (not cached) when the check fails', async () => {
        const endpoint = new TestQaapFrameCheckEndpoint();
        endpoint.next = async () => {
            throw new Error('boom');
        };
        expect(await endpoint.run('https://down.example/')).to.deep.equal({ embeddable: true, unknown: true });
        endpoint.next = async () => ({ embeddable: false });
        expect((await endpoint.run('https://down.example/')).embeddable).to.equal(false);
        expect(endpoint.checked.length).to.equal(2);
    });

    it('aborts the in-flight check at the deadline and frees its concurrency slot', async () => {
        const endpoint = new TestQaapFrameCheckEndpoint();
        endpoint.next = () => new Promise(() => undefined);
        expect(await endpoint.run('https://hang.example/')).to.deep.equal({ embeddable: true, unknown: true });
        expect(endpoint.signals[0].aborted).to.equal(true);
        endpoint.next = async () => ({ embeddable: true });
        expect(await endpoint.run('https://ok.example/')).to.deep.equal({ embeddable: true });
    });

    it('caps concurrent checks per user and answers unknown without checking past the cap', async () => {
        const endpoint = new TestQaapFrameCheckEndpoint();
        endpoint.next = () => new Promise(() => undefined);
        const pending = [1, 2].map(i => endpoint.run(`https://slow${i}.example/`));
        const extra = await endpoint.run('https://extra.example/');
        expect(extra).to.deep.equal({ embeddable: true, unknown: true });
        expect(endpoint.checked).to.not.include('https://extra.example/');
        endpoint.login = 'someone-else';
        endpoint.next = async () => ({ embeddable: true });
        expect(await endpoint.run('https://other.example/'), 'another user still gets a check').to.deep.equal({ embeddable: true });
        await Promise.all(pending);
    });

    it('does not spend a rate-limit token when no concurrency slot is free', async () => {
        const endpoint = new TestQaapFrameCheckEndpoint();
        endpoint.login = 'busy';
        endpoint.next = () => new Promise(() => undefined);
        const pending = [1, 2].map(i => endpoint.run(`https://slow${i}.example/`));
        for (let i = 0; i < 30; i++) {
            await endpoint.run(`https://refused${i}.example/`);
        }
        // 20-token bucket: 2 spent by the running checks, none by the 30 refused requests.
        let left = 0;
        while (endpoint.tokensLeft('busy')) {
            left++;
        }
        expect(left).to.equal(18);
        await Promise.all(pending);
    });

    describe('resolvePublicAddress', () => {
        it('returns a public address resolved with c-ares A/AAAA records', async () => {
            const endpoint = new TestQaapFrameCheckEndpoint();
            endpoint.resolver = fakeResolver(['93.184.215.14'], new Error('ENODATA'));
            expect(await endpoint.resolve('example.com')).to.equal('93.184.215.14');
        });

        it('rejects a host when any A or AAAA record is private (no partial pass)', async () => {
            const endpoint = new TestQaapFrameCheckEndpoint();
            endpoint.resolver = fakeResolver(['93.184.215.14'], ['::ffff:a00:1']);
            await expectRejection(endpoint.resolve('rebind.example'));
            endpoint.resolver = fakeResolver(['10.0.0.1'], []);
            await expectRejection(endpoint.resolve('internal.example'));
            endpoint.resolver = fakeResolver(new Error('ENOTFOUND'), new Error('ENOTFOUND'));
            await expectRejection(endpoint.resolve('missing.example'));
        });

        it('checks IP literals without DNS and cancels the resolver on abort', async () => {
            const endpoint = new TestQaapFrameCheckEndpoint();
            await expectRejection(endpoint.resolve('169.254.169.254'));
            expect(await endpoint.resolve('1.1.1.1')).to.equal('1.1.1.1');
            let cancelled = false;
            const controller = new AbortController();
            endpoint.resolver = {
                resolve4: () => new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('ECANCELLED')))),
                resolve6: () => Promise.resolve([]),
                cancel: () => { cancelled = true; },
            };
            const resolving = endpoint.resolve('slow.example', controller.signal);
            controller.abort();
            await expectRejection(resolving);
            expect(cancelled).to.equal(true);
        });
    });
});

async function expectRejection(promise: Promise<unknown>): Promise<void> {
    let rejected = false;
    try {
        await promise;
    } catch {
        rejected = true;
    }
    expect(rejected).to.equal(true);
}
