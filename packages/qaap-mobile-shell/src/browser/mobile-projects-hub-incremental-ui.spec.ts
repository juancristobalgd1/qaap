// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    MobileProjectsHubIncrementalUi,
    QAAP_INBOX_ROW_FP_ATTR,
    QAAP_INBOX_ROW_ID_ATTR,
    QAAP_INBOX_STRUCTURE_FP_ATTR,
} from './mobile-projects-hub-incremental-ui';
import { buildWorkHubInboxStructureFingerprint, buildWorkHubInboxRowFingerprintFromSummary } from '../common/qaap-work-hub-inbox-fingerprint';
import { resolveQaapAgentTaskVisualStatus } from '../common/qaap-agent-task-visual-status';
import {
    QAAP_TEAM_MEMBER_ID_ATTR,
    QAAP_TEAM_ROW_FP_ATTR,
} from '../common/qaap-work-hub-team-fingerprint';
import { MobileProjectsTeamHubUi } from './mobile-projects-team-hub-ui';

describe('MobileProjectsHubIncrementalUi', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('patches only rows whose fingerprint changed without rebuilding the inbox root', () => {
        const scroll = document.createElement('div');
        const inbox = document.createElement('div');
        inbox.className = 'theia-mobile-projects-chats-inbox theia-mod-tasks-inbox';
        const section = document.createElement('section');
        section.className = 'theia-mobile-projects-chats-project-group';
        section.dataset.qaapProjectId = 'p1';
        const list = document.createElement('div');
        list.className = 'theia-mobile-projects-chats-list';
        const rowA = document.createElement('div');
        rowA.className = 'theia-mobile-projects-task-row';
        rowA.setAttribute(QAAP_INBOX_ROW_ID_ATTR, 'conv-a');
        rowA.setAttribute(QAAP_INBOX_ROW_FP_ATTR, 'old-a');
        const rowB = document.createElement('div');
        rowB.className = 'theia-mobile-projects-task-row';
        rowB.setAttribute(QAAP_INBOX_ROW_ID_ATTR, 'conv-b');
        const summaryB = {
            id: 'conv-b',
            title: 'B',
            status: 'idle' as const,
            createdAt: 1,
            updatedAt: 1,
            messageCount: 1,
            agentId: 'qaiq',
            cwd: '/repo',
        };
        const stableBFingerprint = buildWorkHubInboxRowFingerprintFromSummary(summaryB, {
            rowKey: 'conv-b',
            visualStatusId: resolveQaapAgentTaskVisualStatus({ state: 'idle' }, summaryB).id,
            unread: false,
        });
        rowB.setAttribute(QAAP_INBOX_ROW_FP_ATTR, stableBFingerprint);
        list.append(rowA, rowB);
        section.append(list);
        inbox.append(section);
        scroll.append(inbox);
        document.body.append(scroll);

        const structure = buildWorkHubInboxStructureFingerprint({
            hubKind: 'tasks-inbox',
            query: '',
            groups: [{
                projectId: 'p1',
                itemCount: 2,
                rows: [{ rowKey: 'conv-a' }, { rowKey: 'conv-b' }],
                variantRunIds: [],
            }],
        });
        inbox.setAttribute(QAAP_INBOX_STRUCTURE_FP_ATTR, structure);

        let createCalls = 0;
        const ui = new MobileProjectsHubIncrementalUi({
            query: '',
            scroll,
            transcriptOpenSummaryId: undefined,
            justAddedTaskId: undefined,
            hubView: 'tasks',
            tasksHubSurface: 'task',
            shouldUseAgentsHubLanding: () => false,
            projectsForCurrentHubList: () => [{ id: 'p1' } as never],
            collectTasksInboxGroups: () => [{
                project: { id: 'p1' } as never,
                items: [{
                    kind: 'conversation',
                    project: { id: 'p1' } as never,
                    summary: {
                        id: 'conv-a',
                        title: 'A',
                        status: 'streaming',
                        createdAt: 1,
                        updatedAt: 2,
                        messageCount: 2,
                        turnProgressCurrent: 2,
                        turnProgressTotal: 4,
                        agentId: 'qaiq',
                        cwd: '/repo',
                    },
                    sortAt: 2,
                    priority: 0,
                }, {
                    kind: 'conversation',
                    project: { id: 'p1' } as never,
                    summary: {
                        id: 'conv-b',
                        title: 'B',
                        status: 'idle',
                        createdAt: 1,
                        updatedAt: 1,
                        messageCount: 1,
                        agentId: 'qaiq',
                        cwd: '/repo',
                    },
                    sortAt: 1,
                    priority: 0,
                }],
            }],
            collectReviewGroups: () => [],
            updateTasksAttentionChrome: () => undefined,
            renderSubtitle: () => undefined,
            getFilteredTeamHubState: () => ({ members: [], filteredApprovals: [] }),
            ensureOverlayUi: () => ({ teamHub: { patchSections: () => true } }),
            conversationIndexUi: {
                activeInfoForProject: () => ({ running: 1, needsInput: 0, completed: 0, activeCount: 1 }),
                summaryToTaskView: (summary: { id: string; title: string; status: string; createdAt: number; cwd: string }) => ({
                    id: summary.id,
                    title: summary.title,
                    state: summary.status === 'streaming' ? 'running' : 'idle',
                    since: 'now',
                    command: 'qaiq',
                    cwd: summary.cwd,
                    createdAt: summary.createdAt,
                }),
                isConversationUnread: () => false,
            } as never,
            projectRowsUi: {
                createTaskItem: () => {
                    createCalls++;
                    const row = document.createElement('div');
                    row.className = 'theia-mobile-projects-task-row';
                    row.setAttribute(QAAP_INBOX_ROW_ID_ATTR, createCalls === 1 ? 'conv-a' : 'conv-b');
                    row.setAttribute(QAAP_INBOX_ROW_FP_ATTR, createCalls === 1 ? 'new-a' : 'stable-b');
                    return row;
                },
            } as never,
            createInboxProjectGroup: () => document.createElement('section'),
        });

        expect(ui.tryPatchBeforeRebuild()).to.equal(true);
        expect(createCalls).to.equal(1);
        expect(list.querySelectorAll('.theia-mobile-projects-task-row')).to.have.length(2);
        expect(list.querySelector(`[${QAAP_INBOX_ROW_ID_ATTR}="conv-a"]`)?.getAttribute(QAAP_INBOX_ROW_FP_ATTR)).to.equal('new-a');

        scroll.remove();
    });

    it('patches embedded team rows without rebuilding the tasks hub root', () => {
        const scroll = document.createElement('div');
        const root = document.createElement('div');
        root.className = 'theia-mobile-tasks-hub-root';
        const teamRoot = document.createElement('div');
        teamRoot.className = 'theia-mobile-hub-team-root theia-mod-embedded-in-tasks';
        const teamUi = new MobileProjectsTeamHubUi({
            resolveAgentLabel: (agentId: string) => `@${agentId}`,
            onMemberClick: () => undefined,
        });
        const members = [{
            id: 'leader-1',
            kind: 'conversation' as const,
            agentId: 'qaiq',
            title: 'Refactor inbox',
            state: 'streaming',
            cwd: '/repo',
            projectId: 'p1',
            projectName: 'qaap-mobile-shell',
            createdAt: 1,
            updatedAt: 100,
            childCount: 0,
        }];
        teamUi.renderSections(teamRoot, members, { embedded: true });
        root.append(teamRoot);
        scroll.append(root);
        document.body.append(scroll);

        teamRoot.querySelector<HTMLElement>(
            `.theia-mobile-hub-team-row[${QAAP_TEAM_MEMBER_ID_ATTR}="leader-1"]`,
        )!.setAttribute(QAAP_TEAM_ROW_FP_ATTR, 'stale');

        const ui = new MobileProjectsHubIncrementalUi({
            query: '',
            scroll,
            transcriptOpenSummaryId: undefined,
            justAddedTaskId: undefined,
            hubView: 'tasks',
            tasksHubSurface: 'task',
            shouldUseAgentsHubLanding: () => false,
            projectsForCurrentHubList: () => [],
            collectTasksInboxGroups: () => [],
            collectReviewGroups: () => [],
            updateTasksAttentionChrome: () => undefined,
            renderSubtitle: () => undefined,
            getFilteredTeamHubState: () => ({
                members: [{ ...members[0], activityLabel: 'Patching rows' }],
                filteredApprovals: [],
            }),
            ensureOverlayUi: () => ({ teamHub: teamUi }),
            conversationIndexUi: {} as never,
            projectRowsUi: {} as never,
            createInboxProjectGroup: () => document.createElement('section'),
        });

        expect(ui.tryPatchBeforeRebuild()).to.equal(true);
        const patchedRow = teamRoot.querySelector<HTMLElement>(
            `.theia-mobile-hub-team-row[${QAAP_TEAM_MEMBER_ID_ATTR}="leader-1"]`,
        );
        expect(patchedRow?.getAttribute(QAAP_TEAM_ROW_FP_ATTR)).to.not.equal('stale');

        scroll.remove();
    });
});
