// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { matchesMobileOneColumnLayout } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { shouldBootstrapMobileAgentsChat, shouldPreferWorkHubAgentsLayout } from './mobile-projects-open';

/** Work Hub boots without a bottom-panel terminal; defer creation until the user opens one. */
export function shouldDeferTerminalLayoutInit(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }
    return matchesMobileOneColumnLayout()
        || shouldBootstrapMobileAgentsChat()
        || shouldPreferWorkHubAgentsLayout();
}
