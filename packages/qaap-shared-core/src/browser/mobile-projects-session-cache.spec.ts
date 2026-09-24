// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// ****************************************************************************

import { expect } from 'chai';
import type { QaapProjectSessionSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    removeLocalProjectSession,
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
});
