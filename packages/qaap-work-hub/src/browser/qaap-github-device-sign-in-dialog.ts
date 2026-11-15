// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapGithubDevicePollResult, QaapGithubDeviceStart } from '@theia/qaap-adapters/lib/browser/qaap-github-device-client';

/** Server calls of the dialog; injected so the state machine is testable without HTTP. */
export interface QaapGithubDeviceSignInApi {
    start(): Promise<QaapGithubDeviceStart>;
    poll(flowId: string): Promise<QaapGithubDevicePollResult>;
}

export interface QaapGithubDeviceSignInOptions {
    readonly api: QaapGithubDeviceSignInApi;
    /** Opens GitHub's verification page in the system browser (Theia's external-link mechanism). */
    openExternal(url: string): void;
    /** Called once, after GitHub approved the sign-in and the backend set the session cookie. */
    onSignedIn(): void;
}

/**
 * Desktop "Sign in with GitHub" dialog (RFC 8628 device flow). It shows the code, opens GitHub, polls
 * the backend at the interval the backend asks for, and closes on success. The device code never
 * reaches the browser; only the user code and the verification URL are shown.
 */
export class QaapGithubDeviceSignInDialog {

    readonly node: HTMLElement;
    protected readonly codeElement: HTMLElement;
    protected readonly codeRow: HTMLElement;
    protected readonly statusElement: HTMLElement;
    protected readonly errorElement: HTMLElement;
    protected readonly copyButton: HTMLButtonElement;
    protected readonly openButton: HTMLButtonElement;
    protected readonly retryButton: HTMLButtonElement;
    protected flowId: string | undefined;
    protected verificationUri: string | undefined;
    protected timer: ReturnType<typeof setTimeout> | undefined;
    /** Incremented on every open and close, so a late answer from an old flow is ignored. */
    protected generation = 0;

    constructor(protected readonly options: QaapGithubDeviceSignInOptions) {
        this.node = document.createElement('div');
        this.node.className = 'theia-mobile-github-device';
        this.node.hidden = true;
        this.node.setAttribute('role', 'dialog');
        this.node.setAttribute('aria-modal', 'true');

        const card = document.createElement('div');
        card.className = 'theia-mobile-github-device-card';
        const title = document.createElement('h2');
        title.className = 'theia-mobile-github-device-title';
        title.textContent = nls.localize('qaap/githubDevice/title', 'Sign in with GitHub');
        const intro = document.createElement('p');
        intro.className = 'theia-mobile-github-device-text';
        intro.textContent = nls.localize(
            'qaap/githubDevice/intro',
            'Open GitHub and enter this code to allow Qaap to import your repositories.'
        );
        this.codeElement = document.createElement('code');
        this.codeElement.className = 'theia-mobile-github-device-code';
        const codeRow = document.createElement('div');
        codeRow.className = 'theia-mobile-github-device-code-row';
        this.copyButton = this.createButton(nls.localize('qaap/githubDevice/copyCode', 'Copy code'), 'theia-mod-secondary', () => void this.copyCode());
        codeRow.append(this.codeElement, this.copyButton);
        // Shown only once GitHub has issued a user code (never an empty box, also on errors).
        this.codeRow = codeRow;
        codeRow.hidden = true;
        this.statusElement = document.createElement('p');
        this.statusElement.className = 'theia-mobile-github-device-status';
        this.statusElement.setAttribute('role', 'status');
        this.errorElement = document.createElement('p');
        this.errorElement.className = 'theia-mobile-github-device-error';
        this.errorElement.hidden = true;
        this.errorElement.setAttribute('role', 'alert');

        const actions = document.createElement('div');
        actions.className = 'theia-mobile-github-device-actions';
        this.openButton = this.createButton(nls.localize('qaap/githubDevice/openGithub', 'Open GitHub'), 'theia-mod-primary', () => this.openGithub());
        this.retryButton = this.createButton(nls.localize('qaap/githubDevice/retry', 'Try again'), 'theia-mod-primary', () => void this.open());
        this.retryButton.hidden = true;
        const cancelButton = this.createButton(nls.localize('qaap/githubDevice/cancel', 'Cancel'), 'theia-mod-secondary', () => this.close());
        actions.append(this.openButton, this.retryButton, cancelButton);

        card.append(title, intro, codeRow, this.statusElement, this.errorElement, actions);
        this.node.append(card);
    }

    /** Starts a device sign-in and shows its code. */
    async open(): Promise<void> {
        const generation = ++this.generation;
        this.stopTimer();
        this.flowId = undefined;
        this.verificationUri = undefined;
        this.node.hidden = false;
        this.showError(undefined);
        this.retryButton.hidden = true;
        this.openButton.hidden = true;
        this.codeElement.textContent = '';
        this.codeRow.hidden = true;
        this.copyButton.hidden = true;
        this.statusElement.textContent = nls.localize('qaap/githubDevice/starting', 'Contacting GitHub…');
        try {
            const start = await this.options.api.start();
            if (generation !== this.generation) {
                return;
            }
            this.flowId = start.flowId;
            this.verificationUri = start.verificationUri;
            this.codeElement.textContent = start.userCode;
            this.codeRow.hidden = false;
            this.copyButton.hidden = false;
            this.openButton.hidden = false;
            this.statusElement.textContent = nls.localize('qaap/githubDevice/waiting', 'Waiting for authorization…');
            this.schedulePoll(generation, start.interval);
        } catch (err) {
            if (generation === this.generation) {
                this.fail(err instanceof Error ? err.message : String(err));
            }
        }
    }

    /** Stops polling and hides the dialog. A flow left behind expires on the backend. */
    close(): void {
        this.generation++;
        this.stopTimer();
        this.flowId = undefined;
        this.node.hidden = true;
    }

    get isOpen(): boolean {
        return !this.node.hidden;
    }

    protected openGithub(): void {
        if (this.verificationUri) {
            this.options.openExternal(this.verificationUri);
        }
    }

    protected schedulePoll(generation: number, intervalSeconds: number): void {
        this.stopTimer();
        this.timer = setTimeout(() => void this.poll(generation), Math.max(1, intervalSeconds) * 1000);
    }

    protected async poll(generation: number): Promise<void> {
        this.timer = undefined;
        if (generation !== this.generation || !this.flowId) {
            return;
        }
        try {
            const result = await this.options.api.poll(this.flowId);
            if (generation !== this.generation) {
                return;
            }
            switch (result.status) {
                case 'pending':
                    this.schedulePoll(generation, result.interval);
                    return;
                case 'complete':
                    this.close();
                    this.options.onSignedIn();
                    return;
                case 'denied':
                    this.fail(nls.localize('qaap/githubDevice/denied', 'GitHub sign-in was cancelled. Try again to connect your account.'));
                    return;
                case 'expired':
                    this.fail(nls.localize('qaap/githubDevice/expired', 'The code expired. Try again to get a new one.'));
                    return;
            }
        } catch (err) {
            if (generation === this.generation) {
                this.fail(err instanceof Error ? err.message : String(err));
            }
        }
    }

    protected fail(message: string): void {
        this.stopTimer();
        this.flowId = undefined;
        this.statusElement.textContent = '';
        this.showError(message);
        this.openButton.hidden = true;
        this.retryButton.hidden = false;
    }

    protected showError(message: string | undefined): void {
        this.errorElement.textContent = message ?? '';
        this.errorElement.hidden = !message;
    }

    protected async copyCode(): Promise<void> {
        const code = this.codeElement.textContent ?? '';
        if (!code) {
            return;
        }
        try {
            await navigator.clipboard.writeText(code);
            this.copyButton.textContent = nls.localize('qaap/githubDevice/copied', 'Copied');
        } catch {
            // Clipboard access can be refused; the code stays on screen to copy by hand.
        }
    }

    protected stopTimer(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    protected createButton(label: string, modifier: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        // The repository dialog's button classes (same tokens, same look), plus a hook for this dialog.
        button.className = `theia-mobile-open-repo-progress-action ${modifier} theia-mobile-github-device-button`;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }
}
