// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { MobileProjectsBackgroundTaskUi } from './mobile-projects-background-task-ui';

describe('MobileProjectsBackgroundTaskUi', () => {

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
        });

        expect(ui.resolveWorktreeForSession('/repo')).to.equal(true);
        expect(ui.resolveWorktreeForSession('/other')).to.equal(false);
        expect(ui.resolveWorktreeForSession('/repo', false)).to.equal(false);
        expect(ui.resolveWorktreeForSession('/other', true)).to.equal(true);
    });
});
