// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

export const MOBILE_STOPPED_TURN_LINE_CLASS = 'theia-mobile-stopped-turn-line';

/**
 * Closing state of a turn the user stopped. Rendered under the partial answer of a turn that has
 * no process accordion (no tool calls), so a Stop is visible the same way for every harness.
 */
export function createMobileStoppedTurnLineElement(): HTMLElement {
    const line = document.createElement('div');
    line.className = `${MOBILE_STOPPED_TURN_LINE_CLASS} theia-mod-cancelled`;
    line.setAttribute('role', 'status');
    const icon = document.createElement('span');
    icon.className = 'codicon codicon-circle-slash theia-mobile-stopped-turn-line-icon';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'theia-mobile-stopped-turn-line-label';
    label.textContent = nls.localize('qaap/mobileProjects/transcriptTurnStopped', 'Turn stopped');
    line.append(icon, label);
    return line;
}
