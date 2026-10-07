// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { MobileWorkHubSessionsSidebar } from './mobile-work-hub-sessions-sidebar';
import {
    beginSessionsSidebarConversationActivationExtracted,
    rememberSessionsSidebarListFingerprintExtracted,
    shouldDeferSessionsSidebarListRefreshExtracted,
    shouldSkipSessionsSidebarListRenderExtracted,
    stampSessionsSidebarRowFingerprintsExtracted,
    tryPatchSessionsSidebarListExtracted,
} from './mobile-projects-sessions-sidebar-ui-render';
import { QAAP_SESSIONS_SIDEBAR_ROW_FP_ATTR } from '../common/qaap-work-hub-sessions-sidebar-fingerprint';
import { SESSIONS_SIDEBAR_INTERACTION_GUARD_MS } from './mobile-projects-sessions-sidebar-ui';
import type { MobileProjectsSessionsSidebarUiContext } from './mobile-projects-sessions-sidebar-ui-context';
import type { SessionsSidebarConversationEntry } from './mobile-projects-sessions-sidebar-ui';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

disableImportJSDOM();

/**
 * Drives the real sidebar widget through the real refresh/patch/skip/defer decisions with a
 * minimal row model (status + unread dot), with an asynchronous requestAnimationFrame like a
 * browser. Regressions here are what kept prod rows stale until a reload.
 */
// Quarantined flaky test (see ops/flaky.md): runs only with QAAP_RUN_QUARANTINED=1.
const itQuarantined = process.env.QAAP_RUN_QUARANTINED === '1' ? it : it.skip;

describe('mobile-work-hub-sessions-sidebar live sync', function (): void {
    this.timeout(10_000);

    interface RowState { status: string; unread: boolean }

    let disableJSDOM: (() => void) | undefined;
    let stopped = false;

    before(() => {
        disableJSDOM = enableJSDOM();
        try {
            FrontendApplicationConfigProvider.get();
        } catch {
            // Another spec in the same mocha run may already have set it on the shared jsdom window.
            FrontendApplicationConfigProvider.set({ applicationName: 'Qaap' });
        }
    });

    after(() => {
        disableJSDOM?.();
    });

    beforeEach(() => {
        stopped = false;
        document.body.innerHTML = '';
        window.requestAnimationFrame = ((callback: FrameRequestCallback): number =>
            setTimeout(() => callback(Date.now()), 16) as unknown as number) as typeof window.requestAnimationFrame;
        window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof window.cancelAnimationFrame;
    });

    afterEach(async () => {
        // Let any pending deferral loop run one last time and end.
        stopped = true;
        await wait(300);
    });

    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

    /**
     * Polls until the assertion block passes or the deadline expires. Fixed sleeps sized to the tap
     * guard flaked on slow CI runners, where timers fire late; this waits for the real settle instead.
     */
    async function eventually(assertion: () => void, timeoutMs: number = SESSIONS_SIDEBAR_INTERACTION_GUARD_MS + 4000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            try {
                assertion();
                return;
            } catch (error) {
                if (Date.now() >= deadline) {
                    throw error;
                }
                await wait(50);
            }
        }
    }

    function createHarness(initial: Record<string, RowState>): {
        sidebar: MobileWorkHubSessionsSidebar;
        ctx: MobileProjectsSessionsSidebarUiContext;
        model: Map<string, RowState>;
        host: { transcriptOpenSummaryId: string | undefined };
        row: (id: string) => HTMLElement;
    } {
        const model = new Map(Object.entries(initial));
        const project = { id: 'p', name: 'p' } as MobileProjectEntry;
        const host = { transcriptOpenSummaryId: undefined as string | undefined };
        const summaryOf = (id: string): QaapAgentConversationSummaryDTO => ({ id, status: model.get(id)!.status } as QaapAgentConversationSummaryDTO);
        const entries = (): SessionsSidebarConversationEntry[] =>
            [...model.keys()].map(id => ({ project, summary: summaryOf(id), pinned: false, parentIds: new Set<string>() }));
        const paintRow = (row: HTMLElement, id: string): void => {
            const state = model.get(id)!;
            row.dataset.status = state.status;
            row.classList.toggle('theia-mod-unread-reply', state.unread);
            row.classList.toggle('theia-mod-current', host.transcriptOpenSummaryId === id);
        };
        const ctx = {
            clearFailedModeProjectId: undefined,
            sessionsSidebarListFingerprint: '',
            sessionsSidebarOpeningConversationId: undefined,
            sessionsSidebarOpeningTimer: undefined,
            sessionsSidebarInteractionUntil: 0,
            sessionsSidebarLastStreamRefreshAt: 0,
            isSessionsSidebarInteractionGuardActive: () => Date.now() < ctx.sessionsSidebarInteractionUntil,
            buildSessionsSidebarStructureFingerprint: () => `${[...model.keys()].join(',')}|${host.transcriptOpenSummaryId ?? ''}`,
            collectSessionsSidebarConversationEntries: entries,
            buildSidebarRowFingerprint: (entry: SessionsSidebarConversationEntry) => {
                const state = model.get(entry.summary.id)!;
                return `${state.status}:${state.unread}:${host.transcriptOpenSummaryId === entry.summary.id}`;
            },
            stampSessionsSidebarRowFingerprints: (listHost: HTMLElement) => stampSessionsSidebarRowFingerprintsExtracted(ctx, listHost),
            beginSessionsSidebarConversationActivation: (id: string) => beginSessionsSidebarConversationActivationExtracted(ctx, id),
            host: {
                get transcriptOpenSummaryId(): string | undefined { return host.transcriptOpenSummaryId; },
                conversationIndexUi: { summaryToTaskView: () => ({}), activeInfoForProject: () => undefined },
                projectRowsUi: {
                    patchSidebarCompactTaskRow: (row: HTMLElement, _project: unknown, _task: unknown, summary: QaapAgentConversationSummaryDTO) => {
                        paintRow(row, summary.id);
                        return true;
                    },
                },
            },
        } as unknown as MobileProjectsSessionsSidebarUiContext;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: list => {
                for (const id of model.keys()) {
                    const row = document.createElement('div');
                    row.className = 'theia-mobile-projects-task-row theia-mod-sidebar-compact';
                    row.dataset.qaapConversationId = id;
                    paintRow(row, id);
                    list.append(row);
                }
            },
            shouldSkipSessionListRefresh: () => shouldSkipSessionsSidebarListRenderExtracted(ctx),
            tryPatchSessionList: list => tryPatchSessionsSidebarListExtracted(ctx, list),
            rememberSessionListFingerprint: list => rememberSessionsSidebarListFingerprintExtracted(ctx, list),
            shouldDeferSessionListRefresh: () => !stopped && shouldDeferSessionsSidebarListRefreshExtracted(ctx),
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        const row = (id: string): HTMLElement => sidebar.node.querySelector<HTMLElement>(`[data-qaap-conversation-id="${id}"]`)!;
        sidebar.refreshList({ force: true });
        return { sidebar, ctx, model, host, row };
    }

    it('a task that finishes in the background repaints its status and unread dot', async () => {
        const { sidebar, model, row } = createHarness({
            a: { status: 'streaming', unread: false },
            b: { status: 'idle', unread: false },
        });
        // Live stream ticks for A schedule refreshes, as the thread-store subscription does.
        sidebar.scheduleRefreshList();
        await wait(100);
        model.set('a', { status: 'idle', unread: true });
        sidebar.scheduleRefreshList();
        await eventually(() => {
            expect(row('a').dataset.status).to.equal('idle');
            expect(row('a').classList.contains('theia-mod-unread-reply')).to.equal(true);
        });
    });

    itQuarantined('opening A and then B clears the dot on A once the open settles, with no further events', async () => {
        const { sidebar, ctx, model, host, row } = createHarness({
            a: { status: 'idle', unread: true },
            b: { status: 'idle', unread: false },
        });
        // Open A from the sidebar: the read mark is saved.
        ctx.beginSessionsSidebarConversationActivation('a');
        host.transcriptOpenSummaryId = 'a';
        model.set('a', { status: 'idle', unread: false });
        sidebar.refreshList();
        await wait(SESSIONS_SIDEBAR_INTERACTION_GUARD_MS + 400);
        // Then B.
        ctx.beginSessionsSidebarConversationActivation('b');
        host.transcriptOpenSummaryId = 'b';
        sidebar.refreshList();
        await eventually(() => {
            expect(row('a').classList.contains('theia-mod-unread-reply')).to.equal(false);
            expect(row('a').classList.contains('theia-mod-current')).to.equal(false);
            expect(row('b').classList.contains('theia-mod-current')).to.equal(true);
        });
    });

    it('an update that lands during a tap is applied when the tap guard expires', async () => {
        const { sidebar, ctx, model, row } = createHarness({
            a: { status: 'streaming', unread: false },
        });
        ctx.sessionsSidebarInteractionUntil = Date.now() + SESSIONS_SIDEBAR_INTERACTION_GUARD_MS;
        model.set('a', { status: 'idle', unread: true });
        sidebar.refreshList();
        await eventually(() => {
            expect(row('a').dataset.status).to.equal('idle');
            expect(row('a').classList.contains('theia-mod-unread-reply')).to.equal(true);
        });
    });

    it('the patch path never reports success or stamps row fingerprints while the tap guard blocks it', () => {
        const { ctx, model, row } = createHarness({
            a: { status: 'streaming', unread: false },
        });
        const list = row('a').parentElement!;
        ctx.sessionsSidebarInteractionUntil = Date.now() + SESSIONS_SIDEBAR_INTERACTION_GUARD_MS;
        const before = row('a').getAttribute(QAAP_SESSIONS_SIDEBAR_ROW_FP_ATTR);
        model.set('a', { status: 'idle', unread: true });

        expect(tryPatchSessionsSidebarListExtracted(ctx, list)).to.equal(false);
        expect(row('a').getAttribute(QAAP_SESSIONS_SIDEBAR_ROW_FP_ATTR)).to.equal(before);
    });
});
