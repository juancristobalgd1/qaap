// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import { MobileProjectsHubHeaderUi, type MobileProjectsHubHeaderHost } from './mobile-projects-hub-header-ui';
import { mountHeaderProjectButtonContents } from './mobile-projects-panel-chrome-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

describe('MobileProjectsHubHeaderUi', () => {

    beforeEach(() => {
        if (typeof document === 'undefined') {
            enableJSDOM();
        }
    });
    function project(id: string, name: string): MobileProjectEntry {
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
            isCurrent: false,
        };
    }

    function createHost(options?: {
        readonly agentsHubInlineActive?: boolean;
        readonly agentsHubShellActive?: boolean;
        readonly transcriptOpenProject?: MobileProjectEntry;
        readonly shellProject?: MobileProjectEntry;
        readonly activeTab?: 'messages' | 'terminal';
    }): MobileProjectsHubHeaderHost {
        const shellProject = options?.shellProject;
        const activeTab = options?.activeTab ?? 'messages';
        const headerProjectCluster = document.createElement('div');
        const headerProjectBtn = document.createElement('button');
        const headerConversationsBtn = document.createElement('button');
        const headerProjectLabelEl = document.createElement('span');
        mountHeaderProjectButtonContents(
            headerProjectCluster, headerProjectBtn, headerConversationsBtn, headerProjectLabelEl,
        );
        return {
            sessionsMenuBtn: document.createElement('button'),
            headerProjectCluster,
            headerProjectBtn,
            headerProjectLabelEl,
            headerConversationsBtn,
            headerNewChatBtn: document.createElement('button'),
            headerOverflowMenuBtn: document.createElement('button'),
            headerBackBtn: document.createElement('button'),
            titleBlock: document.createElement('div'),
            titleEl: document.createElement('h1'),
            titleAttentionEl: document.createElement('span'),
            accountBtn: document.createElement('button'),
            homeMode: true,
            hubView: 'tasks',
            agentsHubInlineActive: options?.agentsHubInlineActive ?? false,
            agentsHubShellActive: options?.agentsHubShellActive ?? false,
            transcriptOpenProject: options?.transcriptOpenProject,
            transcriptOpenSummary: undefined,
            projects: shellProject || options?.transcriptOpenProject
                ? [shellProject, options?.transcriptOpenProject].filter((entry): entry is MobileProjectEntry => !!entry)
                : [],
            isProjectDetailView: () => false,
            isProjectDiffView: () => false,
            shouldUseAgentsHubLanding: () => true,
            resolveAgentsHubShellProject: () => shellProject,
            resolveHomePinnedProject: () => shellProject ?? options?.transcriptOpenProject,
            composerHeaderUi: {
                resolveStickyComposerProject: (projects: MobileProjectEntry[]) => projects[0],
            } as unknown as MobileProjectsHubHeaderHost['composerHeaderUi'],
            conversationIndexUi: {
                conversationsForProject: () => [],
            },
            cardMenuUi: {
                buildConversationMenu: () => document.createElement('div'),
                toggleCardMenu: () => undefined,
            },
            hubQueryUi: {} as MobileProjectsHubHeaderHost['hubQueryUi'],
            projectNavigationUi: {} as MobileProjectsHubHeaderHost['projectNavigationUi'],
            transcriptHeaderUi: {} as MobileProjectsHubHeaderHost['transcriptHeaderUi'],
            transcriptSheetUi: {} as MobileProjectsHubHeaderHost['transcriptSheetUi'],
            executionSurfaceTabsUi: {
                executionSurfaceTabForProject: () => activeTab,
            } as unknown as MobileProjectsHubHeaderHost['executionSurfaceTabsUi'],
            updateTasksAttentionChrome: () => undefined,
            buildHomeGreeting: () => 'Hello',
            scroll: document.createElement('div'),
            lastTitleTap: 0,
            closeAgentsHubSession: () => undefined,
            closeProjectDiffView: () => undefined,
            closeProjectDetail: () => undefined,
            openWorkHubSessionsSidebar: () => undefined,
        };
    }

    it('shows New agent only when the chat execution surface is active', () => {
        const current = project('mockup', 'Mockup');
        const ui = new MobileProjectsHubHeaderUi(createHost({
            agentsHubInlineActive: true,
            transcriptOpenProject: current,
            activeTab: 'messages',
        }));
        expect(ui.resolveHeaderNewChatVisible()).to.equal(true);
    });

    it('hides New agent when a non-chat execution surface is active', () => {
        const current = project('mockup', 'Mockup');
        const ui = new MobileProjectsHubHeaderUi(createHost({
            agentsHubInlineActive: true,
            transcriptOpenProject: current,
            activeTab: 'terminal',
        }));
        expect(ui.resolveHeaderNewChatVisible()).to.equal(false);
    });

    it('hides New agent on agents hub landing without an execution shell', () => {
        const ui = new MobileProjectsHubHeaderUi(createHost());
        expect(ui.resolveHeaderNewChatVisible()).to.equal(false);
    });

    it('Back returns to Messages from a tool surface before closing the inline session', () => {
        const current = project('mockup', 'Mockup');
        let navBackCalls = 0;
        let sessionClosed = false;
        let sheetClosed = false;
        const host = createHost({ agentsHubInlineActive: true, transcriptOpenProject: current, activeTab: 'terminal' });
        host.projectNavigationUi = { resolveSelectedProject: () => current } as MobileProjectsHubHeaderHost['projectNavigationUi'];
        host.executionSurfaceTabsUi = {
            executionSurfaceTabForProject: () => 'terminal',
            navigateExecutionSurfaceBack: () => { navBackCalls++; return true; },
        } as unknown as MobileProjectsHubHeaderHost['executionSurfaceTabsUi'];
        host.closeAgentsHubSession = () => { sessionClosed = true; };
        host.transcriptSheetUi = { closeTranscriptSheet: () => { sheetClosed = true; } } as MobileProjectsHubHeaderHost['transcriptSheetUi'];

        new MobileProjectsHubHeaderUi(host).handleHeaderBackClick();
        expect(navBackCalls).to.equal(1);
        expect(sessionClosed).to.equal(false);
        expect(sheetClosed).to.equal(false);
    });

    it('Back closes the inline session once already on Messages', () => {
        const current = project('mockup', 'Mockup');
        let sessionClosed = false;
        const host = createHost({ agentsHubInlineActive: true, transcriptOpenProject: current, activeTab: 'messages' });
        host.projectNavigationUi = { resolveSelectedProject: () => current } as MobileProjectsHubHeaderHost['projectNavigationUi'];
        host.executionSurfaceTabsUi = {
            executionSurfaceTabForProject: () => 'messages',
            navigateExecutionSurfaceBack: () => false, // self-guards to false on Messages
        } as unknown as MobileProjectsHubHeaderHost['executionSurfaceTabsUi'];
        host.shouldUseAgentsHubLanding = () => true;
        host.closeAgentsHubSession = () => { sessionClosed = true; };

        new MobileProjectsHubHeaderUi(host).handleHeaderBackClick();
        expect(sessionClosed).to.equal(true);
    });

    describe('renderHeader — title visibility', () => {
        function createRenderableHost(options?: {
            readonly agentsHubInlineActive?: boolean;
            readonly transcriptOpenProject?: MobileProjectEntry;
            readonly transcriptOpenSummary?: MobileProjectsHubHeaderHost['transcriptOpenSummary'];
            readonly transcriptTitle?: string;
            readonly useAgentsHubLanding?: boolean;
            readonly hubView?: MobileProjectsHubHeaderHost['hubView'];
        }): MobileProjectsHubHeaderHost {
            const p = options?.transcriptOpenProject;
            const host = createHost({
                agentsHubInlineActive: options?.agentsHubInlineActive ?? false,
                transcriptOpenProject: p,
            });
            host.hubView = options?.hubView ?? 'tasks';
            host.transcriptOpenSummary = options?.transcriptOpenSummary;
            host.shouldUseAgentsHubLanding = () => options?.useAgentsHubLanding ?? true;
            host.hubQueryUi = { isSidebarSecondaryHubView: () => false } as unknown as MobileProjectsHubHeaderHost['hubQueryUi'];
            host.projectNavigationUi = { resolveSelectedProject: () => undefined } as unknown as MobileProjectsHubHeaderHost['projectNavigationUi'];
            host.transcriptHeaderUi = {
                resolveTranscriptHeaderTitle: () => options?.transcriptTitle ?? 'Mockup · Add tests',
            } as unknown as MobileProjectsHubHeaderHost['transcriptHeaderUi'];
            return host;
        }

        it('hides the transcript title visually (sr-only) when an inline agent session is open', () => {
            const p = project('mockup', 'Mockup');
            const summary = { id: 'test-id', title: 'Add tests' } as MobileProjectsHubHeaderHost['transcriptOpenSummary'];
            const host = createRenderableHost({
                agentsHubInlineActive: true,
                transcriptOpenProject: p,
                transcriptOpenSummary: summary,
                transcriptTitle: 'Mockup · Add tests',
            });

            new MobileProjectsHubHeaderUi(host).renderHeader();

            expect(host.titleEl.classList.contains('theia-mod-sr-only')).to.equal(true,
                'title must carry theia-mod-sr-only when an inline session is open');
            expect(host.titleEl.textContent).to.equal('Mockup · Add tests',
                'textContent must be preserved for screen readers');
        });

        it('hides the Agents landing title visually while preserving accessible text', () => {
            const host = createRenderableHost({ useAgentsHubLanding: true });

            new MobileProjectsHubHeaderUi(host).renderHeader();

            expect(host.titleEl.classList.contains('theia-mod-sr-only')).to.equal(true);
            expect(host.titleEl.textContent).to.equal('Agents');
        });

        it('unhides New agent when chat is active on Agents hub', () => {
            const p = project('mockup', 'Mockup');
            const host = createRenderableHost({
                agentsHubInlineActive: true,
                transcriptOpenProject: p,
            });
            host.headerNewChatBtn.hidden = true;

            new MobileProjectsHubHeaderUi(host).renderHeader();

            expect(host.headerNewChatBtn.hidden).to.equal(false);
            expect(host.headerNewChatBtn.getAttribute('aria-hidden')).to.equal('false');
        });

        it('shows the header project control with the conversation title beside the switcher', () => {
            const p = project('mockup', 'Mockup');
            const summary = {
                id: 'test-id',
                title: 'Corrige aislamiento de pre',
            } as MobileProjectsHubHeaderHost['transcriptOpenSummary'];
            const host = createRenderableHost({
                agentsHubInlineActive: true,
                transcriptOpenProject: p,
                transcriptOpenSummary: summary,
                transcriptTitle: 'Mockup · Corrige aislamiento de pre',
            });
            host.projects = [p];
            host.resolveHomePinnedProject = () => p;
            host.composerHeaderUi = {
                resolveStickyComposerProject: () => p,
            } as unknown as MobileProjectsHubHeaderHost['composerHeaderUi'];

            new MobileProjectsHubHeaderUi(host).renderHeader();

            expect(host.headerProjectCluster.hidden).to.equal(false);
            expect(host.headerProjectLabelEl.textContent).to.equal('Corrige aislamiento de pre');
            expect(host.headerProjectCluster.classList.contains('theia-mod-conversation-title')).to.equal(true);
            const separator = host.headerProjectCluster.querySelector('.theia-mobile-projects-header-project-separator');
            expect(separator).to.not.equal(null);
            expect((separator as HTMLElement).hidden).to.equal(false);
            expect(separator!.textContent).to.equal('|');
            expect(host.headerProjectBtn.getAttribute('aria-label')).to.contain('Mockup');
            expect(host.headerProjectBtn.querySelector('.codicon-folder')).to.not.equal(null);
            expect(host.headerProjectBtn.querySelector('.codicon-chevron-down')).to.not.equal(null);
            expect(host.headerConversationsBtn.querySelector('.theia-mobile-projects-header-conversations-icon')).to.not.equal(null);
            expect(host.headerConversationsBtn.getAttribute('aria-label')).to.equal('Task options');
            expect(host.headerConversationsBtn.getAttribute('aria-haspopup')).to.equal('menu');
        });

        it('shows the active project name in the header project control on Agents landing', () => {
            const p = project('mockup', 'Mockup');
            const host = createRenderableHost({ useAgentsHubLanding: true });
            host.projects = [p];
            host.resolveHomePinnedProject = () => p;
            host.composerHeaderUi = {
                resolveStickyComposerProject: () => p,
            } as unknown as MobileProjectsHubHeaderHost['composerHeaderUi'];

            new MobileProjectsHubHeaderUi(host).renderHeader();

            expect(host.headerProjectCluster.hidden).to.equal(false);
            expect(host.headerProjectLabelEl.textContent).to.equal('Mockup');
            expect(host.headerProjectCluster.classList.contains('theia-mod-conversation-title')).to.equal(false);
            expect(host.headerProjectBtn.querySelector('.codicon-folder')).to.not.equal(null);
            const landingSeparator = host.headerProjectCluster.querySelector('.theia-mobile-projects-header-project-separator');
            expect(landingSeparator).to.not.equal(null);
            expect((landingSeparator as HTMLElement).hidden).to.equal(true);
            expect(host.headerProjectBtn.querySelector('.codicon-chevron-down')).to.not.equal(null);
            expect(host.headerConversationsBtn.querySelector('.theia-mobile-projects-header-conversations-icon')).to.not.equal(null);
            expect(host.headerConversationsBtn.getAttribute('aria-label')).to.equal('Task options');
        });

        it('keeps titles visible on non-Agents surfaces', () => {
            const tasksHost = createRenderableHost({ useAgentsHubLanding: false });
            tasksHost.titleEl.classList.add('theia-mod-sr-only');
            new MobileProjectsHubHeaderUi(tasksHost).renderHeader();
            expect(tasksHost.titleEl.classList.contains('theia-mod-sr-only')).to.equal(false);
            expect(tasksHost.titleEl.textContent).to.equal('Tasks');

            const reviewHost = createRenderableHost({ hubView: 'review' });
            reviewHost.titleEl.classList.add('theia-mod-sr-only');
            new MobileProjectsHubHeaderUi(reviewHost).renderHeader();
            expect(reviewHost.titleEl.classList.contains('theia-mod-sr-only')).to.equal(false);
            expect(reviewHost.titleEl.textContent).to.equal('Review');
        });
    });

    it('shows the header overflow menu only when the chat execution surface is active', () => {
        const current = project('mockup', 'Mockup');
        const ui = new MobileProjectsHubHeaderUi(createHost({
            agentsHubInlineActive: true,
            transcriptOpenProject: current,
            activeTab: 'messages',
        }));
        expect(ui.resolveHeaderOverflowMenuVisible()).to.equal(true);

        const terminalUi = new MobileProjectsHubHeaderUi(createHost({
            agentsHubInlineActive: true,
            transcriptOpenProject: current,
            activeTab: 'terminal',
        }));
        expect(terminalUi.resolveHeaderOverflowMenuVisible()).to.equal(false);
    });

    describe('header conversation task menu', () => {
        const summary = {
            id: 'conv-1',
            title: 'Find and fix a bug',
            status: 'failed',
        } as MobileProjectsHubHeaderHost['transcriptOpenSummary'];

        it('targets the open conversation when an inline session is active', () => {
            const p = project('mockup', 'Mockup');
            const host = createHost({ agentsHubInlineActive: true, transcriptOpenProject: p });
            host.transcriptOpenSummary = summary;
            host.conversationIndexUi = {
                conversationsForProject: () => [{ id: 'other' } as never],
            };
            const target = new MobileProjectsHubHeaderUi(host).resolveHeaderConversationMenuTarget();
            expect(target?.project).to.equal(p);
            expect(target?.summary).to.equal(summary);
        });

        it('targets the latest project conversation on Agents landing', () => {
            const p = project('mockup', 'Mockup');
            const host = createHost();
            host.projects = [p];
            host.resolveHomePinnedProject = () => p;
            host.conversationIndexUi = {
                conversationsForProject: () => [summary as never],
            };
            const target = new MobileProjectsHubHeaderUi(host).resolveHeaderConversationMenuTarget();
            expect(target?.project.id).to.equal('mockup');
            expect(target?.summary.id).to.equal('conv-1');
        });

        it('does not open a menu when the project has no conversations', () => {
            const p = project('mockup', 'Mockup');
            let toggled = 0;
            const host = createHost();
            host.projects = [p];
            host.resolveHomePinnedProject = () => p;
            host.cardMenuUi = {
                buildConversationMenu: () => document.createElement('div'),
                toggleCardMenu: () => { toggled += 1; },
            };
            new MobileProjectsHubHeaderUi(host).openHeaderConversationMenu(host.headerConversationsBtn);
            expect(toggled).to.equal(0);
        });

        it('opens the sidebar conversation menu from the header chevron', () => {
            const p = project('mockup', 'Mockup');
            const menu = document.createElement('div');
            let builtFor: { id: string } | undefined;
            let toggledAnchor: HTMLButtonElement | undefined;
            const host = createHost();
            host.projects = [p];
            host.resolveHomePinnedProject = () => p;
            host.conversationIndexUi = {
                conversationsForProject: () => [summary as never],
            };
            host.cardMenuUi = {
                buildConversationMenu: (_project, next) => {
                    builtFor = next;
                    return menu;
                },
                toggleCardMenu: (_card, _menu, menuBtn) => {
                    toggledAnchor = menuBtn;
                },
            };
            new MobileProjectsHubHeaderUi(host).openHeaderConversationMenu(host.headerConversationsBtn);
            expect(builtFor?.id).to.equal('conv-1');
            expect(toggledAnchor).to.equal(host.headerConversationsBtn);
        });
    });
});
