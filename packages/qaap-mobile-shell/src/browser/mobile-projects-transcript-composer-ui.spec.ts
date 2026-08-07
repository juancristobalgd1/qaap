// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// ****************************************************************************

import { expect } from 'chai';
import { writeStoredAgentModel } from '../common/qaap-agent-task-client';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from './mobile-projects-types';

describe('mobile-projects-transcript-composer-ui agent model selection', () => {
    const storage = new Map<string, string>();
    let ComposerUi: typeof import('./mobile-projects-transcript-composer-ui').MobileProjectsTranscriptComposerUi;

    before(() => {
        ComposerUi = require('./mobile-projects-transcript-composer-ui').MobileProjectsTranscriptComposerUi;
    });

    beforeEach(() => {
        storage.clear();
        (global as unknown as { window: Window }).window = {
            localStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => { storage.set(key, value); },
                removeItem: (key: string) => { storage.delete(key); },
                clear: () => { storage.clear(); },
                key: () => null,
                length: 0,
            },
        } as unknown as Window;
    });

    it('keeps OpenClaude as the selected agent and displays its stored model', () => {
        const cwd = '/repo/openclaude';
        const model = {
            provider: 'anthropic' as const,
            vendor: 'anthropic',
            modelId: 'claude-opus-4-7',
        };
        writeStoredAgentModel(cwd, 'openclaude', model);

        const ui = new ComposerUi({
            transcriptComposerPinnedAgentId: 'openclaude',
            transcriptComposerAgentModel: undefined,
            transcriptComposerPrefsConvId: undefined,
            projectsService: { getProjectCwd: () => cwd },
        } as any);
        const project = { id: 'project-1' } as unknown as MobileProjectEntry;
        const summary = { id: 'conversation-1', cwd, agentId: 'qaiq' } as unknown as QaapAgentConversationSummaryDTO;

        expect(ui.resolveTranscriptComposerPinnedAgentId(project, summary)).to.equal('openclaude');
        expect(ui.resolveTranscriptComposerAgentModel('openclaude', cwd)).to.deep.equal(model);
        expect(ui.resolveTranscriptComposerModelLabel('openclaude', cwd)).to.include('claude-opus-4-7');
    });
});
