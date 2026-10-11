// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// ****************************************************************************

import { expect } from 'chai';
import type { QaapProjectSessionSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    patchLocalProjectSession,
    removeLocalProjectSession,
    removeLocalSessionsOfRemovedProjects,
    removeStaleLocalGithubSessions,
} from './mobile-projects-session-cache';

const session = (repoKey: string): QaapProjectSessionSummary => ({
    repoKey,
    branch: 'main',
    lastActiveAt: '2026-08-24T00:00:00.000Z',
});

describe('mobile-projects-session-cache', () => {
    it('removes stale GitHub sessions while preserving local workspace sessions', () => {
        const local = new Map([
            ['github:owner/deleted', session('github:owner/deleted')],
            ['github:owner/kept', session('github:owner/kept')],
            ['ws:file:///workspace/local', session('ws:file:///workspace/local')],
        ]);
        const remote = new Map([
            ['github:OWNER/KEPT', session('github:OWNER/KEPT')],
        ]);

        const result = removeStaleLocalGithubSessions(local, remote);

        expect([...result.keys()]).to.deep.equal([
            'github:owner/kept',
            'ws:file:///workspace/local',
        ]);
        expect(local.has('github:owner/deleted')).to.equal(true);
    });

    it('removes a project key case-insensitively from the browser cache', () => {
        const original = globalThis.localStorage;
        const values = new Map<string, string>([
            ['qaap.mobileProjects.sessionCache.v1', JSON.stringify([
                session('github:Owner/Jderte'),
                session('github:Owner/kept'),
            ])],
        ]);
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => { values.set(key, value); },
            },
        });

        try {
            removeLocalProjectSession('github:owner/jderte');
            const remaining = JSON.parse(values.get('qaap.mobileProjects.sessionCache.v1') ?? '[]') as Array<{ repoKey: string }>;
            expect(remaining.map(row => row.repoKey)).to.deep.equal(['github:Owner/kept']);
        } finally {
            Object.defineProperty(globalThis, 'localStorage', {
                configurable: true,
                value: original,
            });
        }
    });

    // Production (juancristobalgd1, Oct 7 2026): local `recent:`/`ws:` rows of a removed project are never
    // reconciled against the server, so the cached hub list (peekCachedProjects) showed it on every load.
    it('drops path-keyed rows of a project the server reports as removed', () => {
        const clone = 'file:///workspace/repos/users/juancristobalgd1/juancristobalgd1/vyyq';
        const local = new Map([
            [`recent:${clone}`, session(`recent:${clone}`)],
            [`ws:${clone}`, session(`ws:${clone}`)],
            ['github:juancristobalgd1/vyyq', session('github:juancristobalgd1/vyyq')],
            ['ws:file:///workspace/local', session('ws:file:///workspace/local')],
        ]);

        const result = removeLocalSessionsOfRemovedProjects(local, new Set(['github:juancristobalgd1/vyyq']));

        expect([...result.keys()]).to.deep.equal(['ws:file:///workspace/local']);
    });
});

describe('mobile-projects-session-cache activity ordering', () => {
    const cacheKey = 'qaap.mobileProjects.sessionCache.v1';
    let original: Storage;
    let values: Map<string, string>;

    beforeEach(() => {
        original = globalThis.localStorage;
        values = new Map([[cacheKey, JSON.stringify([{ ...session('github:acme/shop'), lastTask: 'Fix login', agentState: 'idle' }])]]);
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => { values.set(key, value); },
            },
        });
    });

    afterEach(() => {
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
    });

    const cachedLastActiveAt = (): string | undefined =>
        (JSON.parse(values.get(cacheKey) ?? '[]') as QaapProjectSessionSummary[])[0]?.lastActiveAt;

    it('keeps the cached order when a project is only opened or previewed', () => {
        patchLocalProjectSession({ repoKey: 'github:acme/shop', branch: 'main' });
        patchLocalProjectSession({ repoKey: 'github:acme/shop', branch: 'main', previewUrl: 'https://preview.example/shop' });
        expect(cachedLastActiveAt()).to.equal('2026-08-24T00:00:00.000Z');
    });

    it('moves the project up for new activity such as a new task', () => {
        patchLocalProjectSession({ repoKey: 'github:acme/shop', branch: 'main', lastTask: 'Add checkout' });
        expect(cachedLastActiveAt()).to.not.equal('2026-08-24T00:00:00.000Z');
    });
});
