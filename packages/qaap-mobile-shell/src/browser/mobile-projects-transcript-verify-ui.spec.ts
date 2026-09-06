// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isAgentTaskFinished } from '../common/qaap-agent-task-client';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from './mobile-projects-types';
import {
    MobileProjectsTranscriptVerifyUi,
    type MobileProjectsTranscriptVerifyHost,
} from './mobile-projects-transcript-verify-ui';

describe('MobileProjectsTranscriptVerifyUi', () => {

    it('schedules freshness checks in the embedded review panel too', async () => {
        class TestUi extends MobileProjectsTranscriptVerifyUi {
            scheduled = 0;
            protected override scheduleFreshnessCheck(): void { this.scheduled++; }
        }
        const element = document.createElement('div');
        const host = createHost(element, async () => [{ label: 'Test', command: 'npm test' }]);
        const ui = new TestUi(host);
        const summary = createSummary('/repo');
        await ui.loadVerifyChecks('/repo', createProject(), summary);
        const before = ui.scheduled;
        ui.renderChecksSection(element, createProject(), summary, { embedded: true });
        expect(ui.scheduled).to.equal(before + 1);
    });

    it('waits for queued tasks and unknown future states', () => {
        expect(isAgentTaskFinished('queued')).to.equal(false);
        expect(isAgentTaskFinished('running')).to.equal(false);
        expect(isAgentTaskFinished('starting')).to.equal(false);
        expect(isAgentTaskFinished('interrupted')).to.equal(true);
        expect(isAgentTaskFinished('completed')).to.equal(true);
    });

    it('labels the compact chip from current-file evidence, not just the last run', () => {
        const host = createHost(document.createElement('div'), undefined);
        const ui = new MobileProjectsTranscriptVerifyUi(host);
        host.verifyResults = [{
            check: { label: 'Test', command: 'npm test' },
            state: 'ok',
            workspaceSnapshot: 'current',
        }];
        expect(ui.transcriptChecksChipLabel(0, true, true).text).to.contain('current files');
        host.verifyResults[0].workspaceSnapshot = 'changed';
        expect(ui.transcriptChecksChipLabel(0, true, true).text).to.contain('Files changed');
    });

    it('shows command output and removes the success dot when files changed', () => {
        const host = createHost(document.createElement('div'), undefined);
        const ui = new MobileProjectsTranscriptVerifyUi(host);
        const row = ui.createVerifyCheckRow({ check: { label: 'Test', command: 'node --test' }, state: 'ok', exitCode: 0, logTail: '2 passed', workspaceSnapshot: 'changed' });
        expect(row.textContent).to.contain('node --test');
        expect(row.textContent).to.contain('2 passed');
        expect(row.textContent).to.contain('Files changed');
        expect(row.querySelector('.theia-mod-ok')).to.equal(null);
    });

    it('discards an older project check load that finishes after the new one', async () => {
        let release!: (checks: Array<{ label: string; command: string }>) => void;
        const pending = new Promise<Array<{ label: string; command: string }>>(resolve => { release = resolve; });
        const host = createHost(document.createElement('div'), async cwd => cwd === '/old' ? pending : [{ label: 'New', command: 'npm test' }]);
        const ui = new MobileProjectsTranscriptVerifyUi(host);
        const first = ui.loadVerifyChecks('/old', createProject(), createSummary('/old'));
        await ui.loadVerifyChecks('/new', createProject(), { ...createSummary('/new'), id: 'conv-2' });
        release([{ label: 'Old', command: 'old' }]);
        await first;
        expect(host.verifyResults[0].check.label).to.equal('New');
    });

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
