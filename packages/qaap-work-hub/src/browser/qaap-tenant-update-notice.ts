// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core/lib/common/nls';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { QaapTenantUpdateService, type QaapTenantUpdateState } from './qaap-tenant-update-service';

/** Session-scoped (not localStorage): a dismissal lasts for this tab and clears once no update is pending. */
const DISMISSED_STORAGE_KEY = 'qaap.tenantUpdate.dismissed';
const NOTICE_CLASS = 'qaap-tenant-update-notice';

/**
 * A quiet, non-modal notice that a newer Qaap version waits for the user's backend, with "Update now".
 * Shown on mobile and desktop alike; it never interrupts on its own, so running agent turns are only
 * touched when the user asks for it (and confirms, see {@link QaapTenantUpdateService.updateNow}).
 */
@injectable()
export class QaapTenantUpdateNotice implements FrontendApplicationContribution {

    @inject(QaapTenantUpdateService)
    protected readonly service: QaapTenantUpdateService;

    protected root: HTMLElement | undefined;
    protected message: HTMLElement | undefined;
    protected actionButton: HTMLButtonElement | undefined;
    protected dismissButton: HTMLButtonElement | undefined;
    protected unsubscribe: { dispose(): void } | undefined;

    onStart(): void {
        this.root = this.createRoot();
        document.body.append(this.root);
        this.unsubscribe = this.service.onDidChangeState(state => this.render(state));
        this.render(this.service.getState());
        this.service.start();
    }

    onStop(): void {
        this.service.stop();
        this.unsubscribe?.dispose();
        this.unsubscribe = undefined;
        this.root?.remove();
        this.root = undefined;
    }

    /** Visible while an update is pending and not dismissed, or while an update is in progress or failed. */
    protected render(state: QaapTenantUpdateState): void {
        if (!this.root || !this.message || !this.actionButton) {
            return;
        }
        if (state.status && !state.status.updateAvailable) {
            this.clearDismissal();
        }
        const pending = state.status?.updateAvailable === true && !this.isDismissed();
        const visible = pending || state.phase !== 'idle';
        this.root.hidden = !visible;
        if (!visible) {
            return;
        }
        if (state.phase === 'updating') {
            this.message.textContent = nls.localize('qaap/tenantUpdate/updating', 'Updating Qaap…');
            this.actionButton.textContent = nls.localize('qaap/tenantUpdate/updatingButton', 'Updating…');
            this.actionButton.disabled = true;
        } else if (state.phase === 'failed') {
            this.message.textContent = nls.localize('qaap/tenantUpdate/failed', 'Could not update Qaap. Check your connection and try again.');
            this.actionButton.textContent = nls.localize('qaap/tenantUpdate/retry', 'Try again');
            this.actionButton.disabled = false;
        } else {
            this.message.textContent = nls.localize('qaap/tenantUpdate/ready', 'A new version of Qaap is ready.');
            this.actionButton.textContent = nls.localize('qaap/tenantUpdate/updateNow', 'Update now');
            this.actionButton.disabled = false;
        }
        if (this.dismissButton) {
            this.dismissButton.disabled = state.phase === 'updating';
        }
    }

    protected createRoot(): HTMLElement {
        const root = document.createElement('div');
        root.className = NOTICE_CLASS;
        root.setAttribute('role', 'status');
        root.setAttribute('aria-live', 'polite');
        root.hidden = true;

        this.message = document.createElement('p');
        this.message.className = `${NOTICE_CLASS}-message`;

        this.actionButton = document.createElement('button');
        this.actionButton.type = 'button';
        this.actionButton.className = `${NOTICE_CLASS}-action`;
        this.actionButton.addEventListener('click', this.onActionClick);

        this.dismissButton = document.createElement('button');
        this.dismissButton.type = 'button';
        this.dismissButton.className = `${NOTICE_CLASS}-dismiss`;
        this.dismissButton.setAttribute('aria-label', nls.localize('qaap/tenantUpdate/dismiss', 'Dismiss update notice'));
        this.dismissButton.textContent = '×';
        this.dismissButton.addEventListener('click', this.onDismissClick);

        root.append(this.message, this.actionButton, this.dismissButton);
        return root;
    }

    protected readonly onActionClick = (): void => {
        void this.service.updateNow();
    };

    protected readonly onDismissClick = (): void => {
        this.rememberDismissal();
        this.render(this.service.getState());
    };

    protected isDismissed(): boolean {
        try {
            return globalThis.sessionStorage?.getItem(DISMISSED_STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    }

    protected rememberDismissal(): void {
        try {
            globalThis.sessionStorage?.setItem(DISMISSED_STORAGE_KEY, '1');
        } catch {
            // Storage blocked: the notice simply reappears on the next render.
        }
    }

    protected clearDismissal(): void {
        try {
            globalThis.sessionStorage?.removeItem(DISMISSED_STORAGE_KEY);
        } catch {
            // Nothing to clear when storage is blocked.
        }
    }
}
