// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectsTranscriptSurfacesUiContext } from './mobile-projects-transcript-surfaces-ui-context';
import { isTranscriptPreviewWaitingExtracted } from './mobile-projects-transcript-surfaces-ui-activity';

describe('isTranscriptPreviewWaitingExtracted', () => {
    const idleConv = { id: 'c1', status: 'idle', messages: [] } as unknown as QaapAgentConversationDTO;

    function ctxFor(bootstrapProjectId: string): MobileProjectsTranscriptSurfacesUiContext {
        return {
            host: { transcriptPreviewSuppressedByUser: false, transcriptPreviewRequestRunning: false, transcriptPreviewRequestPending: false },
            isProjectBootstrapPreviewActive: () => true,
            bootstrapAppliesToProject: (project: MobileProjectEntry) => project.id === bootstrapProjectId,
            mountedPreviewUrl: () => undefined,
            previewScopeId: () => 'scope',
        } as unknown as MobileProjectsTranscriptSurfacesUiContext;
    }

    it('waits for the project whose own dev server is booting', () => {
        expect(isTranscriptPreviewWaitingExtracted(ctxFor('qa-e2e-todo'), idleConv, { id: 'qa-e2e-todo' } as MobileProjectEntry)).to.equal(true);
    });

    it('does not wait (nor sweep ports every 900 ms) because ANOTHER project has a dev server running', () => {
        expect(isTranscriptPreviewWaitingExtracted(ctxFor('qa-e2e-todo'), idleConv, { id: 'esor-vite' } as MobileProjectEntry)).to.equal(false);
    });
});
