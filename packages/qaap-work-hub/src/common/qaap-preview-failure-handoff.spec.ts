// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildQaapPreviewFailureReport,
    createQaapPreviewHandoffHistory,
    decideQaapPreviewFailureHandoff,
    QAAP_PREVIEW_HANDOFF_MAX_PER_WINDOW,
    QAAP_PREVIEW_HANDOFF_WINDOW_MS,
    recordQaapPreviewFailureHandoff,
    type QaapPreviewFailureConversation,
    type QaapPreviewFailureState,
} from './qaap-preview-failure-handoff';

const REPO = '/workspace/repos/users/me/me/vyyq';
const FAILED: QaapPreviewFailureState = {
    phase: 'run-failed',
    failureKind: 'process-exit',
    error: 'The dev command exited with code 0 without listening on port 3000.',
    previewLogTail: 'Error: Can\'t resolve \'@heroui/styles\'\nImport trace for requested module:\n./app/globals.css\n./app/layout.tsx',
    previewRunId: 'run-1',
    devCommand: 'npm exec -- next dev',
    projectPath: REPO,
};
const CONVERSATION: QaapPreviewFailureConversation = { id: 'c1', cwd: REPO, status: 'idle' };

describe('decideQaapPreviewFailureHandoff', () => {
    it('hands an app error to the idle agent of the conversation open on that project', () => {
        expect(decideQaapPreviewFailureHandoff(FAILED, CONVERSATION, createQaapPreviewHandoffHistory(), 0)).to.be.a('string');
    });

    it('never hands off host problems, missing dependencies or a preview that has not failed', () => {
        const history = createQaapPreviewHandoffHistory();
        for (const failureKind of ['port-conflict', 'out-of-memory', 'permission', 'environment', 'runtime-version', 'next-lock', 'dependencies', 'build-required']) {
            expect(decideQaapPreviewFailureHandoff({ ...FAILED, failureKind }, CONVERSATION, history, 0), failureKind).to.equal(undefined);
        }
        expect(decideQaapPreviewFailureHandoff({ ...FAILED, phase: 'running' }, CONVERSATION, history, 0)).to.equal(undefined);
        expect(decideQaapPreviewFailureHandoff({ ...FAILED, failureKind: 'build-failed' }, CONVERSATION, history, 0)).to.be.a('string');
    });

    it('needs an idle conversation of the same project (or a worktree of it) with a conversation endpoint', () => {
        const history = createQaapPreviewHandoffHistory();
        expect(decideQaapPreviewFailureHandoff(FAILED, undefined, history, 0)).to.equal(undefined);
        expect(decideQaapPreviewFailureHandoff(FAILED, { ...CONVERSATION, status: 'streaming' }, history, 0), 'agent still working').to.equal(undefined);
        expect(decideQaapPreviewFailureHandoff(FAILED, { ...CONVERSATION, source: 'theia-chat' }, history, 0)).to.equal(undefined);
        expect(decideQaapPreviewFailureHandoff(FAILED, { ...CONVERSATION, cwd: '/workspace/repos/users/me/me/other' }, history, 0)).to.equal(undefined);
        expect(decideQaapPreviewFailureHandoff(FAILED, { ...CONVERSATION, cwd: `${REPO}/` }, history, 0), 'trailing slash').to.be.a('string');
        expect(decideQaapPreviewFailureHandoff(FAILED, { ...CONVERSATION, cwd: '/tmp/qaap-worktrees/me/abc', parallelBaseCwd: REPO }, history, 0), 'worktree')
            .to.be.a('string');
    });

    it('hands off each failed run once, and at most a few times per conversation in the window', () => {
        const history = createQaapPreviewHandoffHistory();
        const first = decideQaapPreviewFailureHandoff(FAILED, CONVERSATION, history, 0)!;
        recordQaapPreviewFailureHandoff(history, CONVERSATION.id, first, 0);
        expect(decideQaapPreviewFailureHandoff(FAILED, CONVERSATION, history, 1_000), 'same run').to.equal(undefined);
        for (let run = 2; run <= QAAP_PREVIEW_HANDOFF_MAX_PER_WINDOW; run++) {
            const key = decideQaapPreviewFailureHandoff({ ...FAILED, previewRunId: `run-${run}` }, CONVERSATION, history, run * 1_000)!;
            expect(key, `run ${run}`).to.be.a('string');
            recordQaapPreviewFailureHandoff(history, CONVERSATION.id, key, run * 1_000);
        }
        expect(decideQaapPreviewFailureHandoff({ ...FAILED, previewRunId: 'run-x' }, CONVERSATION, history, 10_000), 'loop stops').to.equal(undefined);
        expect(decideQaapPreviewFailureHandoff({ ...FAILED, previewRunId: 'run-y' }, CONVERSATION, history, QAAP_PREVIEW_HANDOFF_WINDOW_MS + 10_000), 'new window')
            .to.be.a('string');
    });
});

describe('buildQaapPreviewFailureReport', () => {
    it('quotes the command, the error and the dev output, and tells the agent not to leave a dev server running', () => {
        const report = buildQaapPreviewFailureReport(FAILED);
        expect(report).to.contain('`npm exec -- next dev`');
        expect(report).to.contain('without listening on port 3000');
        expect(report).to.contain('./app/globals.css');
        expect(report).to.contain('do not leave a dev server running');
    });
});
