// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import { QAAP_GIT_REVIEW_API_PATH } from '../common/qaap-git-review';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import { MobileProjectsStickyComposerWorkspaceUi, type MobileProjectsStickyComposerWorkspaceHost } from './mobile-projects-sticky-composer-workspace-ui';
import type { MobileProjectEntry } from './mobile-projects-types';
import { COMPOSER_BRANCH_SHEET_ROW_SELECTOR } from './qaap-composer-branch-sheet-row';

describe('MobileProjectsStickyComposerWorkspaceUi', () => {

    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        if (typeof document === 'undefined') {
            enableJSDOM();
        }
        // Node's AbortSignal is incompatible with jsdom addEventListener({ signal }).
        globalThis.AbortController = window.AbortController;
        document.body.replaceChildren();
        if (!HTMLElement.prototype.scrollTo) {
            HTMLElement.prototype.scrollTo = () => undefined;
        }
        const raf = (callback: FrameRequestCallback): number => setTimeout(() => callback(performance.now()), 0) as unknown as number;
        window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = (handle: number): void => clearTimeout(handle);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
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
        const startNew = [...document.body.querySelectorAll<HTMLElement>('.theia-mobile-sticky-composer-sheet-option')]
            .find(option => option.textContent?.includes('Start new project'));
        expect(startNew?.querySelector('.codicon-repo')).to.not.equal(null);
    });

    it('opens the project menu as a top popover when anchored to the Work Hub header control', () => {
        const projects = [project('current', 'Current', true)];
        const host = createHost(projects);
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);
        const anchor = document.createElement('button');
        anchor.className = 'theia-mobile-projects-header-project';
        document.body.append(anchor);
        const matchMedia = window.matchMedia;
        window.matchMedia = ((query: string) => ({
            matches: String(query).includes('max-width'),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        })) as typeof window.matchMedia;

        ui.openComposerWorkspaceProjectSheet(projects[0], false, anchor);

        expect(host.stickyComposerWorkspaceSheet?.classList.contains('qaap-sticky-composer-sheet-popover')).to.equal(true);
        window.matchMedia = matchMedia;
        anchor.remove();
    });

    it('renders Project, Branch, and Run in nav when opened from the Work Hub header', () => {
        const projects = [project('current', 'Current', true)];
        const host = createHost(projects);
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);
        const anchor = document.createElement('button');
        anchor.className = 'theia-mobile-projects-header-project';
        document.body.append(anchor);
        const matchMedia = window.matchMedia;
        window.matchMedia = ((query: string) => ({
            matches: String(query).includes('max-width'),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        })) as typeof window.matchMedia;

        ui.openComposerWorkspaceProjectSheet(projects[0], false, anchor);

        const nav = document.body.querySelector('.theia-mobile-composer-workspace-sheet-nav [role="group"]');
        expect(nav).to.not.equal(null);
        const labels = [...document.body.querySelectorAll<HTMLButtonElement>(
            '.theia-mobile-composer-workspace-sheet-nav .theia-qaap-segmented-option',
        )].map(btn => btn.textContent?.trim());
        expect(labels).to.deep.equal(['Project', 'Branch', 'Run in']);
        const projectBtn = document.body.querySelector<HTMLButtonElement>(
            '.theia-mobile-composer-workspace-sheet-nav .theia-qaap-segmented-option.theia-mod-selected',
        );
        expect(projectBtn?.textContent?.trim()).to.equal('Project');
        expect(projectBtn?.querySelector('.codicon-repo')).to.not.equal(null);
        expect(document.body.querySelector(
            '.theia-mobile-composer-workspace-sheet-nav .theia-qaap-segmented-option[aria-label="Branch"] .codicon-git-branch',
        )).to.not.equal(null);
        expect(document.body.querySelector(
            '.theia-mobile-composer-workspace-sheet-nav .theia-qaap-segmented-option[aria-label="Run in"] .codicon-repo',
        )).to.not.equal(null);
        expect(projectBtn?.getAttribute('aria-pressed')).to.equal('true');
        window.matchMedia = matchMedia;
        anchor.remove();
    });

    it('header nav Branch and Run in buttons invoke the same workspace sheet openers', () => {
        const projects = [project('current', 'Current', true)];
        const host = createHost(projects);
        host.stickyComposerSheetsUi = {
            closeStickyComposerSheets: () => {
                host.stickyComposerWorkspaceSheet?.remove();
                host.stickyComposerWorkspaceSheet = undefined;
            },
        } as unknown as MobileProjectsStickyComposerWorkspaceHost['stickyComposerSheetsUi'];
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);
        const anchor = document.createElement('button');
        anchor.className = 'theia-mobile-projects-header-project';
        document.body.append(anchor);
        const matchMedia = window.matchMedia;
        window.matchMedia = ((query: string) => ({
            matches: String(query).includes('max-width'),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        })) as typeof window.matchMedia;

        let openedBranch = 0;
        let openedDestination = 0;
        const originalOpenBranch = ui.openComposerWorkspaceBranchSheet.bind(ui);
        const originalOpenDestination = ui.openComposerWorkspaceDestinationSheet.bind(ui);
        ui.openComposerWorkspaceBranchSheet = (projectEntry, transcriptOverlay, sheetAnchor, intent) => {
            openedBranch += 1;
            expect(projectEntry.id).to.equal('current');
            expect(sheetAnchor).to.equal(anchor);
            expect(intent).to.equal('switch');
            originalOpenBranch(projectEntry, transcriptOverlay, sheetAnchor, intent);
        };
        ui.openComposerWorkspaceDestinationSheet = (projectEntry, transcriptOverlay, sheetAnchor, intent) => {
            openedDestination += 1;
            expect(projectEntry.id).to.equal('current');
            expect(sheetAnchor).to.equal(anchor);
            expect(intent).to.equal('switch');
            originalOpenDestination(projectEntry, transcriptOverlay, sheetAnchor, intent);
        };

        ui.openComposerWorkspaceProjectSheet(projects[0], false, anchor);
        document.body.querySelector<HTMLButtonElement>(
            '.theia-mobile-composer-workspace-sheet-nav .theia-qaap-segmented-option[aria-label="Branch"]',
        )?.click();
        document.body.querySelector<HTMLButtonElement>(
            '.theia-mobile-composer-workspace-sheet-nav .theia-qaap-segmented-option[aria-label="Run in"]',
        )?.click();

        expect(openedBranch).to.equal(1);
        expect(openedDestination).to.equal(1);
        const runInHeader = host.stickyComposerWorkspaceSheet?.querySelector('.theia-mobile-sticky-composer-sheet-header h2');
        expect(runInHeader?.querySelector('.theia-mobile-sticky-composer-sheet-header-label')?.textContent?.trim())
            .to.equal('Run in');
        expect(runInHeader?.querySelector('.theia-mobile-sticky-composer-sheet-header-value')?.textContent?.trim())
            .to.equal('Current workspace');
        window.matchMedia = matchMedia;
        anchor.remove();
    });

    it('shows the active selection name beside each workspace sheet header title', () => {
        const projects = [project('current', 'cloud-ws-demo', true)];
        projects[0].branch = 'feature/sheet-header';
        const host = createHost(projects);
        host.composerWorkspaceBranchByProjectId.set(projects[0].id, 'feature/sheet-header');
        host.stickyComposerSheetsUi = {
            closeStickyComposerSheets: () => {
                host.stickyComposerWorkspaceSheet?.remove();
                host.stickyComposerWorkspaceSheet = undefined;
            },
        } as unknown as MobileProjectsStickyComposerWorkspaceHost['stickyComposerSheetsUi'];
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);

        ui.openComposerWorkspaceProjectSheet(projects[0]);
        let header = document.body.querySelector('.theia-mobile-sticky-composer-sheet-header h2');
        expect(header?.querySelector('.theia-mobile-sticky-composer-sheet-header-label')?.textContent?.trim())
            .to.equal('Project');
        expect(header?.querySelector('.theia-mobile-sticky-composer-sheet-header-value')?.textContent?.trim())
            .to.equal('cloud-ws-demo');
        expect(header?.getAttribute('aria-label')).to.equal('Project cloud-ws-demo');

        ui.openComposerWorkspaceBranchSheet(projects[0]);
        header = document.body.querySelector('.theia-mobile-sticky-composer-sheet-header h2');
        expect(header?.querySelector('.theia-mobile-sticky-composer-sheet-header-label')?.textContent?.trim())
            .to.equal('Branch');
        expect(header?.querySelector('.theia-mobile-sticky-composer-sheet-header-value')?.textContent?.trim())
            .to.equal('feature/sheet-header');
        expect(header?.getAttribute('aria-label')).to.equal('Branch feature/sheet-header');

        ui.openComposerWorkspaceDestinationSheet(projects[0]);
        header = document.body.querySelector('.theia-mobile-sticky-composer-sheet-header h2');
        expect(header?.querySelector('.theia-mobile-sticky-composer-sheet-header-label')?.textContent?.trim())
            .to.equal('Run in');
        expect(header?.querySelector('.theia-mobile-sticky-composer-sheet-header-value')?.textContent?.trim())
            .to.equal('Current workspace');
        expect(header?.getAttribute('aria-label')).to.equal('Run in Current workspace');
    });

    it('does not render header workspace nav for bottom-sheet project picker', () => {
        const projects = [project('current', 'Current', true)];
        const host = createHost(projects);
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);

        ui.openComposerWorkspaceProjectSheet(projects[0]);

        expect(document.body.querySelector('.theia-mobile-composer-workspace-sheet-nav')).to.equal(null);
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

    it('removes a branch optimistically before delete completes', async () => {
        const current = project('repo', 'Repo', true);
        let finishDelete!: (response: Response) => void;
        const pendingDelete = new Promise<Response>(resolve => { finishDelete = resolve; });
        globalThis.fetch = (input, init) => {
            const url = String(input);
            if (url.includes('/delete-branch') && init?.method === 'POST') {
                return pendingDelete;
            }
            return Promise.reject(new Error(`unexpected fetch: ${url}`));
        };
        const host = createHost([current]);
        host.preparedCwdByProjectId.set(current.id, '/tmp/repo');
        host.projectsService = {
            getProjectCwd: () => '/tmp/repo',
            getCurrentWorkspaceBranch: () => 'main',
            prepareProjectCwd: async () => undefined,
            createGithubProject: async () => [current],
        } as unknown as MobileProjectsStickyComposerWorkspaceHost['projectsService'];
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);
        const workspaceUi = ui as MobileProjectsStickyComposerWorkspaceUi & {
            appendComposerWorkspaceBranchRow: (
                project: MobileProjectEntry,
                list: HTMLElement,
                branch: string,
                current: string | undefined,
            ) => void;
        };
        const list = document.createElement('div');
        list.className = 'theia-mobile-sticky-composer-sheet-list';
        workspaceUi.appendComposerWorkspaceBranchRow(current, list, 'main', 'main');
        workspaceUi.appendComposerWorkspaceBranchRow(current, list, 'feature/old', 'main');
        document.body.append(list);

        const completion = ui.deleteComposerWorkspaceBranch(current, 'feature/old', list, 'main');

        expect(list.querySelectorAll(COMPOSER_BRANCH_SHEET_ROW_SELECTOR).length).to.equal(1);
        expect(list.querySelector('[data-branch-name="feature/old"]')).to.equal(null);
        finishDelete(new Response(JSON.stringify({ ok: true, branch: 'feature/old' }), { status: 200 }));
        await completion;
        expect(list.querySelectorAll(COMPOSER_BRANCH_SHEET_ROW_SELECTOR).length).to.equal(1);
        expect(list.querySelector('[data-branch-name="feature/old"]')).to.equal(null);
    });

    it('restores a branch row when optimistic delete fails', async () => {
        const current = project('repo', 'Repo', true);
        globalThis.fetch = (input, init) => {
            const url = String(input);
            if (url.includes('/delete-branch') && init?.method === 'POST') {
                return Promise.resolve(new Response(JSON.stringify({ error: 'branch is checked out' }), { status: 409 }));
            }
            return Promise.reject(new Error(`unexpected fetch: ${url}`));
        };
        const host = createHost([current]);
        host.preparedCwdByProjectId.set(current.id, '/tmp/repo');
        host.projectsService = {
            getProjectCwd: () => '/tmp/repo',
            getCurrentWorkspaceBranch: () => 'main',
            prepareProjectCwd: async () => undefined,
            createGithubProject: async () => [current],
        } as unknown as MobileProjectsStickyComposerWorkspaceHost['projectsService'];
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);
        const workspaceUi = ui as MobileProjectsStickyComposerWorkspaceUi & {
            appendComposerWorkspaceBranchRow: (
                project: MobileProjectEntry,
                list: HTMLElement,
                branch: string,
                current: string | undefined,
            ) => void;
        };
        const list = document.createElement('div');
        list.className = 'theia-mobile-sticky-composer-sheet-list';
        workspaceUi.appendComposerWorkspaceBranchRow(current, list, 'main', 'main');
        workspaceUi.appendComposerWorkspaceBranchRow(current, list, 'feature/old', 'main');
        document.body.append(list);

        await ui.deleteComposerWorkspaceBranch(current, 'feature/old', list, 'main');

        const branches = [...list.querySelectorAll<HTMLElement>(COMPOSER_BRANCH_SHEET_ROW_SELECTOR)]
            .map(row => row.dataset.branchName);
        expect(branches).to.deep.equal(['main', 'feature/old']);
    });

    it('shows empty state when the last deletable branch is removed optimistically', async () => {
        const current = project('repo', 'Repo', true);
        globalThis.fetch = (input, init) => {
            const url = String(input);
            if (url.includes(`${QAAP_GIT_REVIEW_API_PATH}/delete-branch`) && init?.method === 'POST') {
                return Promise.resolve(new Response(JSON.stringify({ ok: true, branch: 'feature/only' }), { status: 200 }));
            }
            return Promise.reject(new Error(`unexpected fetch: ${url}`));
        };
        const host = createHost([current]);
        host.preparedCwdByProjectId.set(current.id, '/tmp/repo');
        host.projectsService = {
            getProjectCwd: () => '/tmp/repo',
            getCurrentWorkspaceBranch: () => 'main',
            prepareProjectCwd: async () => undefined,
            createGithubProject: async () => [current],
        } as unknown as MobileProjectsStickyComposerWorkspaceHost['projectsService'];
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);
        const workspaceUi = ui as MobileProjectsStickyComposerWorkspaceUi & {
            appendComposerWorkspaceBranchRow: (
                project: MobileProjectEntry,
                list: HTMLElement,
                branch: string,
                current: string | undefined,
            ) => void;
        };
        const list = document.createElement('div');
        list.className = 'theia-mobile-sticky-composer-sheet-list';
        workspaceUi.appendComposerWorkspaceBranchRow(current, list, 'feature/only', 'main');
        document.body.append(list);

        await ui.deleteComposerWorkspaceBranch(current, 'feature/only', list, 'main');

        expect(list.querySelectorAll(COMPOSER_BRANCH_SHEET_ROW_SELECTOR).length).to.equal(0);
        expect(list.querySelector('.theia-mobile-sticky-composer-sheet-loading')?.textContent)
            .to.contain('No local branches found');
    });

    it('filters a deleted branch out of subsequent sheet loads in the same tab', async () => {
        const current = project('repo', 'Repo', true);
        globalThis.fetch = (input, init) => {
            const url = String(input);
            if (url.includes('/branches') && (!init?.method || init.method === 'GET')) {
                return Promise.resolve(new Response(JSON.stringify({
                    root: '/tmp/repo',
                    current: 'main',
                    branches: ['main', 'feature/stale'],
                }), { status: 200 }));
            }
            if (url.includes('/delete-branch') && init?.method === 'POST') {
                return Promise.resolve(new Response(JSON.stringify({ ok: true, branch: 'feature/stale' }), { status: 200 }));
            }
            return Promise.reject(new Error(`unexpected fetch: ${url}`));
        };
        const host = createHost([current]);
        host.preparedCwdByProjectId.set(current.id, '/tmp/repo');
        host.projectsService = {
            getProjectCwd: () => '/tmp/repo',
            getCurrentWorkspaceBranch: () => 'main',
            prepareProjectCwd: async () => undefined,
            createGithubProject: async () => [current],
        } as unknown as MobileProjectsStickyComposerWorkspaceHost['projectsService'];
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);
        const workspaceUi = ui as MobileProjectsStickyComposerWorkspaceUi & {
            appendComposerWorkspaceBranchRow: (
                project: MobileProjectEntry,
                list: HTMLElement,
                branch: string,
                current: string | undefined,
            ) => void;
        };
        const list = document.createElement('div');
        list.className = 'theia-mobile-sticky-composer-sheet-list';
        workspaceUi.appendComposerWorkspaceBranchRow(current, list, 'main', 'main');
        workspaceUi.appendComposerWorkspaceBranchRow(current, list, 'feature/stale', 'main');
        document.body.append(list);

        await ui.deleteComposerWorkspaceBranch(current, 'feature/stale', list, 'main');
        await ui.loadComposerWorkspaceBranchSheet(current, list);

        const branches = [...list.querySelectorAll<HTMLElement>(COMPOSER_BRANCH_SHEET_ROW_SELECTOR)]
            .map(row => row.dataset.branchName);
        expect(branches).to.deep.equal(['main']);
    });

    it('restores a branch row and shows a snackbar when cwd is unavailable', async () => {
        const current = project('repo', 'Repo', true);
        let fetchCalled = false;
        globalThis.fetch = () => {
            fetchCalled = true;
            return Promise.reject(new Error('fetch should not run'));
        };
        const host = createHost([current]);
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);
        const workspaceUi = ui as MobileProjectsStickyComposerWorkspaceUi & {
            appendComposerWorkspaceBranchRow: (
                project: MobileProjectEntry,
                list: HTMLElement,
                branch: string,
                current: string | undefined,
            ) => void;
        };
        const list = document.createElement('div');
        list.className = 'theia-mobile-sticky-composer-sheet-list';
        workspaceUi.appendComposerWorkspaceBranchRow(current, list, 'main', 'main');
        workspaceUi.appendComposerWorkspaceBranchRow(current, list, 'feature/old', 'main');
        document.body.append(list);
        const snackbar = document.createElement('div');
        snackbar.className = 'theia-mobile-snackbar-host';
        document.body.append(snackbar);

        await ui.deleteComposerWorkspaceBranch(current, 'feature/old', list, 'main');

        expect(fetchCalled).to.equal(false);
        const branches = [...list.querySelectorAll<HTMLElement>(COMPOSER_BRANCH_SHEET_ROW_SELECTOR)]
            .map(row => row.dataset.branchName);
        expect(branches).to.deep.equal(['main', 'feature/old']);
        expect(document.body.textContent).to.contain('Could not delete branch');
    });

    it('shows a human message when branches API rejects an invalid root', async () => {
        const current = project('repo', 'Repo', true);
        globalThis.fetch = (input) => {
            const url = String(input);
            if (url.includes('/branches')) {
                return Promise.resolve(new Response(
                    JSON.stringify({ error: 'Missing or invalid "root" query parameter.' }),
                    { status: 400 },
                ));
            }
            return Promise.reject(new Error(`unexpected fetch: ${url}`));
        };
        const host = createHost([current]);
        host.preparedCwdByProjectId.set(current.id, '/tmp/missing-repo');
        host.projectsService = {
            getProjectCwd: () => '/tmp/missing-repo',
            getCurrentWorkspaceBranch: () => 'main',
            prepareProjectCwd: async () => undefined,
            createGithubProject: async () => [current],
        } as unknown as MobileProjectsStickyComposerWorkspaceHost['projectsService'];
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);
        const list = document.createElement('div');
        list.className = 'theia-mobile-sticky-composer-sheet-list';
        document.body.append(list);
        host.stickyComposerWorkspaceSheet = list;

        await ui.loadComposerWorkspaceBranchSheet(current, list);

        expect(list.textContent).to.contain('Open this project in the workspace to switch branches');
        expect(list.textContent).to.not.contain('Missing or invalid');
        expect(host.preparedCwdByProjectId.has(current.id)).to.equal(false);
    });

    it('tries prepareProjectCwd before giving up when no cwd is cached', async () => {
        const current = project('repo', 'Repo', true);
        let prepared = false;
        globalThis.fetch = () => Promise.reject(new Error('fetch should not run'));
        const host = createHost([current]);
        host.projectsService = {
            getProjectCwd: () => undefined,
            getCurrentWorkspaceBranch: () => 'main',
            prepareProjectCwd: async () => {
                prepared = true;
                return undefined;
            },
            createGithubProject: async () => [current],
        } as unknown as MobileProjectsStickyComposerWorkspaceHost['projectsService'];
        const ui = new MobileProjectsStickyComposerWorkspaceUi(host);
        const list = document.createElement('div');
        document.body.append(list);
        host.stickyComposerWorkspaceSheet = list;

        await ui.loadComposerWorkspaceBranchSheet(current, list);

        expect(prepared).to.equal(true);
        expect(list.textContent).to.contain('Open this project in the workspace to switch branches');
    });
});
