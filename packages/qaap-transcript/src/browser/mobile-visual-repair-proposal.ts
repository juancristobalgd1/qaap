// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { startConversationVisualRepair, type QaapAgentConversationDTO, type QaapAgentMessageDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

export const MOBILE_VISUAL_REPAIR_PROPOSAL_CLASS = 'theia-mobile-visual-repair-proposal';

/** Evidence messages whose proposal the user dismissed in this page session. */
const dismissedProposalMessageIds = new Set<string>();

/**
 * "The app is not render-ready" notice with "Fix with agent" / "Dismiss". Accepting starts the
 * repair turn on the backend; nothing is sent to the agent before that click.
 */
export function createMobileVisualRepairProposalElement(
    conv: Pick<QaapAgentConversationDTO, 'id'>,
    message: Pick<QaapAgentMessageDTO, 'id'>,
): HTMLElement | undefined {
    if (dismissedProposalMessageIds.has(message.id)) {
        return undefined;
    }
    const wrap = document.createElement('div');
    wrap.className = MOBILE_VISUAL_REPAIR_PROPOSAL_CLASS;
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', nls.localize('qaap/mobileProjects/visualRepairProposal', 'The app is not render-ready. Fix it with the agent?'));

    const text = document.createElement('span');
    text.className = `${MOBILE_VISUAL_REPAIR_PROPOSAL_CLASS}-text`;
    text.textContent = nls.localize('qaap/mobileProjects/visualRepairProposal', 'The app is not render-ready. Fix it with the agent?');

    const actions = document.createElement('div');
    actions.className = `${MOBILE_VISUAL_REPAIR_PROPOSAL_CLASS}-actions`;

    const fix = document.createElement('button');
    fix.type = 'button';
    fix.className = 'theia-mobile-closing-error-card-retry';
    fix.textContent = nls.localize('qaap/mobileProjects/visualRepairFix', 'Fix with agent');

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'theia-mobile-closing-error-card-retry';
    dismiss.textContent = nls.localize('qaap/mobileProjects/visualRepairDismiss', 'Dismiss');

    fix.addEventListener('click', () => {
        fix.disabled = true;
        dismiss.disabled = true;
        startConversationVisualRepair(conv.id, message.id).then(() => {
            wrap.remove();
        }, () => {
            fix.disabled = false;
            dismiss.disabled = false;
            text.textContent = nls.localize('qaap/mobileProjects/visualRepairFailed', 'Could not start the fix. Try again.');
        });
    });
    dismiss.addEventListener('click', () => {
        dismissedProposalMessageIds.add(message.id);
        wrap.remove();
    });

    actions.append(fix, dismiss);
    wrap.append(text, actions);
    return wrap;
}
