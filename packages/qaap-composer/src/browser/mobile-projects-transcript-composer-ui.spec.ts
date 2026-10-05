// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { QaapAgentTaskAgentOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { buildAgentsHubIdleConversationSummary } from '@theia/qaap-shared-core/lib/common/qaap-agents-hub-landing';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { MobileProjectsTranscriptComposerUi, type MobileProjectsTranscriptComposerHost } from './mobile-projects-transcript-composer-ui';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('MobileProjectsTranscriptComposerUi agent label', () => {

    useSuiteJSDOM();

    const project = { id: 'project', name: 'Project' } as MobileProjectEntry;

    /** Mirrors the conversation-row label: no agent and no default agent yet means @shell. */
    function createUi(
        backendAgents: QaapAgentTaskAgentOption[],
        summary: QaapAgentConversationSummaryDTO | undefined,
    ): MobileProjectsTranscriptComposerUi {
        const host = {
            transcriptComposerPinnedAgentId: undefined,
            transcriptComposerBackendAgents: backendAgents,
            transcriptComposerSummary: summary,
            projectsService: { getProjectCwd: () => '/workspace/project' },
            stickyComposerAgentsUi: {
                filterSelectableComposerAgents: (agents: QaapAgentTaskAgentOption[]) => agents.filter(a => a.available),
            },
            projectRowsUi: {
                resolveConversationAgentLabel: (s?: QaapAgentConversationSummaryDTO) =>
                    s?.agentId && s.agentId !== 'task' ? `@${s.agentId}` : '@shell',
            },
        } as unknown as MobileProjectsTranscriptComposerHost;
        return new MobileProjectsTranscriptComposerUi(host);
    }

    function labelFor(ui: MobileProjectsTranscriptComposerUi, summary: QaapAgentConversationSummaryDTO): string {
        return ui.resolveTranscriptComposerAgentLabel(ui.resolveTranscriptComposerPinnedAgentId(project, summary));
    }

    beforeEach(() => {
        window.localStorage.clear();
    });

    it('names the agent the idle Work Hub composer resolved, never @shell', () => {
        const idle = buildAgentsHubIdleConversationSummary('/workspace/project');
        const ui = createUi([{ id: 'opencode', label: 'OpenCode', available: true }], idle);
        expect(ui.resolveTranscriptComposerPinnedAgentId(project, idle)).to.equal('opencode');
        expect(labelFor(ui, idle)).to.equal('OpenCode');
    });

    it('shows a neutral label while the idle composer has no agent yet', () => {
        const idle = buildAgentsHubIdleConversationSummary('/workspace/project');
        expect(labelFor(createUi([], idle), idle)).to.equal('Agent');
        expect(labelFor(createUi([], undefined), idle)).to.equal('Agent');
    });

    it('keeps the label of a real conversation, including a shell one', () => {
        const shellRun = { ...buildAgentsHubIdleConversationSummary('/workspace/project'), id: 'c1', agentId: 'shell' };
        expect(labelFor(createUi([{ id: 'opencode', label: 'OpenCode', available: true }], shellRun), shellRun))
            .to.equal('@shell');
    });
});
