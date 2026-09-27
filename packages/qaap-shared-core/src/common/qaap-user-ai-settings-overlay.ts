// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { usesSharedAiSettingsFallback } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

/**
 * Authenticated tenants must not write AI/BYOK prefs into Theia's process-wide User
 * `settings.json`. That file is one backend and would leak User A's keys into User B's
 * Settings UI. Spawn already reads `~/.qaap/users/{login}/settings.json`.
 */
export function shouldInterceptSharedUserAiPrefWrites(userLogin: string | undefined): boolean {
    return !usesSharedAiSettingsFallback(userLogin);
}
