// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { environment } from '@theia/core/lib/common';

/**
 * Browser Qaap is cloud-first: onboarding goes through GitHub repositories, not local Open Folder.
 * Electron keeps desktop open-folder / workspace paths for local development.
 */
export function isQaapCloudOnboarding(): boolean {
    return !environment.electron.is();
}
