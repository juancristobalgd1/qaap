// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import { MobileProjectsStickyComposerWorkspaceUi, type MobileProjectsStickyComposerWorkspaceHost } from './mobile-projects-sticky-composer-workspace-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

describe('MobileProjectsStickyComposerWorkspaceUi', () => {

    beforeEach(() => {
        if (typeof document === 'undefined') {
            enableJSDOM();
        }
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

    function createHost(projects: MobileProjectEntry[], options?: {
        readonly agentsHubInlineActive?: boolean;
        readonly transcriptOpenProject?: MobileProjectEntry;
        readonly conversationsByProjectId?: Map<string, QaapAgentConversationSummaryDTO[]>;
    }): MobileProjectsStickyComposerWorkspaceHost {
        const conversationsByProjectId = options?.conversationsByProjectId ?? new Map();
        return {
            composerWorkspaceBranchByProjectId: new Map(),
            preparedCwdByProjectId: new Map(),
            projects,
            agentsHubSelectedProjectId: undefined,
            agentsHubShellActive: true,
            agentsHubInlineActive: options?.agentsHubInlineActive ?? false,
            transcriptOpenProject: options?.transcriptOpenProject,
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
            conversationIndexUi: {
                conversationsForProject: (project: MobileProjectEntry) =>
                    conversationsByProjectId.get(project.id) ?? [],
            } as unknown as MobileProjectsStickyComposerWorkspaceHost['conversationIndexUi'],
            render: () => undefined,
            renderAgentsHubExecutionShell: () => undefined,
            openProject: async () => undefined,
            openAgentsHubInlineTranscript: async () => undefined,
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

    it('selectComposerWorkspaceProject opens an existing conversation when switching inline projects', async () => {
        const current = project('mockup', 'Mockup', true);
        const other = project('other', 'Other');
        const otherSummary: QaapAgentConversationSummaryDTO = {
            id: 'conv-other',
            cwd: '/other',
            agentId: 'codex',
            title: 'Other task',
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 3,
        };
        const conversationsByProjectId = new Map<string, QaapAgentConversationSummaryDTO[]>([
            [other.id, [otherSummary]],
        ]);
        const host = createHost([current, other], {
            agentsHubInlineActive: true,
            transcriptOpenProject: current,
            conversationsByProjectId,
        });
        let opened: { projectId: string; summaryId: string } | undefined;
        host.openAgentsHubInlineTranscript = async (projectEntry, summary) => {
            opened = { projectId: projectEntry.id, summaryId: summary.id };
        };
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);

        await ui.selectComposerWorkspaceProject(other, current);

        expect(host.agentsHubSelectedProjectId).to.equal('other');
        expect(opened).to.deep.equal({ projectId: 'other', summaryId: 'conv-other' });
    });

    it('selectComposerWorkspaceProject activates idle shell when the target project has no chats', async () => {
        const current = project('mockup', 'Mockup', true);
        const other = project('other', 'Other');
        const host = createHost([current, other], {
            agentsHubInlineActive: true,
            transcriptOpenProject: current,
        });
        let activated: string | undefined;
        host.activateAgentsHubProject = async projectEntry => {
            activated = projectEntry.id;
        };
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);

        await ui.selectComposerWorkspaceProject(other, current);

        expect(activated).to.equal('other');
    });

    it('selectComposerWorkspaceProject ignores selecting the already active project', async () => {
        const current = project('mockup', 'Mockup', true);
        const host = createHost([current], {
            agentsHubInlineActive: true,
            transcriptOpenProject: current,
        });
        let opened = false;
        host.openAgentsHubInlineTranscript = async () => {
            opened = true;
        };
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);

        await ui.selectComposerWorkspaceProject(current, current);

        expect(opened).to.equal(false);
    });
});
