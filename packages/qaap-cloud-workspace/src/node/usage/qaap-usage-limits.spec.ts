// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Credentials and HTTP responses are synthetic; no request leaves the test process.

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapUsageLimitsService, codexWindowLabel } from './qaap-usage-limits';
import { QaapUsageScanner } from './qaap-usage-scanner';

const FAKE_TOKEN = 'sk-ant-oat01-synthetic-token-for-tests';

describe('QaapUsageLimitsService', () => {

    let directory: string;
    let originalFetch: typeof fetch;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-usage-limits-'));
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        fs.rmSync(directory, { recursive: true, force: true });
    });

    function serviceWith(scanner: QaapUsageScanner, credentialsFile: string, clock: () => number = () => Date.now()): QaapUsageLimitsService {
        const service = new QaapUsageLimitsService();
        Object.assign(service, { scanner, credentialsFile, now: clock });
        return service;
    }

    function claudeOf(limits: Awaited<ReturnType<QaapUsageLimitsService['getLimits']>>): (typeof limits)['providers'][number] {
        const claude = limits.providers.find(provider => provider.provider === 'claude');
        if (!claude) {
            throw new Error('no claude entry');
        }
        return claude;
    }

    it('reads Codex windows from the newest rate-limit observation', async () => {
        const scanner = new QaapUsageScanner();
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
        const limits = await serviceWith(scanner, path.join(directory, 'none.json')).getLimits();
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

    it('reports Claude as unavailable when no credentials file exists', async () => {
        let called = false;
        globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
        const limits = await serviceWith(new QaapUsageScanner(), path.join(directory, 'missing.json')).getLimits();
        expect(claudeOf(limits)).to.deep.equal({ provider: 'claude', status: 'unavailable', reason: 'Sign in to Claude Code on this machine', windows: [] });
        expect(called).to.be.false;
        expect(limits.providers.map(provider => provider.provider)).to.deep.equal(['claude', 'codex']);
    });

    it('maps the Claude usage response and caches it without leaking the token', async () => {
        const credentials = path.join(directory, '.credentials.json');
        fs.writeFileSync(credentials, JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKEN, expiresAt: Date.now() + 3_600_000 } }));
        const seen: { url: string; headers: Record<string, string> }[] = [];
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            seen.push({ url: String(input), headers: init?.headers as Record<string, string> });
            return new Response(JSON.stringify({
                five_hour: { utilization: 37.5, resets_at: '2026-01-02T05:00:00Z' },
                seven_day: { utilization: 81, resets_at: '2026-01-08T00:00:00Z' },
            }), { status: 200 });
        }) as typeof fetch;
        const service = serviceWith(new QaapUsageScanner(), credentials);
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

    it('reports a failed Claude request without the token', async () => {
        const credentials = path.join(directory, '.credentials.json');
        fs.writeFileSync(credentials, JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKEN } }));
        globalThis.fetch = (async () => new Response('denied', { status: 401 })) as typeof fetch;
        const claude = claudeOf(await serviceWith(new QaapUsageScanner(), credentials).getLimits());
        expect(claude.status).to.equal('error');
        expect(claude.reason).to.equal('Claude usage request failed (HTTP 401)');
        expect(JSON.stringify(claude)).to.not.include(FAKE_TOKEN);
    });

    it('does not call the network with an expired Claude token', async () => {
        const credentials = path.join(directory, '.credentials.json');
        fs.writeFileSync(credentials, JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKEN, expiresAt: 1000 } }));
        let called = false;
        globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
        const claude = claudeOf(await serviceWith(new QaapUsageScanner(), credentials).getLimits());
        expect(claude).to.deep.include({ status: 'unavailable', reason: 'Claude Code sign-in has expired' });
        expect(called).to.be.false;
    });
});
