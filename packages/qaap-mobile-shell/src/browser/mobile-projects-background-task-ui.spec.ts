// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

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
