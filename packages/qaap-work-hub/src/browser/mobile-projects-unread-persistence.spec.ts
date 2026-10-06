// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { MobileProjectsConversationFlags } from '@theia/qaap-shared-core/lib/browser/mobile-projects-conversation-flags';
import {
    MobileProjectsConversationIndexUi,
    type MobileProjectsConversationIndexHost,
} from '@theia/qaap-shared-core/lib/browser/mobile-projects-conversation-index-ui';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { MobileProjectsUnreadTrackerUi } from './mobile-projects-unread-tracker-ui';

disableImportJSDOM();

/**
 * The read state of a task belongs to the signed-in user, not to the browser tab: it survives
 * opening other tasks, reloads and switching between desktop and phone, and only new agent
 * activity after the read lights the dot again. The backend is faked at the `fetch` boundary.
 */
describe('Work Hub unread state persists per user', () => {

    useSuiteJSDOM();

    /** Server-side read marks, keyed by login then conversation id (server clock). */
    let serverMarks: Map<string, Map<string, number>>;
    let currentUser: string;
    let serverNow: number;
    let originalFetch: typeof globalThis.fetch | undefined;
    let store: Map<string, QaapAgentConversationSummaryDTO>;

    beforeEach(() => {
        window.localStorage.clear();
        serverMarks = new Map();
        currentUser = 'alice';
        serverNow = 1_000;
        store = new Map();
        originalFetch = globalThis.fetch;
        globalThis.fetch = fakeReadMarksServer as typeof globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch as typeof globalThis.fetch;
    });

    async function fakeReadMarksServer(input: unknown, init?: { method?: string; body?: unknown }): Promise<Response> {
        const url = String(input);
        const marks = serverMarks.get(currentUser) ?? new Map<string, number>();
        serverMarks.set(currentUser, marks);
        const match = /\/qaap\/api\/conversation-read-marks(?:\/([^/?]+))?/.exec(url);
        if (!match) {
            return new Response('{}', { status: 404 });
        }
        if ((init?.method ?? 'GET') === 'GET') {
            return new Response(JSON.stringify({ marks: Object.fromEntries(marks) }), { status: 200 });
        }
        const id = decodeURIComponent(match[1]);
        const requested = (JSON.parse(String(init?.body ?? '{}')) as { readAt?: number }).readAt;
        const readAt = Math.max(marks.get(id) ?? 0, Math.min(requested ?? serverNow, serverNow));
        marks.set(id, readAt);
        return new Response(JSON.stringify({ conversationId: id, readAt }), { status: 200 });
    }

    /** `lastAgentActivityAt` is when the agent last wrote; `updatedAt` also moves on PATCHes. */
    function task(id: string, agentActivityAt: number, updatedAt = agentActivityAt): QaapAgentConversationSummaryDTO {
        const summary: QaapAgentConversationSummaryDTO & { lastAgentActivityAt?: number } = {
            id,
            cwd: '/repo',
            agentId: 'codex',
            title: id,
            status: 'idle',
            createdAt: 1,
            updatedAt,
            lastAgentActivityAt: agentActivityAt,
            messageCount: 2,
            lastMessagePreview: 'Done',
            lastMessageRole: 'agent',
        };
        store.set(id, summary);
        return summary;
    }

    interface Device {
        readonly flags: MobileProjectsConversationFlags;
        readonly index: MobileProjectsConversationIndexUi;
        open(id: string): Promise<void>;
        unread(id: string): boolean;
    }

    /** A Work Hub page load (desktop or phone): fresh in-memory state, read marks loaded from the server. */
    async function loadWorkHub(): Promise<Device> {
        const flags = new MobileProjectsConversationFlags();
        await flags.loadReadMarks();
        const index = new MobileProjectsConversationIndexUi({ conversationFlags: flags } as unknown as MobileProjectsConversationIndexHost);
        let openId: string | undefined;
        const tracker = new MobileProjectsUnreadTrackerUi({
            conversationFlags: flags,
            conversations: { findSummaryById: id => store.get(id) },
            get transcriptOpenSummaryId(): string | undefined { return openId; },
            get transcriptOpenSummary(): QaapAgentConversationSummaryDTO | undefined { return openId ? store.get(openId) : undefined; },
            visible: true,
        });
        return {
            flags,
            index,
            async open(id: string): Promise<void> {
                tracker.markOpenConversationClosed();
                openId = id;
                tracker.markConversationOpened(store.get(id)!);
                await flags.flushReadMarks();
            },
            unread: id => index.isConversationUnread(store.get(id)!),
        };
    }

    it('opening task B keeps task A read, even though leaving A saved its composer prefs (PATCH bumps updatedAt)', async () => {
        task('A', 100);
        task('B', 200);
        const desktop = await loadWorkHub();
        expect(desktop.unread('A')).to.equal(true);

        await desktop.open('A');
        expect(desktop.unread('A')).to.equal(false);

        serverNow = 1_100;
        await desktop.open('B');
        // Switching away from A flushes A's composer prefs: the server bumps A.updatedAt, not its agent activity.
        task('A', 100, 1_100);

        expect(desktop.unread('A')).to.equal(false);
        expect(desktop.unread('B')).to.equal(false);
    });

    it('a reload and the phone of the same user both see A and B read', async () => {
        task('A', 100);
        task('B', 200);
        const desktop = await loadWorkHub();
        await desktop.open('A');
        await desktop.open('B');

        const reloaded = await loadWorkHub();
        expect(reloaded.unread('A')).to.equal(false);
        expect(reloaded.unread('B')).to.equal(false);

        // The phone shares nothing with the desktop browser but the account.
        window.localStorage.clear();
        const phone = await loadWorkHub();
        expect(phone.unread('A')).to.equal(false);
        expect(phone.unread('B')).to.equal(false);
    });

    it('new agent activity in A after it was read lights the dot again, everywhere', async () => {
        task('A', 100);
        task('B', 200);
        const desktop = await loadWorkHub();
        await desktop.open('A');
        await desktop.open('B');

        task('A', 2_000);

        expect(desktop.unread('A')).to.equal(true);
        window.localStorage.clear();
        expect((await loadWorkHub()).unread('A')).to.equal(true);
    });

    it('another user on the same browser does not inherit the first user\'s read state', async () => {
        task('A', 100);
        task('B', 200);
        const alice = await loadWorkHub();
        await alice.open('A');
        await alice.open('B');

        currentUser = 'bob';
        const bob = await loadWorkHub();

        expect(bob.unread('A')).to.equal(true);
        expect(bob.unread('B')).to.equal(true);
    });

    it('the mark is the server\'s clock when the task is opened, not a client timestamp', async () => {
        task('A', 100);
        const phone = await loadWorkHub();

        await phone.open('A');

        expect(serverMarks.get('alice')?.get('A')).to.equal(1_000);
    });

    it('imports the legacy browser-wide marks once into the signed-in user\'s marks', async () => {
        task('A', 100);
        task('B', 200);
        window.localStorage.setItem('qaap.mobile.conversation-read', JSON.stringify({ A: 150 }));

        const desktop = await loadWorkHub();
        await desktop.flags.flushReadMarks();

        expect(desktop.unread('A')).to.equal(false);
        expect(desktop.unread('B')).to.equal(true);
        expect(window.localStorage.getItem('qaap.mobile.conversation-read')).to.equal(null);
        expect(serverMarks.get('alice')?.get('A')).to.equal(150);
        currentUser = 'bob';
        expect((await loadWorkHub()).unread('A')).to.equal(true);
    });
});
