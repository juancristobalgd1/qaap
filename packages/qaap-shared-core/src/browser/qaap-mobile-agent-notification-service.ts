// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { matchesMobileNarrowViewport } from '@theia/core/lib/browser/shell/mobile-layout-state';
import {
    AgentNotificationService,
    AgentNotificationOptions,
} from '@theia/ai-core/lib/browser/agent-notification-service';
import { AgentNotificationKind } from '@theia/ai-core/lib/common/notification-types';

/**
 * Mobile override of the upstream {@link AgentNotificationService}.
 *
 * On narrow mobile viewports the upstream service is suppressed: its `onActivate` callback (wired by
 * `ChatInputWidget.handleAgentCompletion` / `ChatInputNeededNotificationContribution`) calls
 * `ChatService.setActiveSession(sessionId, { focus: true })`, which reveals the classic-IDE chat
 * panel — the "task view" the user does not want on mobile. The Qaap notification pipeline
 * (`QaapTurnSettleNotifyContribution` for completion, `QaapPushNotificationContribution` for
 * confirmation-needed) owns OS notifications on mobile instead, and routes activation to the Work
 * Hub conversation rather than the IDE chat surface.
 *
 * On desktop (wide viewport) the upstream behavior is preserved unchanged.
 */
@injectable()
export class QaapMobileAgentNotificationService extends AgentNotificationService {

    override async showNotification(
        agentId: string,
        kind: AgentNotificationKind,
        options?: AgentNotificationOptions,
    ): Promise<void> {
        if (matchesMobileNarrowViewport()) {
            return;
        }
        return super.showNotification(agentId, kind, options);
    }
}
