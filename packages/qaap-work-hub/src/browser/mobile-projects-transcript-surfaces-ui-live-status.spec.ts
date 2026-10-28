// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { TranscriptTerminalSliderState } from './mobile-projects-transcript-surfaces-ui';
import type { MobileProjectsTranscriptSurfacesUiContext } from './mobile-projects-transcript-surfaces-ui-context';
import { ensureTranscriptTerminalTabExtracted } from './mobile-projects-transcript-surfaces-ui-live-status';

disableImportJSDOM();

describe('mobile-projects-transcript-surfaces-ui-live-status', () => {

    const project = { id: 'p-terminal', name: 'Terminal' } as MobileProjectEntry;
    const summary = { id: 'conv-terminal' } as QaapAgentConversationSummaryDTO;

    /** A context whose restore resolves only when the test says so, to interleave two mounts. */
    function createContext(persisted: number): {
        ctx: MobileProjectsTranscriptSurfacesUiContext;
        slides: Map<string, TranscriptTerminalSliderState>;
        created: () => number;
        finishRestore: () => void;
    } {
        const slides = new Map<string, TranscriptTerminalSliderState>();
        let createdCount = 0;
        let finishRestore: () => void = () => undefined;
        const restoreGate = new Promise<void>(resolve => {
            finishRestore = resolve;
        });
        const ctx = {
            host: {
                transcriptTerminalSlidesByWorkspace: slides,
                createTranscriptTerminalViewServices: () => ({}),
            },
            executionTerminalHost: () => ({ isConnected: true }),
            resolveTranscriptWorkspaceKey: () => 'workspace',
            resolveTranscriptProjectCwd: () => '/srv/workspace',
            ensureTranscriptTerminalChrome: () => undefined,
            restoreTranscriptTerminalSlides: async (key: string) => {
                await restoreGate;
                const state = slides.get(key)!;
                for (let i = 0; i < persisted; i++) {
                    state.surfaces.push({} as TranscriptTerminalSliderState['surfaces'][number]);
                }
            },
            createTranscriptTerminalSlide: async (key: string) => {
                createdCount++;
                slides.get(key)!.surfaces.push({} as TranscriptTerminalSliderState['surfaces'][number]);
            },
            renderTranscriptTerminalSlides: () => undefined,
        } as unknown as MobileProjectsTranscriptSurfacesUiContext;
        return { ctx, slides, created: () => createdCount, finishRestore: () => finishRestore() };
    }

    it('does not open an extra shell when two mounts race the restore of a page load', async () => {
        const { ctx, slides, created, finishRestore } = createContext(1);
        const first = ensureTranscriptTerminalTabExtracted(ctx, project, summary);
        const second = ensureTranscriptTerminalTabExtracted(ctx, project, summary);
        finishRestore();
        await Promise.all([first, second]);

        expect(created()).to.equal(0);
        expect(slides.get('workspace')!.surfaces).to.have.length(1);
        expect(slides.get('workspace')!.ensuring).to.equal(undefined);
    });

    it('opens exactly one shell when nothing was persisted', async () => {
        const { ctx, slides, created, finishRestore } = createContext(0);
        const first = ensureTranscriptTerminalTabExtracted(ctx, project, summary);
        const second = ensureTranscriptTerminalTabExtracted(ctx, project, summary);
        finishRestore();
        await Promise.all([first, second]);

        expect(created()).to.equal(1);
        expect(slides.get('workspace')!.surfaces).to.have.length(1);
    });

    it('restores the persisted shells only once per page', async () => {
        const { ctx, slides, finishRestore } = createContext(2);
        finishRestore();
        await ensureTranscriptTerminalTabExtracted(ctx, project, summary);
        await ensureTranscriptTerminalTabExtracted(ctx, project, summary);

        expect(slides.get('workspace')!.surfaces).to.have.length(2);
    });
});
