// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core/lib/common/nls';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WindowBlinkService } from '@theia/ai-core/lib/browser/window-blink-service';
import { QaapBootstrapStateChange, QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { isQaapUserCancelledPreviewError } from './qaap-project-bootstrap-types';
import { QAAP_NAVIGATE_TO_CONVERSATION_EVENT } from './qaap-turn-settle-notifier';

export const QAAP_BOOTSTRAP_FAILED_EVENT = 'qaap-bootstrap-failed';
export const QAAP_AGENT_COMPLETED_EVENT = 'qaap-agent-completed';
export const QAAP_AGENT_CONFIRMATION_NEEDED_EVENT = 'qaap-agent-confirmation-needed';

@injectable()
export class QaapPushNotificationContribution implements FrontendApplicationContribution {

    @inject(WindowBlinkService)
    protected readonly blink: WindowBlinkService;

    @inject(QaapProjectBootstrapService)
    protected readonly bootstrap: QaapProjectBootstrapService;

    onStart(): void {
        this.bootstrap.onStateChange((state: QaapBootstrapStateChange) => {
            if (state.phase === 'install-failed' || state.phase === 'run-failed') {
                if (isQaapUserCancelledPreviewError(state.error)) {
                    return;
                }
                this.notifyBuildFailed(state.error);
                window.dispatchEvent(new CustomEvent(QAAP_BOOTSTRAP_FAILED_EVENT, { detail: { error: state.error } }));
            }
            if (state.phase === 'running') {
                void this.requestNotificationPermission();
            }
        });
        window.addEventListener(QAAP_AGENT_COMPLETED_EVENT, this.onAgentCompleted);
        window.addEventListener(QAAP_AGENT_CONFIRMATION_NEEDED_EVENT, this.onConfirmationNeeded);
    }

    onStop(): void {
        window.removeEventListener(QAAP_AGENT_COMPLETED_EVENT, this.onAgentCompleted);
        window.removeEventListener(QAAP_AGENT_CONFIRMATION_NEEDED_EVENT, this.onConfirmationNeeded);
    }

    protected readonly onAgentCompleted = (event: Event): void => {
        const detail = (event as CustomEvent<{ agentName?: string }>).detail;
        this.notifyAgentCompleted(detail?.agentName);
    };

    protected readonly onConfirmationNeeded = (event: Event): void => {
        const detail = (event as CustomEvent<{ agentName?: string; conversationId?: string }>).detail;
        this.notifyAgentNeedsConfirmation(detail?.agentName, detail?.conversationId);
    };

    protected notifyAgentCompleted(agentName?: string): void {
        // Keep the window blink (title flash) so a backgrounded user still sees a completion signal,
        // but skip the raw OS notification: `QaapTurnSettleNotifyContribution` already fires the
        // completion Web Notification and routes its activation to the originating Work Hub
        // conversation. Showing a second notification here would duplicate it and its click would
        // only focus the window without navigating to the session.
        void this.blink.blinkWindow(agentName);
    }

    protected notifyAgentNeedsConfirmation(agentName?: string, conversationId?: string): void {
        void this.blink.blinkWindow(agentName);
        this.showSystemNotification(
            nls.localize('qaap/push/agentNeedsConfirmation', 'Agent needs your confirmation'),
            agentName
                ? nls.localize('qaap/push/agentNeedsConfirmationBody', '{0} is waiting for you to approve a tool call.', agentName)
                : nls.localize('qaap/push/agentNeedsConfirmationBodyGeneric', 'Your agent is waiting for you to approve a tool call.'),
            conversationId,
        );
    }

    protected notifyBuildFailed(error?: string): void {
        if (typeof document !== 'undefined') {
            const app = FrontendApplicationConfigProvider.get().applicationName;
            document.title = '⚠ ' + nls.localize('qaap/blink/buildFailed', '{0} — build failed', app);
        }
        this.showSystemNotification(
            nls.localize('qaap/push/buildFailed', 'Build failed'),
            error ?? nls.localize('qaap/push/buildFailedBody', 'Check the terminal output and retry.'),
        );
    }

    protected showSystemNotification(title: string, body: string, conversationId?: string): void {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            return;
        }
        try {
            const notification = new Notification(title, { body, tag: 'qaap-product' });
            if (conversationId) {
                notification.onclick = () => {
                    window.focus();
                    window.dispatchEvent(new CustomEvent(QAAP_NAVIGATE_TO_CONVERSATION_EVENT, {
                        detail: { conversationId },
                    }));
                    notification.close();
                };
            }
        } catch {
            /* iOS / restricted contexts */
        }
    }

    protected async requestNotificationPermission(): Promise<void> {
        if (typeof Notification === 'undefined' || Notification.permission !== 'default') {
            return;
        }
        try {
            await Notification.requestPermission();
        } catch {
            /* user dismissed */
        }
    }
}
