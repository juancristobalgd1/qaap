// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import { MobileProjectsStickyComposerWorkspaceUi, type MobileProjectsStickyComposerWorkspaceHost } from './mobile-projects-sticky-composer-workspace-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

describe('MobileProjectsStickyComposerWorkspaceUi', () => {

    beforeEach(() => {
        document.body.replaceChildren();
        if (!HTMLElement.prototype.scrollTo) {
            HTMLElement.prototype.scrollTo = () => undefined;
        }
        const raf = (callback: FrameRequestCallback): number => setTimeout(() => callback(performance.now()), 0) as unknown as number;
        window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = (handle: number): void => clearTimeout(handle);
    });

    function project(id: string, name: string, isCurrent = false): MobileProjectEntry {
        return {
            id,
            name,
            color: '#8EB5DC',
            branch: 'main',
            status: 'idle',
            task: '',
            progress: 0,
            agents: [],
            lastActive: 'now',
            tokens: '0',
            cost: '$0',
            pinned: false,
            isCurrent,
        };
    }

    function createHost(projects: MobileProjectEntry[]): MobileProjectsStickyComposerWorkspaceHost {
        return {
            composerWorkspaceBranchByProjectId: new Map(),
            preparedCwdByProjectId: new Map(),
            projects,
            agentsHubSelectedProjectId: undefined,
            agentsHubShellActive: true,
            stickyComposerWorkspaceSheet: undefined,
            transcriptComposerHost: undefined,
            transcriptComposerProject: undefined,
            transcriptComposerSummary: undefined,
            projectsService: {
                getProjectCwd: () => undefined,
                getCurrentWorkspaceBranch: () => 'main',
                prepareProjectCwd: async () => undefined,
                createGithubProject: async () => projects,
            } as unknown as MobileProjectsStickyComposerWorkspaceHost['projectsService'],
            delegate: {},
            transcriptComposerUi: {
                closeTranscriptComposerSheets: () => undefined,
            } as unknown as MobileProjectsStickyComposerWorkspaceHost['transcriptComposerUi'],
            transcriptStickyComposerUi: {
                remountTranscriptStickyComposer: () => undefined,
            } as unknown as MobileProjectsStickyComposerWorkspaceHost['transcriptStickyComposerUi'],
            render: () => undefined,
            renderAgentsHubExecutionShell: () => undefined,
            openProject: async () => undefined,
            onNewClick: async () => undefined,
            activateAgentsHubProject: async () => undefined,
            stickyComposerRenderUi: {
                renderStickyComposer: () => undefined,
            } as unknown as MobileProjectsStickyComposerWorkspaceHost['stickyComposerRenderUi'],
            stickyComposerSheetsUi: {
                closeStickyComposerSheets: () => undefined,
            } as unknown as MobileProjectsStickyComposerWorkspaceHost['stickyComposerSheetsUi'],
        };
    }

    it('shows create and add actions before repository choices in the project menu', () => {
        const projects = [project('current', 'Current', true), project('next', 'Next')];
        const host = createHost(projects);
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);

        ui.openComposerWorkspaceProjectSheet(projects[0]);

        const labels = [...document.body.querySelectorAll<HTMLElement>('.theia-mobile-sticky-composer-sheet-option-label')]
            .map(label => label.textContent?.trim());
        expect(labels.slice(0, 4)).to.deep.equal([
            'Start new project',
            'Add repository',
            'Current',
            'Next',
        ]);
    });
});
