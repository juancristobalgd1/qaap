// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0

import { nls } from '@theia/core/lib/common/nls';

export class QaapAgentStorageUnavailableError extends Error {
    constructor() {
        super(nls.localize('qaap/agentStorage/unavailable', 'Task storage is not ready. If this persists, check server storage and restart Qaap before creating more tasks.'));
    }
}
