// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { matchesMobileOneColumnLayout } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { peekPreferDesktopIde } from '../common/qaap-mobile-work-surface-preference';
import { shouldBootstrapMobileAgentsChat, shouldPreferWorkHubAgentsLayout } from './mobile-projects-open';

/**
 * Work Hub boots without a bottom-panel terminal; defer creation until the user opens the classic IDE.
 * A fresh tab (no IDE preference in sessionStorage) defers on desktop too, so the terminal is created
 * only after {@link markPreferDesktopIde}.
 */
export function shouldDeferTerminalLayoutInit(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }
    return !peekPreferDesktopIde()
        || matchesMobileOneColumnLayout()
        || shouldBootstrapMobileAgentsChat()
        || shouldPreferWorkHubAgentsLayout();
}

/** Skip IDE sidebar widgets on Work Hub boot; openView registers them when the user opens the IDE. */
export function shouldDeferWorkHubIdeLayoutInit(): boolean {
    if (typeof window === 'undefined' || peekPreferDesktopIde()) {
        return false;
    }
    return shouldDeferTerminalLayoutInit();
}
