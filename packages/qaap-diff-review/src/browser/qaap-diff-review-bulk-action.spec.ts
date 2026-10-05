// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapBulkReviewAction, QaapBulkReviewActionHost, runQaapBulkReviewAction } from './qaap-diff-review-bulk-action';

class RecordingHost implements QaapBulkReviewActionHost {
    readonly commands: string[] = [];
    readonly fileActions: string[] = [];
    confirmations = 0;

    constructor(protected readonly registered: readonly string[], protected readonly confirm = true) { }

    hasCommand(commandId: string): boolean {
        return this.registered.includes(commandId);
    }
    async executeCommand(commandId: string): Promise<unknown> {
        this.commands.push(commandId);
        return undefined;
    }
    async runFileAction(action: QaapBulkReviewAction, file: string): Promise<void> {
        this.fileActions.push(`${action} ${file}`);
    }
    async confirmDiscardAll(): Promise<boolean> {
        this.confirmations++;
        return this.confirm;
    }
}

describe('runQaapBulkReviewAction', () => {
    const files = ['src/a.ts', 'README.md'];

    it('uses the git extension where it runs (IDE page)', async () => {
        const host = new RecordingHost(['git.stageAll', 'git.cleanAll']);
        expect(await runQaapBulkReviewAction('stage', files, host)).to.equal(true);
        expect(await runQaapBulkReviewAction('discard', files, host)).to.equal(true);
        expect(host.commands).to.deep.equal(['git.stageAll', 'git.cleanAll']);
        expect(host.fileActions).to.deep.equal([]);
        expect(host.confirmations).to.equal(0);
    });

    it('accepts every file through the qaap endpoint without plugins (phone, Work Hub page)', async () => {
        const host = new RecordingHost([]);
        expect(await runQaapBulkReviewAction('stage', files, host)).to.equal(true);
        expect(host.commands).to.deep.equal([]);
        expect(host.fileActions).to.deep.equal(['stage src/a.ts', 'stage README.md']);
    });

    it('asks before discarding every file without plugins, and discards nothing when declined', async () => {
        const declined = new RecordingHost([], false);
        expect(await runQaapBulkReviewAction('discard', files, declined)).to.equal(false);
        expect(declined.confirmations).to.equal(1);
        expect(declined.fileActions).to.deep.equal([]);

        const confirmed = new RecordingHost([]);
        expect(await runQaapBulkReviewAction('discard', files, confirmed)).to.equal(true);
        expect(confirmed.fileActions).to.deep.equal(['discard src/a.ts', 'discard README.md']);
    });

    it('does nothing without changed files', async () => {
        const host = new RecordingHost([]);
        expect(await runQaapBulkReviewAction('discard', [], host)).to.equal(false);
        expect(host.confirmations).to.equal(0);
    });
});
