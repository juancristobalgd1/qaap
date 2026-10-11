// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import {
    QAAP_WORK_HUB_OPEN_TASK_KEY,
    forgetWorkHubOpenTask,
    peekWorkHubOpenTask,
    rememberWorkHubOpenTask,
    restoreWorkHubOpenTask,
    type QaapWorkHubOpenTaskRestoreTarget,
} from './qaap-work-hub-open-task-restore';

describe('qaap-work-hub-open-task-restore', () => {
    const values = new Map<string, string>();
    let original: Storage | undefined;
    const project = { id: 'github:acme/shop', name: 'shop' } as MobileProjectEntry;
    const summary = { id: 'conv-b', title: 'Task B' } as QaapAgentConversationSummaryDTO;

    beforeEach(() => {
        values.clear();
        original = (globalThis as { sessionStorage?: Storage }).sessionStorage;
        Object.defineProperty(globalThis, 'sessionStorage', {
            configurable: true,
            value: {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => { values.set(key, value); },
                removeItem: (key: string) => { values.delete(key); },
            },
        });
    });

    afterEach(() => {
        Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: original });
    });

    function target(overrides: Partial<QaapWorkHubOpenTaskRestoreTarget> = {}): QaapWorkHubOpenTaskRestoreTarget & { opened: string[] } {
        const opened: string[] = [];
        return {
            opened,
            projects: () => [project],
            findSummary: id => id === summary.id ? summary : undefined,
            isStillWanted: () => true,
            open: async (_project, opening) => { opened.push(opening.id); },
            ...overrides,
        };
    }

    it('remembers the open task for this tab only (sessionStorage)', () => {
        rememberWorkHubOpenTask(project.id, summary.id);
        expect(peekWorkHubOpenTask()).to.deep.equal({ projectId: project.id, conversationId: summary.id });
        expect(values.has(QAAP_WORK_HUB_OPEN_TASK_KEY)).to.equal(true);
        forgetWorkHubOpenTask();
        expect(peekWorkHubOpenTask()).to.equal(undefined);
    });

    it('reopens the task that was open before the reload instead of "Ready when you are"', async () => {
        const restore = target();
        const restored = await restoreWorkHubOpenTask({ projectId: project.id, conversationId: summary.id }, restore, 1000);
        expect(restored).to.equal(true);
        expect(restore.opened).to.deep.equal(['conv-b']);
    });

    it('waits for the task list to load after the reload', async () => {
        let loaded = false;
        setTimeout(() => { loaded = true; }, 50);
        const restore = target({ findSummary: id => loaded && id === summary.id ? summary : undefined });
        const restored = await restoreWorkHubOpenTask({ projectId: project.id, conversationId: summary.id }, restore, 2000);
        expect(restored).to.equal(true);
        expect(restore.opened).to.deep.equal(['conv-b']);
    });

    it('stays on the empty state and forgets a task that no longer exists', async () => {
        rememberWorkHubOpenTask(project.id, 'deleted');
        const restore = target();
        const restored = await restoreWorkHubOpenTask({ projectId: project.id, conversationId: 'deleted' }, restore, 0);
        expect(restored).to.equal(false);
        expect(restore.opened).to.deep.equal([]);
        expect(peekWorkHubOpenTask()).to.equal(undefined);
    });

    it('does not reopen an archived task', async () => {
        const restore = target({ findSummary: () => ({ ...summary, archived: true }) });
        expect(await restoreWorkHubOpenTask({ projectId: project.id, conversationId: summary.id }, restore, 1000)).to.equal(false);
        expect(restore.opened).to.deep.equal([]);
    });

    it('never overrides a task the user opened while the lists were loading', async () => {
        const restore = target({ isStillWanted: () => false });
        expect(await restoreWorkHubOpenTask({ projectId: project.id, conversationId: summary.id }, restore, 1000)).to.equal(false);
        expect(restore.opened).to.deep.equal([]);
    });
});
