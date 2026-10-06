// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { MobileProjectsConversationFlags } from '@theia/qaap-shared-core/lib/browser/mobile-projects-conversation-flags';
import { QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID } from '@theia/qaap-shared-core/lib/common/qaap-agents-hub-landing';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { MobileProjectsUnreadTrackerUi, type MobileProjectsUnreadTrackerHost } from './mobile-projects-unread-tracker-ui';

disableImportJSDOM();

/** Sources as checked out on any OS: CRLF working copies must not break the contract regexes. */
function readSource(file: string): string {
    return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

describe('MobileProjectsUnreadTrackerUi', () => {

    useSuiteJSDOM();

    beforeEach(() => {
        window.localStorage.clear();
    });

    function summary(id: string, updatedAt: number): QaapAgentConversationSummaryDTO {
        return {
            id,
            cwd: '/repo',
            agentId: 'codex',
            title: 'Task',
            status: 'idle',
            createdAt: 1,
            updatedAt,
            messageCount: 2,
            lastMessagePreview: 'Done',
            lastMessageRole: 'agent',
        };
    }

    function createTracker(flags: MobileProjectsConversationFlags, openId?: string): MobileProjectsUnreadTrackerUi {
        const host: MobileProjectsUnreadTrackerHost = {
            conversationFlags: flags,
            conversations: { findSummaryById: () => undefined },
            transcriptOpenSummaryId: openId,
            transcriptOpenSummary: undefined,
            visible: true,
        };
        return new MobileProjectsUnreadTrackerUi(host);
    }

    // Reload / cross-device / per-user persistence lives in mobile-projects-unread-persistence.spec.ts:
    // a fresh flags store reading the same browser's localStorage proved nothing about another device
    // or another user, and the mark it checked was `updatedAt`, which leaving a task bumps again.

    it('never records the Agents Hub idle placeholder as read', () => {
        const flags = new MobileProjectsConversationFlags();

        createTracker(flags).markConversationOpened(summary(QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID, 42));

        expect(flags.getLastSeen(QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID)).to.equal(0);
    });

    it('ignores ticks of other conversations', () => {
        const flags = new MobileProjectsConversationFlags();
        const tracker = new MobileProjectsUnreadTrackerUi({
            conversationFlags: flags,
            conversations: { findSummaryById: id => summary(id, 30) },
            transcriptOpenSummaryId: 'conv-1',
            transcriptOpenSummary: undefined,
            visible: true,
        });

        tracker.syncOpenConversationRead('conv-2');

        expect(flags.getLastSeen('conv-2')).to.equal(0);
        expect(flags.getLastSeen('conv-1')).to.equal(0);
    });

    /**
     * Every Work Hub entry that shows a conversation goes through the transcript sheet, which is
     * where the read mark is recorded; nobody else writes read marks.
     */
    describe('entry points', () => {
        const browserDir = path.resolve(__dirname, '../../src/browser');
        const entryPoints = [
            'mobile-projects-conversation-open-ui.ts',
            'mobile-projects-sessions-sidebar-ui-timeline.ts',
            'mobile-projects-background-task-ui.ts',
            'mobile-projects-mission-control-hub-ui.ts',
            'mobile-projects-home-hub-ui.ts',
            'mobile-projects-hub-team-data-ui.ts',
            'mobile-projects-conversation-actions-ui.ts',
            'mobile-projects-work-hub-search-ui.ts',
        ];

        for (const file of entryPoints) {
            it(`${file} opens conversations through the transcript sheet`, () => {
                const source = readSource(path.join(browserDir, file));
                expect(source).to.contain('transcriptSheetUi.openTranscriptSheet(');
            });
        }

        it('the transcript sheet and the Agents Hub inline transcript report opens and closes', () => {
            const sheet = readSource(path.join(browserDir, 'mobile-projects-transcript-sheet-ui.ts'));
            const inline = readSource(path.join(browserDir, 'mobile-projects-agents-hub-inline-ui.ts'));
            expect(sheet).to.match(/async openTranscriptSheet\([^)]*\): Promise<void> \{[^}]*unreadTrackerUi\?\.markConversationOpened\(summary\)/);
            expect(sheet).to.match(/closeTranscriptSheet\(\): void \{\s*this\.host\.unreadTrackerUi\?\.markOpenConversationClosed\(\);/);
            expect(inline).to.match(/async openAgentsHubInlineTranscript\([^)]*\): Promise<void> \{\s*this\.host\.unreadTrackerUi\?\.markConversationOpened\(summary\);/);
            expect(inline).to.match(/closeAgentsHubSession\(\): void \{\s*this\.host\.unreadTrackerUi\?\.markOpenConversationClosed\(\);/);
        });

        it('the unread dot keeps clear space before the title on every surface', () => {
            const styleDir = path.join(browserDir, 'style');
            const workHubCss = readSource(path.join(styleDir, 'mobile-workbench-work-hub.css'));
            const sidebarCss = readSource(path.join(styleDir, 'qaap-work-hub-sessions-sidebar.css'));
            const dotRule = /\.theia-mod-unread-reply \.theia-mobile-projects-task-title-row::before \{([^}]*)\}/.exec(workHubCss)?.[1] ?? '';
            // Spacing comes from the dot itself, net of whatever gap the surface's title row uses.
            expect(dotRule).to.contain('margin-right: calc(var(--qaap-unread-dot-space) - var(--qaap-task-title-row-gap, 8px));');
            expect(workHubCss).to.match(/--qaap-unread-dot-space: 10px;/);
            // The compact sidebar row has no gap: it must declare it so the dot never overlaps the title.
            expect(sidebarCss).to.match(/sidebar-list \.theia-mobile-projects-task-title-row \{\s*--qaap-task-title-row-gap: 0px;/);
            expect(sidebarCss).to.match(/--qaap-unread-dot-space: 8px;/);
        });

        it('only the unread tracker writes read marks', () => {
            const offenders = fs.readdirSync(browserDir)
                .filter(file => file.endsWith('.ts') && !file.endsWith('.spec.ts') && file !== 'mobile-projects-unread-tracker-ui.ts')
                .filter(file => /\.markRead\(/.test(readSource(path.join(browserDir, file))));
            expect(offenders).to.deep.equal([]);
        });
    });
});
