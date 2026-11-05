// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AbstractDialog, DialogProps } from '@theia/core/lib/browser/dialogs';
import { nls } from '@theia/core/lib/common/nls';
import { QaapDirtyWorkspaceError, type QaapAgentConversationIsolation } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

/** What the user chose for a task that would share a dirty working tree. */
export type QaapDirtyWorkspaceChoice = 'startClean' | 'continueHere';

/** How many changed paths the dialog lists by name; the count always covers all of them. */
const LISTED_PATH_LIMIT = 5;

/**
 * Asks before a new task shares a working tree with uncommitted changes. Resolves to the chosen
 * action, or `undefined` when the user cancels (the close button or Escape), which cancels the submit.
 */
export class QaapDirtyWorkspaceDialog extends AbstractDialog<QaapDirtyWorkspaceChoice | undefined> {
    /**
     * Enter accepts the dialog and returns this choice. Start clean is the default, so Enter starts a clean
     * worktree; Escape and the Cancel button close the dialog, which resolves `undefined`.
     */
    protected choice: QaapDirtyWorkspaceChoice | undefined = 'startClean';

    constructor(files: readonly string[], total: number) {
        super({
            title: nls.localize('qaap/workspaceDirty/title', 'This workspace has uncommitted changes'),
        } as DialogProps);
        const message = document.createElement('div');
        message.textContent = nls.localize(
            'qaap/workspaceDirty/body',
            '{0} files were changed outside this task. Start in a clean worktree to keep them out of this task\'s changes, or continue here.',
            total,
        );
        this.contentNode.appendChild(message);
        if (files.length > 0) {
            const list = document.createElement('ul');
            for (const file of files.slice(0, LISTED_PATH_LIMIT)) {
                const item = document.createElement('li');
                item.textContent = file;
                list.appendChild(item);
            }
            this.contentNode.appendChild(list);
        }
        this.appendCloseButton(nls.localizeByDefault('Cancel'));
        this.appendChoiceButton(nls.localize('qaap/workspaceDirty/continueHere', 'Continue here'), false, 'continueHere');
        this.acceptButton = this.appendChoiceButton(nls.localize('qaap/workspaceDirty/startClean', 'Start clean'), true, 'startClean');
    }

    get value(): QaapDirtyWorkspaceChoice | undefined {
        return this.choice;
    }

    protected appendChoiceButton(label: string, primary: boolean, choice: QaapDirtyWorkspaceChoice): HTMLButtonElement {
        const button = this.appendButton(label, primary);
        button.addEventListener('click', () => {
            this.choice = choice;
            this.accept();
        });
        return button;
    }
}

/** Shows the dirty-workspace dialog and resolves the user's choice, or `undefined` when cancelled. */
export function openQaapDirtyWorkspaceDialog(files: readonly string[], total: number): Promise<QaapDirtyWorkspaceChoice | undefined> {
    return new QaapDirtyWorkspaceDialog(files, total).open();
}

/** The create options a dirty-workspace choice retries with. */
export type QaapDirtyWorkspaceRetryOptions = { readonly isolation?: QaapAgentConversationIsolation; readonly acceptDirty?: boolean };

/**
 * Handles a create refused with 409 `dirty_workspace`: asks the user, then retries once. "Start clean"
 * retries in a worktree; "Continue here" retries sharing the tree. Resolves `undefined` when the user
 * cancels, in which case nothing was created.
 */
export async function retryAfterDirtyWorkspace<T>(
    error: QaapDirtyWorkspaceError,
    retry: (options: QaapDirtyWorkspaceRetryOptions) => Promise<T>,
    ask: (files: readonly string[], total: number) => Promise<QaapDirtyWorkspaceChoice | undefined> = openQaapDirtyWorkspaceDialog,
): Promise<T | undefined> {
    const choice = await ask(error.files, error.total);
    if (!choice) {
        return undefined;
    }
    return choice === 'startClean' ? retry({ isolation: 'worktree' }) : retry({ acceptDirty: true });
}
