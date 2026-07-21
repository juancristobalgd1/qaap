// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from './mobile-projects-types';
import {
    MobileProjectsTranscriptVerifyUi,
    type MobileProjectsTranscriptVerifyHost,
} from './mobile-projects-transcript-verify-ui';

describe('MobileProjectsTranscriptVerifyUi', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    function createSummary(cwd: string): QaapAgentConversationSummaryDTO {
        return {
            id: 'conv-1',
            title: 'Thread',
            status: 'idle',
            cwd,
            updatedAt: 0,
        } as QaapAgentConversationSummaryDTO;
    }

    function createProject(): MobileProjectEntry {
        return {
            id: 'project-1',
            name: 'Demo',
        } as MobileProjectEntry;
    }

    function createHost(
        checksHost: HTMLElement,
        resolveVerifyChecks: MobileProjectsTranscriptVerifyHost['resolveVerifyChecks'],
    ): MobileProjectsTranscriptVerifyHost {
        return {
            transcriptReviewChecksHost: checksHost,
            transcriptOpenSummaryId: 'conv-1',
            transcriptChecksPanelOpen: false,
            transcriptLastStatus: 'idle',
            verifyAutoAttempts: 0,
            verifyChecksLoading: false,
            verifyChecksCwd: undefined,
            verifyRunning: false,
            verifyResults: [],
            resolveVerifyChecks,
            executionSurfaceTabsUi: {} as MobileProjectsTranscriptVerifyHost['executionSurfaceTabsUi'],
        };
    }

    it('renders a single embedded checks control while loadVerifyChecks starts', async () => {
        const hostEl = document.createElement('div');
        hostEl.className = 'theia-mobile-transcript-review-checks';
        let release!: (checks: Array<{ label: string; command: string }>) => void;
        const pending = new Promise<Array<{ label: string; command: string }>>(resolve => {
            release = resolve;
        });
        const host = createHost(hostEl, async () => pending);
        const ui = new MobileProjectsTranscriptVerifyUi(host);
        const summary = createSummary('/tmp/demo');
        const project = createProject();

        ui.renderChecksSection(hostEl, project, summary, { embedded: true });

        expect(hostEl.querySelectorAll('.theia-mobile-transcript-checks-control')).to.have.lengthOf(1);
        expect(hostEl.textContent).to.contain('Loading');

        release([{ label: 'Build', command: 'npm run build' }]);
        await pending;
        await Promise.resolve();
        await Promise.resolve();

        expect(hostEl.querySelectorAll('.theia-mobile-transcript-checks-control')).to.have.lengthOf(1);
        expect(hostEl.textContent).to.contain('Run Build');
    });
});
