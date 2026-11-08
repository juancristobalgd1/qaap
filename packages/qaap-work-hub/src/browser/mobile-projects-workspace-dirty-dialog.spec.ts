// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
// Modules below may touch the DOM while loading; it is removed again after the imports
const disableImportJSDOM = enableJSDOM();
import { expect } from 'chai';
import { QaapDirtyWorkspaceError } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { QaapDirtyWorkspaceDialog, retryAfterDirtyWorkspace } from './mobile-projects-workspace-dirty-dialog';
disableImportJSDOM();

describe('QaapDirtyWorkspaceDialog', () => {
    useSuiteJSDOM();

    it('defaults to Start clean, so Enter selects it', () => {
        const dialog = new QaapDirtyWorkspaceDialog(['README.md'], 1);
        expect(dialog.value).to.equal('startClean');
    });

    it('lists the changed files it was given', () => {
        const dialog = new QaapDirtyWorkspaceDialog(['README.md', 'hello.txt'], 2);
        const content = (dialog as unknown as { contentNode: HTMLElement }).contentNode;
        expect(content.textContent).to.contain('README.md');
        expect(content.textContent).to.contain('hello.txt');
    });

    describe('retryAfterDirtyWorkspace', () => {
        const error = new QaapDirtyWorkspaceError('dirty', ['README.md'], 1);

        it('retries in a worktree on Start clean', async () => {
            const seen: unknown[] = [];
            const result = await retryAfterDirtyWorkspace(error, async options => { seen.push(options); return 'created'; }, async () => 'startClean');
            expect(result).to.equal('created');
            expect(seen).to.deep.equal([{ isolation: 'worktree' }]);
        });

        it('retries with acceptDirty on Continue here', async () => {
            const seen: unknown[] = [];
            await retryAfterDirtyWorkspace(error, async options => { seen.push(options); return 'created'; }, async () => 'continueHere');
            expect(seen).to.deep.equal([{ acceptDirty: true }]);
        });

        it('creates nothing and resolves undefined on cancel', async () => {
            let retried = false;
            const result = await retryAfterDirtyWorkspace(error, async () => { retried = true; return 'created'; }, async () => undefined);
            expect(result).to.equal(undefined);
            expect(retried).to.equal(false);
        });
    });
});
