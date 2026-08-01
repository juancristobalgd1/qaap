// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import { MobileProjectsBackgroundTaskUi } from './mobile-projects-background-task-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

describe('MobileProjectsBackgroundTaskUi', () => {

    it('ensureInlineComposerCwd prefers open workspace when hub project differs (QA-001)', async () => {
        const mockup: MobileProjectEntry = {
            id: 'mockup',
            name: 'Mockup',
            color: '#000',
            branch: 'main',
            status: 'idle',
            task: '',
            progress: 0,
            agents: [],
            lastActive: '',
            tokens: '—',
            cost: '—',
            pinned: false,
            // This project IS the currently open workspace (the mock's
            // projectMatchesCurrentWorkspace only returns true when isCurrent === true).
            // ensureInlineComposerCwd must then prefer the live workspace cwd over the
            // project's stored getProjectCwd path.
            isCurrent: true,
        };
        const prepared = new Map<string, string>();
        const projectsService = {
            getCurrentWorkspaceCwd: () => '/tmp/qaap-ui-ws-empty',
            projectMatchesCurrentWorkspace: (project: MobileProjectEntry) => project.id === 'mockup' && project.isCurrent === true,
            getProjectCwd: () => '/Users/jc/.qaap/workspaces/u/Mockup',
            prepareProjectCwd: async () => undefined,
        };
        const ui = new MobileProjectsBackgroundTaskUi({
            projects: [],
            preparedCwdByProjectId: prepared,
            justAddedTaskId: undefined,
            agentsHubShellActive: false,
            projectsService: projectsService as never,
            delegate: {},
            transcriptSheetUi: {} as never,
            transcriptLiveUi: {} as never,
            shouldUseAgentsHubLanding: () => false,
            renderSubtitle: () => undefined,
            renderList: () => undefined,
            seedTranscriptOptimisticSubmit: () => undefined,
            syncWorkHubProjectSkillRoots: () => undefined,
        });

        const cwd = await ui.ensureInlineComposerCwd(mockup);
        expect(cwd).to.equal('/tmp/qaap-ui-ws-empty');
        expect(prepared.get('mockup')).to.equal('/tmp/qaap-ui-ws-empty');
    });

    it('clears the just-added flash in place after 1.4s instead of rebuilding the whole list', () => {
        const project: MobileProjectEntry = {
            id: 'p1', name: 'P1', color: '#000', branch: 'main', status: 'idle', task: '',
            progress: 0, agents: [], lastActive: '', tokens: '—', cost: '—', pinned: false,
            isCurrent: false,
        };
        const item = document.createElement('button');
        item.className = 'theia-mobile-projects-task-item theia-mod-flash';
        document.body.append(item);

        let renderListCalls = 0;
        const ui = new MobileProjectsBackgroundTaskUi({
            projects: [project],
            preparedCwdByProjectId: new Map(),
            justAddedTaskId: undefined,
            agentsHubShellActive: false,
            projectsService: { getProjectCwd: () => '/repo' } as never,
            delegate: { onProjectsChanged: () => undefined },
            transcriptSheetUi: {} as never,
            transcriptLiveUi: {} as never,
            shouldUseAgentsHubLanding: () => false,
            renderSubtitle: () => undefined,
            renderList: () => { renderListCalls++; },
            seedTranscriptOptimisticSubmit: () => undefined,
            syncWorkHubProjectSkillRoots: () => undefined,
        } as never);

        const realSetTimeout = window.setTimeout;
        let deferred: (() => void) | undefined;
        window.setTimeout = ((handler: TimerHandler) => {
            if (typeof handler === 'function') {
                deferred = handler as () => void;
            }
            return 1 as unknown as number;
        }) as typeof setTimeout;

        try {
            (ui as unknown as {
                applyTaskStartedToProject: (cwd: string, title: string, taskId: string) => void;
            }).applyTaskStartedToProject('/repo', 'New task', 'task-1');

            // Initial paint is a single full render; the flash is still on.
            expect(renderListCalls).to.equal(1);
            expect((ui as unknown as { host: { justAddedTaskId?: string } }).host.justAddedTaskId).to.equal('task-1');
            expect(item.classList.contains('theia-mod-flash')).to.equal(true);

            // The 1.4s cleanup strips the flash class WITHOUT a second full render.
            deferred?.();
            expect(item.classList.contains('theia-mod-flash')).to.equal(false);
            expect(renderListCalls).to.equal(1);
            expect((ui as unknown as { host: { justAddedTaskId?: string } }).host.justAddedTaskId).to.equal(undefined);
        } finally {
            window.setTimeout = realSetTimeout;
            item.remove();
        }
    });

    it('auto-enables worktree when another conversation is streaming in the same cwd', () => {
        const ui = new MobileProjectsBackgroundTaskUi({
            projects: [],
            preparedCwdByProjectId: new Map(),
            justAddedTaskId: undefined,
            agentsHubShellActive: false,
            projectsService: {} as never,
            conversations: {
                getStreamingCountForCwd: (cwd: string) => cwd === '/repo' ? 1 : 0,
            } as never,
            delegate: {},
            transcriptSheetUi: {} as never,
            transcriptLiveUi: {} as never,
            shouldUseAgentsHubLanding: () => false,
            renderSubtitle: () => undefined,
            renderList: () => undefined,
            seedTranscriptOptimisticSubmit: () => undefined,
            syncWorkHubProjectSkillRoots: () => undefined,
        });

        expect(ui.resolveWorktreeForSession('/repo')).to.equal(true);
        expect(ui.resolveWorktreeForSession('/other')).to.equal(false);
        expect(ui.resolveWorktreeForSession('/repo', false)).to.equal(false);
        expect(ui.resolveWorktreeForSession('/other', true)).to.equal(true);
    });

    it('auto-enables worktree when a QUEUED task (concurrency cap) targets the same cwd', () => {
        const ui = new MobileProjectsBackgroundTaskUi({
            projects: [],
            preparedCwdByProjectId: new Map(),
            justAddedTaskId: undefined,
            agentsHubShellActive: false,
            projectsService: {} as never,
            conversations: {
                getStreamingCountForCwd: () => 0,
            } as never,
            activeTasks: {
                getTasksForCwd: (cwd: string) => cwd === '/repo'
                    ? [{ state: 'queued' }]
                    : [{ state: 'completed' }],
            } as never,
            delegate: {},
            transcriptSheetUi: {} as never,
            transcriptLiveUi: {} as never,
            shouldUseAgentsHubLanding: () => false,
            renderSubtitle: () => undefined,
            renderList: () => undefined,
            seedTranscriptOptimisticSubmit: () => undefined,
            syncWorkHubProjectSkillRoots: () => undefined,
        });

        expect(ui.resolveWorktreeForSession('/repo')).to.equal(true);
        expect(ui.resolveWorktreeForSession('/other')).to.equal(false);
    });
});
