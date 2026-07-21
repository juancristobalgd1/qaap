// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import { MobileProjectsTasksHubUi, type MobileProjectsTasksHubHost } from './mobile-projects-tasks-hub-ui';
import {
    clearWorkingPillStopAllSuppression,
    closeWorkingAgentsPopover,
    forceOrphanedWorkingExpandSessionForTests,
    isWorkingAgentsExpandPinnedOpen,
    isWorkingAgentsExpandSessionOpen,
} from './qaap-sticky-composer-working-agents-popover';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { WorkHubTeamMember } from '../common/qaap-work-hub-team';

describe('MobileProjectsTasksHubUi — working pill', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
        globalThis.AbortController = window.AbortController;
        window.requestAnimationFrame = callback => {
            callback(0);
            return 1;
        };
        window.cancelAnimationFrame = () => undefined;
    });

    after(() => {
        disableJSDOM();
    });

    beforeEach(() => {
        closeWorkingAgentsPopover(true);
        clearWorkingPillStopAllSuppression();
        document.body.replaceChildren();
    });

    afterEach(() => {
        closeWorkingAgentsPopover(true);
        clearWorkingPillStopAllSuppression();
        document.body.replaceChildren();
    });

    function createComposerWrap(withChangesRow = false): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-projects-sticky-composer-inner';
        if (withChangesRow) {
            const host = document.createElement('div');
            host.className = 'theia-mobile-sticky-composer-changes-pill-host';
            const section = document.createElement('div');
            section.className = 'theia-mobile-sticky-composer-activity-section theia-mod-files theia-mod-changes-pill';
            const row = document.createElement('div');
            row.className = 'theia-mobile-sticky-composer-changes-pill-row';
            const changes = document.createElement('button');
            changes.className = 'theia-mobile-sticky-composer-changes-pill';
            changes.textContent = 'Changes';
            row.append(changes);
            section.append(row);
            host.append(section);
            wrap.append(host);
        }
        const card = document.createElement('div');
        card.className = 'theia-mobile-projects-sticky-composer-card theia-mod-codex';
        wrap.append(card);
        return wrap;
    }

    function createHost(options?: {
        readonly running?: number;
        readonly streaming?: number;
        readonly isTasksHubView?: boolean;
        readonly withChangesRow?: boolean;
        readonly members?: WorkHubTeamMember[];
    }): MobileProjectsTasksHubHost & { stickyComposerHost: HTMLElement } {
        const streaming = options?.streaming ?? 0;
        const summaries: QaapAgentConversationSummaryDTO[] = Array.from({ length: streaming }, (_, i) => ({
            id: `stream-${i}`,
            status: 'streaming',
            title: `Stream ${i}`,
        } as QaapAgentConversationSummaryDTO));
        const project = {
            id: 'p1',
            name: 'Demo',
        } as MobileProjectEntry;
        const stickyComposerHost = document.createElement('div');
        stickyComposerHost.append(createComposerWrap(options?.withChangesRow));
        document.body.append(stickyComposerHost);
        const members = options?.members ?? Array.from({ length: options?.running ?? 0 }, (_, i) => ({
            id: `m${i}`,
            kind: 'conversation' as const,
            title: `Agent ${i}`,
            projectName: 'Demo',
            cwd: '/srv/demo',
            agentId: 'qaiq',
            state: 'streaming',
            childCount: 0,
            createdAt: 1,
            updatedAt: 2,
            conversationId: `m${i}`,
            projectId: 'p1',
            activityLabel: 'Working',
        }));
        return {
            homeMode: true,
            query: '',
            scroll: document.createElement('div'),
            tasksHubSurface: 'task',
            tasksFirstLoadPending: false,
            tasksFirstLoadFallback: undefined,
            visible: true,
            agentsHubShellActive: false,
            projects: [project],
            transcriptSheet: undefined,
            transcriptComposerHost: undefined,
            transcriptComposerDraft: '',
            stickyComposerDraft: '',
            stickyComposerHost,
            titleAttentionEl: document.createElement('span'),
            shouldUseAgentsHubLanding: () => true,
            isTasksHubView: () => options?.isTasksHubView ?? true,
            renderAgentsHubExecutionShell: () => undefined,
            teardownAgentsHubExecutionShell: () => undefined,
            localChatsForProject: () => [],
            vpsTasksForProject: () => summaries,
            conversationMatchesQuery: () => true,
            transcriptMessagesUi: {} as MobileProjectsTasksHubHost['transcriptMessagesUi'],
            transcriptStickyComposerUi: {} as MobileProjectsTasksHubHost['transcriptStickyComposerUi'],
            stickyComposerRenderUi: {} as MobileProjectsTasksHubHost['stickyComposerRenderUi'],
            activeInfoForProject: () => undefined as never,
            summaryToTaskView: () => undefined as never,
            createTaskItem: () => document.createElement('div'),
            openWorkHubSessionsSidebar: () => undefined,
            collectTeamMembersForHub: () => members,
            onTeamMemberClick: () => undefined,
            onCancelConversation: () => undefined,
            collectChatHubGroups: () => [],
            collectTasksInboxGroups: () => [],
            createChatEmptyState: () => document.createElement('div'),
            createInboxProjectGroup: () => document.createElement('div'),
            renderList: () => undefined,
            openDesktopIdeFromAgentsHub: async () => undefined,
            getFilteredTeamHubState: () => ({ members: [], filteredApprovals: [] }),
            countTasksAttention: () => ({ needsYou: 0, running: options?.running ?? members.length }),
            renderSubtitle: () => undefined,
            ensureOverlayUi: () => ({ teamHub: { renderSections: () => false } }),
            conversationIndexUi: {
                vpsTasksForProject: () => summaries,
                conversationsForProject: () => summaries,
            } as unknown as MobileProjectsTasksHubHost['conversationIndexUi'],
            hubQueryUi: {
                isTasksHubView: () => options?.isTasksHubView ?? true,
            } as unknown as MobileProjectsTasksHubHost['hubQueryUi'],
            projectRowsUi: {} as MobileProjectsTasksHubHost['projectRowsUi'],
            hubIncrementalUi: {} as MobileProjectsTasksHubHost['hubIncrementalUi'],
            onNewClick: async () => undefined,
            onStartNewProject: async () => undefined,
        };
    }

    it('mounts the pill above the sticky composer card, not in the header', () => {
        const host = createHost({
            running: 1,
            members: [{
                id: 'm0',
                kind: 'conversation',
                title: 'Working agent',
                projectName: 'Demo',
                cwd: '/srv/demo',
                agentId: 'qaiq',
                state: 'streaming',
                childCount: 0,
                createdAt: 1,
                updatedAt: 2,
                conversationId: 'm0',
                projectId: 'p1',
                activityLabel: 'Working',
            }],
        });
        new MobileProjectsTasksHubUi(host).updateWorkingPillChrome();
        const wrap = host.stickyComposerHost.querySelector('.theia-mobile-projects-sticky-composer-inner');
        const pill = wrap?.querySelector('.theia-mobile-sticky-composer-working-pill');
        const card = wrap?.querySelector('.theia-mobile-projects-sticky-composer-card');
        expect(pill?.textContent).to.contain('1 Working');
        expect(pill?.compareDocumentPosition(card!)).to.equal(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(pill?.querySelector('.theia-mobile-projects-working-pill-icon.theia-mod-working-loader')).to.not.equal(null);
        expect(pill?.querySelectorAll('.qaap-working-loader-dot')).to.have.length(6);
        expect(document.querySelector('.theia-mobile-projects-header-execution-cluster .theia-mobile-sticky-composer-working-pill'))
            .to.equal(null);
    });

    it('expands the Working agents panel in place on pill click', () => {
        const host = createHost({
            running: 1,
            members: [{
                id: 'm0',
                kind: 'conversation',
                title: 'Working pill agents popover',
                projectName: 'Demo',
                cwd: '/srv/demo',
                agentId: 'qaiq',
                state: 'streaming',
                childCount: 0,
                createdAt: 1,
                updatedAt: 2,
                conversationId: 'm0',
                projectId: 'p1',
                activityLabel: 'Building Working popover',
            }],
        });
        const ui = new MobileProjectsTasksHubUi(host);
        ui.updateWorkingPillChrome();
        const pill = host.stickyComposerHost.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-working-pill');
        expect(pill).to.not.equal(null);
        pill!.click();
        const shell = pill!.parentElement;
        expect(shell?.classList.contains('theia-mobile-sticky-composer-working-control')).to.equal(true);
        expect(shell?.classList.contains('theia-mod-expanded')).to.equal(true);
        const panel = shell?.querySelector('.qaap-working-agents-expand-clip');
        expect(panel).to.not.equal(null);
        expect(document.querySelector('.qaap-sticky-composer-sheet-popover.theia-mod-working-agents')).to.equal(null);
        expect(panel?.textContent).to.contain('1 Working');
        expect(panel?.textContent).to.contain('Stop All');
        expect(panel?.textContent).to.contain('Working pill agents popover');
        expect(panel?.textContent).to.contain('Building Working popover');
    });

    it('places the Working control first in the Changes row when present', () => {
        const host = createHost({ running: 1, withChangesRow: true });
        new MobileProjectsTasksHubUi(host).updateWorkingPillChrome();
        const row = host.stickyComposerHost.querySelector('.theia-mobile-sticky-composer-changes-pill-row');
        expect(row?.firstElementChild?.classList.contains('theia-mobile-sticky-composer-working-control')).to.equal(true);
        expect(row?.firstElementChild?.querySelector('.theia-mobile-sticky-composer-working-pill')).to.not.equal(null);
    });

    it('hides the pill when no agents are working', () => {
        const host = createHost({ running: 0, streaming: 0 });
        new MobileProjectsTasksHubUi(host).updateWorkingPillChrome();
        expect(host.stickyComposerHost.querySelector('.theia-mobile-sticky-composer-working-pill')).to.equal(null);
    });

    it('hides the Working pill after Stop All even if detail was open', async () => {
        let cancelledIds: string[] = [];
        const host = createHost({
            running: 1,
            members: [{
                id: 'm0',
                kind: 'conversation',
                title: 'Stop All clears pill',
                projectName: 'Demo',
                cwd: '/srv/demo',
                agentId: 'qaiq',
                state: 'streaming',
                childCount: 0,
                createdAt: 1,
                updatedAt: 2,
                conversationId: 'm0',
                projectId: 'p1',
                activityLabel: 'Still working',
            }],
        });
        host.transcriptComposerHost = host.stickyComposerHost;
        host.transcriptComposerSummary = {
            id: 'm0',
            status: 'streaming',
            title: 'Stop All clears pill',
            cwd: '/srv/demo',
            agentId: 'qaiq',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
        } as QaapAgentConversationSummaryDTO;
        host.transcriptComposerProject = host.projects[0];
        host.conversationIndexUi = {
            vpsTasksForProject: () => [host.transcriptComposerSummary!],
            conversationsForProject: () => [host.transcriptComposerSummary!],
            findSummaryById: (id: string) => (id === 'm0' ? host.transcriptComposerSummary : undefined),
        } as unknown as MobileProjectsTasksHubHost['conversationIndexUi'];
        host.onCancelConversation = (_project, summary) => {
            cancelledIds.push(summary.id);
        };
        host.transcriptStickyComposerUi = {
            stopOpenComposerAgentLikeComposerStop: () => {
                if (host.transcriptComposerProject && host.transcriptComposerSummary) {
                    host.onCancelConversation(host.transcriptComposerProject, host.transcriptComposerSummary);
                    return true;
                }
                return false;
            },
        } as unknown as MobileProjectsTasksHubHost['transcriptStickyComposerUi'];
        const ui = new MobileProjectsTasksHubUi(host);
        ui.updateWorkingPillChrome();
        const pill = host.stickyComposerHost.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-working-pill');
        expect(pill).to.not.equal(null);
        pill!.click();
        document.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-row')?.click();
        expect(document.querySelector('.qaap-working-agents-detail-panel')).to.not.equal(null);

        await ui.stopAllWorkingAgents(host.collectTeamMembersForHub());

        expect(cancelledIds).to.deep.equal(['m0']);
        expect(host.stickyComposerHost.querySelector('.theia-mobile-sticky-composer-working-pill')).to.equal(null);
        expect(host.stickyComposerHost.querySelector('.theia-mod-working-only')).to.equal(null);
        expect(document.querySelector('.qaap-working-agents-expand-clip.theia-mod-open')).to.equal(null);
        expect(document.querySelector('.theia-mobile-sticky-composer-working-control.theia-mod-expanded')).to.equal(null);
    });

    it('does not auto-collapse Working detail when chrome reports 0 after summary idle', () => {
        const host = createHost({
            running: 1,
            members: [{
                id: 'm0',
                kind: 'conversation',
                title: 'Summary survivor',
                projectName: 'Demo',
                cwd: '/srv/demo',
                agentId: 'qaiq',
                state: 'streaming',
                childCount: 0,
                createdAt: 1,
                updatedAt: 2,
                conversationId: 'm0',
                projectId: 'p1',
                activityLabel: 'Writing resumen',
            }],
        });
        host.transcriptComposerHost = host.stickyComposerHost;
        const ui = new MobileProjectsTasksHubUi(host);
        ui.updateWorkingPillChrome();
        const pill = host.stickyComposerHost.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-working-pill');
        pill!.click();
        document.querySelector<HTMLButtonElement>('.qaap-working-agents-popover-row')?.click();
        expect(document.querySelector('.qaap-working-agents-detail-panel')).to.not.equal(null);

        // Simulate settled summary: attention/running drops to 0 (streaming → idle).
        host.countTasksAttention = () => ({ needsYou: 0, running: 0 });
        host.conversationIndexUi = {
            vpsTasksForProject: () => [],
            conversationsForProject: () => [],
        } as unknown as MobileProjectsTasksHubHost['conversationIndexUi'];
        host.collectTeamMembersForHub = () => [{
            id: 'm0',
            kind: 'conversation',
            title: 'Summary survivor',
            projectName: 'Demo',
            cwd: '/srv/demo',
            agentId: 'qaiq',
            state: 'idle',
            childCount: 0,
            createdAt: 1,
            updatedAt: 3,
            conversationId: 'm0',
            projectId: 'p1',
        }];

        ui.updateWorkingPillChrome();
        expect(document.querySelector('.qaap-working-agents-expand-clip.theia-mod-open')).to.not.equal(null);
        expect(document.querySelector('.qaap-working-agents-detail-panel')).to.not.equal(null);
        expect(host.stickyComposerHost.querySelector('.theia-mobile-sticky-composer-working-control.theia-mod-expanded'))
            .to.not.equal(null);
    });

    it('clears a ghost Working pill when expand session is orphaned and no agents are working', () => {
        const host = createHost({ running: 0, streaming: 0, members: [] });
        // Orphaned session.open without a live shell used to force Math.max(0, 1) → "1 Working".
        forceOrphanedWorkingExpandSessionForTests();
        expect(isWorkingAgentsExpandSessionOpen()).to.equal(true);
        expect(isWorkingAgentsExpandPinnedOpen()).to.equal(false);

        new MobileProjectsTasksHubUi(host).updateWorkingPillChrome();

        expect(isWorkingAgentsExpandSessionOpen()).to.equal(false);
        expect(host.stickyComposerHost.querySelector('.theia-mobile-sticky-composer-working-pill')).to.equal(null);
        expect(host.stickyComposerHost.querySelector('.theia-mod-working-only')).to.equal(null);
    });

    it('hides the pill when team members settle even if stale streaming summaries remain', () => {
        const host = createHost({
            running: 0,
            streaming: 1,
            members: [{
                id: 'm0',
                kind: 'conversation',
                title: 'Settled agent',
                projectName: 'Demo',
                cwd: '/srv/demo',
                agentId: 'qaiq',
                state: 'idle',
                childCount: 0,
                createdAt: 1,
                updatedAt: 3,
                conversationId: 'm0',
                projectId: 'p1',
            }],
        });
        host.countTasksAttention = () => ({ needsYou: 0, running: 0 });
        new MobileProjectsTasksHubUi(host).updateWorkingPillChrome();
        expect(host.stickyComposerHost.querySelector('.theia-mobile-sticky-composer-working-pill')).to.equal(null);
    });

    it('keeps Working expand open when chrome refresh is outside tasks-hub view', () => {
        const host = createHost({
            running: 1,
            isTasksHubView: false,
            members: [{
                id: 'm0',
                kind: 'conversation',
                title: 'Transcript remount survivor',
                projectName: 'Demo',
                cwd: '/srv/demo',
                agentId: 'qaiq',
                state: 'streaming',
                childCount: 0,
                createdAt: 1,
                updatedAt: 2,
                conversationId: 'm0',
                projectId: 'p1',
                activityLabel: 'Still working',
            }],
        });
        // Simulate transcript overlay composer (not tasks hub list).
        host.transcriptComposerHost = host.stickyComposerHost;
        const ui = new MobileProjectsTasksHubUi(host);
        ui.updateWorkingPillChrome();
        const pill = host.stickyComposerHost.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-working-pill');
        expect(pill).to.not.equal(null);
        pill!.click();
        expect(document.querySelector('.qaap-working-agents-expand-clip.theia-mod-open')).to.not.equal(null);

        // Chrome tick while still outside tasks-hub view must NOT force-close.
        ui.updateWorkingPillChrome();
        expect(document.querySelector('.qaap-working-agents-expand-clip.theia-mod-open')).to.not.equal(null);
        expect(host.stickyComposerHost.querySelector('.theia-mobile-sticky-composer-working-control.theia-mod-expanded'))
            .to.not.equal(null);
    });
});
