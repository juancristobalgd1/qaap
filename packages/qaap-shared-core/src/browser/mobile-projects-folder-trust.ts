// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import { nls } from '@theia/core/lib/common/nls';
import { QaapProjectFolderTrustClient, shouldAskProjectFolderTrust } from '../common/qaap-project-folder-trust';

export interface MobileProjectFolderTrustDialogOptions {
    readonly title: string;
    readonly msg: string;
    readonly trustLabel: string;
    readonly distrustLabel: string;
}

/**
 * "Do you trust the files in this folder?" dialog. Resolves `true` for "Trust folder", `false` for
 * "Don't trust", and `undefined` when it is dismissed (Escape or the close control) without an answer.
 * A plain confirm dialog cannot tell the last two apart, and dismissing must not record a decision.
 */
export class MobileProjectFolderTrustDialog extends AbstractDialog<boolean | undefined> {

    protected answer: boolean | undefined;

    constructor(options: MobileProjectFolderTrustDialogOptions) {
        super({ title: options.title, maxWidth: 480 });
        const message = this.node.ownerDocument.createElement('div');
        message.textContent = options.msg;
        this.contentNode.appendChild(message);
        const distrustButton = this.appendButton(options.distrustLabel, false);
        distrustButton.addEventListener('click', () => {
            this.answer = false;
            void this.accept();
        });
        this.appendAcceptButton(options.trustLabel);
    }

    get value(): boolean | undefined {
        return this.answer;
    }

    protected override async accept(): Promise<void> {
        this.answer ??= true;
        await super.accept();
    }
}

/**
 * Asks each project folder once for trust, then keeps the answer on the server. Only the owner's own
 * decision is read or written; the server rejects folders the caller does not own.
 */
export class MobileProjectFolderTrust {

    readonly client = new QaapProjectFolderTrustClient();

    /** Folders whose dialog is open, or was dismissed this page session (asked again after a reload). */
    protected readonly askedThisSession = new Set<string>();

    /** Trust state from the last read or answer; an unknown folder counts as not trusted. */
    isTrusted(cwd: string): boolean {
        return this.client.cached(cwd)?.trusted === true;
    }

    /** Opens the dialog for `cwd` when its decision is still unknown. Never rejects. */
    async askIfUndecided(cwd: string, projectName: string): Promise<void> {
        if (this.askedThisSession.has(cwd)) {
            return;
        }
        const status = this.client.cached(cwd) ?? await this.client.load(cwd);
        if (!shouldAskProjectFolderTrust(status, this.askedThisSession.has(cwd))) {
            return;
        }
        this.askedThisSession.add(cwd);
        try {
            const answer = await new MobileProjectFolderTrustDialog({
                title: nls.localize('qaap/mobileProjects/folderTrustTitle', 'Do you trust the files in this folder?'),
                msg: nls.localize(
                    'qaap/mobileProjects/folderTrustMessage',
                    '{0}: agents can load this repository\'s own agent settings, extensions and MCP servers. Only trust folders whose code you trust.',
                    projectName,
                ),
                trustLabel: nls.localize('qaap/mobileProjects/folderTrustAccept', 'Trust folder'),
                distrustLabel: nls.localize('qaap/mobileProjects/folderTrustDecline', 'Don\'t trust'),
            }).open();
            if (answer === undefined) {
                // Dismissed: no decision is stored, so the next page session asks again.
                return;
            }
            await this.client.setTrusted(cwd, answer);
        } catch (error) {
            console.warn('[qaap-project-trust] could not record the folder decision:', error instanceof Error ? error.message : String(error));
        }
    }

    /** Changes the decision from the project menu. Rejects when the server refuses the write. */
    async setTrusted(cwd: string, trusted: boolean): Promise<boolean> {
        const status = await this.client.setTrusted(cwd, trusted);
        return status.trusted;
    }
}
