// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Credentials, keychain output and HTTP responses are synthetic; no request leaves the test process.

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapUsageLimitsService, codexWindowLabel, parseRetryAfterMs } from './qaap-usage-limits';
import { QaapUsageScanner } from './qaap-usage-scanner';

const FAKE_TOKEN = 'sk-ant-oat01-synthetic-token-for-tests';

type Limits = Awaited<ReturnType<QaapUsageLimitsService['getLimits']>>;

describe('QaapUsageLimitsService', () => {

    let directory: string;
    let originalFetch: typeof fetch;
    const savedNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-usage-limits-'));
        originalFetch = globalThis.fetch;
        delete process.env.NODE_ENV;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        if (savedNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = savedNodeEnv;
        }
        fs.rmSync(directory, { recursive: true, force: true });
    });

    /** A service on Linux by default, so the real keychain is never read unless a test asks for macOS. */
    /** A scanner whose first scan has already finished and which never reads the real home directory. */
    function completedScanner(): QaapUsageScanner {
        const scanner = new QaapUsageScanner();
        Object.assign(scanner, { hasCompletedScan: () => true, scan: async () => undefined });
        return scanner;
    }

    /**
     * `keychain` is what the fake `security` prints; `null` makes it fail as for a missing item. Commands are
     * recorded in `calls`.
     */
    function serviceWith(credentialsFile: string, options: { platform?: NodeJS.Platform; scanner?: QaapUsageScanner; keychain?: string | null; calls?: string[][]; clock?: { now: number } } = {}): QaapUsageLimitsService {
        const service = new QaapUsageLimitsService();
        Object.assign(service, {
            scanner: options.scanner ?? completedScanner(),
            credentialsFile,
            now: () => options.clock?.now ?? Date.now(),
            platform: () => options.platform ?? 'linux',
        });
        if (options.keychain !== undefined) {
            Object.assign(service, {
                execFileAsync: async (command: string, args: string[]) => {
                    options.calls?.push([command, ...args]);
                    if (options.keychain === null) {
                        throw new Error('The specified item could not be found in the keychain.');
                    }
                    return { stdout: options.keychain };
                },
            });
        }
        return service;
    }

    function claudeOf(limits: Limits): Limits['providers'][number] {
        const claude = limits.providers.find(provider => provider.provider === 'claude');
        if (!claude) {
            throw new Error('no claude entry');
        }
        return claude;
    }

    function keychainPayload(overrides: Record<string, unknown> = {}): string {
        return JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKEN, expiresAt: Date.now() + 3_600_000, ...overrides } });
    }

    function fakeUsageFetch(body: unknown, status = 200): { seen: { url: string; headers: Record<string, string> }[] } {
        const seen: { url: string; headers: Record<string, string> }[] = [];
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            seen.push({ url: String(input), headers: init?.headers as Record<string, string> });
            return new Response(JSON.stringify(body), { status });
        }) as typeof fetch;
        return { seen };
    }

    it('reads Codex windows from the newest rate-limit observation', async () => {
        const scanner = completedScanner();
        scanner.getLedger().set('older.jsonl', {
            size: 0, mtimeMs: 0, offset: 0, context: { fallbackSessionId: 'older' }, entries: new Map(), skipped: 0,
            rateLimits: { observedAtMs: Date.parse('2026-01-01T00:00:00.000Z'), primary: { usedPercent: 90, windowMinutes: 300 } },
        });
        scanner.getLedger().set('newer.jsonl', {
            size: 0, mtimeMs: 0, offset: 0, context: { fallbackSessionId: 'newer' }, entries: new Map(), skipped: 0,
            rateLimits: {
                observedAtMs: Date.parse('2026-01-02T00:00:00.000Z'),
                primary: { usedPercent: 12, windowMinutes: 300, resetsAtMs: Date.parse('2026-01-02T05:00:00.000Z') },
                secondary: { usedPercent: 140, windowMinutes: 10080 },
            },
        });
        const limits = await serviceWith(path.join(directory, 'none.json'), { scanner }).getLimits();
        const codex = limits.providers.find(provider => provider.provider === 'codex');
        expect(codex?.status).to.equal('ok');
        expect(codex?.observedAt).to.equal('2026-01-02T00:00:00.000Z');
        expect(codex?.windows).to.deep.equal([
            { id: 'codex-primary', label: 'Session', usedPercent: 12, resetsAt: '2026-01-02T05:00:00.000Z', windowMinutes: 300 },
            { id: 'codex-secondary', label: 'Weekly', usedPercent: 100, resetsAt: undefined, windowMinutes: 10080 },
        ]);
    });

    it('labels Codex windows by length', () => {
        expect(codexWindowLabel(300)).to.equal('Session');
        expect(codexWindowLabel(10080)).to.equal('Weekly');
        expect(codexWindowLabel(43200)).to.equal('Monthly');
    });

    it('lists only Claude and Codex, without an Antigravity card', async () => {
        const limits = await serviceWith(path.join(directory, 'missing.json')).getLimits();
        expect(limits.providers.map(provider => provider.provider)).to.deep.equal(['claude', 'codex']);
    });

    it('reports Claude as unavailable when neither the file nor the keychain has a session', async () => {
        let called = false;
        globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
        const claude = claudeOf(await serviceWith(path.join(directory, 'missing.json')).getLimits());
        expect(claude).to.deep.equal({ provider: 'claude', status: 'unavailable', reason: 'Sign in to Claude Code on this machine', windows: [] });
        expect(called).to.be.false;
    });

    it('maps the Claude usage response and caches it without leaking the token', async () => {
        const credentials = path.join(directory, '.credentials.json');
        fs.writeFileSync(credentials, keychainPayload());
        const { seen } = fakeUsageFetch({
            five_hour: { utilization: 37.5, resets_at: '2026-01-02T05:00:00Z' },
            seven_day: { utilization: 81, resets_at: '2026-01-08T00:00:00Z' },
        });
        const service = serviceWith(credentials);
        const first = claudeOf(await service.getLimits());
        expect(first.status).to.equal('ok');
        expect(first.windows).to.deep.equal([
            { id: 'session', label: 'Session', usedPercent: 37.5, resetsAt: '2026-01-02T05:00:00.000Z', windowMinutes: 300 },
            { id: 'weekly', label: 'Weekly', usedPercent: 81, resetsAt: '2026-01-08T00:00:00.000Z', windowMinutes: 10080 },
        ]);
        expect(seen).to.have.length(1);
        expect(seen[0].url).to.equal('https://api.anthropic.com/api/oauth/usage');
        expect(seen[0].headers.Authorization).to.equal(`Bearer ${FAKE_TOKEN}`);
        expect(seen[0].headers['anthropic-beta']).to.equal('oauth-2025-04-20');

        await service.getLimits();
        expect(seen).to.have.length(1);
        expect(JSON.stringify(first)).to.not.include(FAKE_TOKEN);
    });

    it('scales fractional utilization to percent only when every value is a fraction', async () => {
        const credentials = path.join(directory, '.credentials.json');
        fs.writeFileSync(credentials, keychainPayload());
        fakeUsageFetch({ five_hour: { utilization: 0.375 }, seven_day: { utilization: 0.81 } });
        const fractional = claudeOf(await serviceWith(credentials).getLimits());
        expect(fractional.windows.map(window => window.usedPercent)).to.deep.equal([37.5, 81]);

        fakeUsageFetch({ five_hour: { utilization: 1 }, seven_day: { utilization: 50 } });
        const percent = claudeOf(await serviceWith(credentials).getLimits());
        expect(percent.windows.map(window => window.usedPercent)).to.deep.equal([1, 50]);
    });

    it('reports a failed Claude request without the token', async () => {
        const credentials = path.join(directory, '.credentials.json');
        fs.writeFileSync(credentials, JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKEN } }));
        globalThis.fetch = (async () => new Response('denied', { status: 401 })) as typeof fetch;
        const claude = claudeOf(await serviceWith(credentials).getLimits());
        expect(claude.status).to.equal('error');
        expect(claude.reason).to.equal('Claude usage request failed (HTTP 401)');
        expect(JSON.stringify(claude)).to.not.include(FAKE_TOKEN);
    });

    it('does not call the network with an expired file token', async () => {
        const credentials = path.join(directory, '.credentials.json');
        fs.writeFileSync(credentials, JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKEN, expiresAt: 1000 } }));
        let called = false;
        globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
        const claude = claudeOf(await serviceWith(credentials).getLimits());
        expect(claude).to.deep.include({ status: 'unavailable', reason: 'Claude Code session expired: open Claude Code to refresh it' });
        expect(called).to.be.false;
    });

    it('reads the macOS keychain with execFile when the file is absent', async () => {
        const calls: string[][] = [];
        const { seen } = fakeUsageFetch({ five_hour: { utilization: 10 } });
        const claude = claudeOf(await serviceWith(path.join(directory, 'missing.json'), { platform: 'darwin', keychain: keychainPayload(), calls }).getLimits());
        expect(claude.status).to.equal('ok');
        expect(calls).to.deep.equal([['security', 'find-generic-password', '-s', 'Claude Code-credentials', '-w']]);
        expect(seen[0].headers.Authorization).to.equal(`Bearer ${FAKE_TOKEN}`);
    });

    it('reports an expired keychain session without calling the usage endpoint', async () => {
        let called = false;
        globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
        const keychain = keychainPayload({ expiresAt: 1000 });
        const claude = claudeOf(await serviceWith(path.join(directory, 'missing.json'), { platform: 'darwin', keychain }).getLimits());
        expect(claude).to.deep.include({ status: 'unavailable', reason: 'Claude Code session expired: open Claude Code to refresh it' });
        expect(called).to.be.false;
    });

    it('reports signed-out when the keychain item is absent', async () => {
        const claude = claudeOf(await serviceWith(path.join(directory, 'missing.json'), { platform: 'darwin', keychain: null }).getLimits());
        expect(claude).to.deep.include({ status: 'unavailable', reason: 'Sign in to Claude Code on this machine' });
    });

    it('never touches the keychain on a hosted runtime', async () => {
        process.env.NODE_ENV = 'production';
        const calls: string[][] = [];
        const claude = claudeOf(await serviceWith(path.join(directory, 'missing.json'), { platform: 'darwin', keychain: keychainPayload(), calls }).getLimits());
        expect(calls).to.have.length(0);
        expect(claude).to.deep.include({ status: 'unavailable', reason: 'Sign in to Claude Code on this machine' });
    });

    it('retries after Retry-After and reports the wait while Anthropic rate-limits', async () => {
        const credentials = path.join(directory, '.credentials.json');
        fs.writeFileSync(credentials, keychainPayload());
        const clock = { now: Date.parse('2026-02-01T00:00:00.000Z') };
        const service = serviceWith(credentials, { clock });
        let calls = 0;
        globalThis.fetch = (async () => {
            calls++;
            return new Response('slow down', { status: 429, headers: { 'retry-after': '120' } });
        }) as typeof fetch;
        const first = claudeOf(await service.getLimits());
        expect(first).to.deep.include({ status: 'unavailable', reason: 'Anthropic is rate-limiting usage checks; retrying in 2 min' });
        expect(calls).to.equal(1);

        clock.now += 60_000;
        claudeOf(await service.getLimits());
        expect(calls).to.equal(1);

        clock.now += 5 * 60_000;
        globalThis.fetch = (async () => {
            calls++;
            return new Response(JSON.stringify({ five_hour: { utilization: 20 } }), { status: 200 });
        }) as typeof fetch;
        expect(claudeOf(await service.getLimits()).status).to.equal('ok');
        expect(calls).to.equal(2);
    });

    it('returns the last good Claude answer with its observedAt while rate-limited', async () => {
        const credentials = path.join(directory, '.credentials.json');
        fs.writeFileSync(credentials, keychainPayload());
        const clock = { now: Date.parse('2026-02-01T00:00:00.000Z') };
        const service = serviceWith(credentials, { clock });
        fakeUsageFetch({ five_hour: { utilization: 30 } });
        const good = claudeOf(await service.getLimits());
        expect(good.observedAt).to.equal('2026-02-01T00:00:00.000Z');

        clock.now += 6 * 60_000;
        globalThis.fetch = (async () => new Response('slow down', { status: 429 })) as typeof fetch;
        const stale = claudeOf(await service.getLimits());
        expect(stale).to.deep.include({ status: 'ok', observedAt: '2026-02-01T00:00:00.000Z' });
        expect(stale.windows).to.deep.equal(good.windows);
    });

    it('sends one request for concurrent limits calls', async () => {
        const credentials = path.join(directory, '.credentials.json');
        fs.writeFileSync(credentials, keychainPayload());
        let calls = 0;
        globalThis.fetch = (async () => {
            calls++;
            await new Promise(resolve => setTimeout(resolve, 10));
            return new Response(JSON.stringify({ five_hour: { utilization: 5 } }), { status: 200 });
        }) as typeof fetch;
        const service = serviceWith(credentials);
        const answers = await Promise.all([service.getLimits(), service.getLimits(), service.getLimits()]);
        expect(calls).to.equal(1);
        expect(answers.every(answer => claudeOf(answer).status === 'ok')).to.be.true;
    });

    it('starts the first log scan from /limits and reports Codex as loading until it finishes', async () => {
        const scanner = new QaapUsageScanner();
        let scans = 0;
        Object.assign(scanner, { hasCompletedScan: () => false, scan: async () => { scans++; } });
        const limits = await serviceWith(path.join(directory, 'missing.json'), { scanner }).getLimits();
        expect(scans).to.equal(1);
        expect(limits.providers.find(provider => provider.provider === 'codex')).to.deep.include({
            status: 'loading', reason: 'Scanning local agent logs…',
        });
    });

    it('reads Retry-After as seconds or as an HTTP date', () => {
        expect(parseRetryAfterMs('90', 0)).to.equal(90_000);
        expect(parseRetryAfterMs('Thu, 01 Jan 1970 00:02:00 GMT', 0)).to.equal(120_000);
        expect(parseRetryAfterMs(undefined as unknown as string, 0)).to.be.undefined;
        expect(parseRetryAfterMs('soon', 0)).to.be.undefined;
    });
});
