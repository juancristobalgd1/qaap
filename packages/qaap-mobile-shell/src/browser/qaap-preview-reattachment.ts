// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapDevPreviewProbeResponse } from '../common/qaap-dev-preview';

export interface QaapReattachedPreviewIdentity {
    readonly processId: string;
    readonly claim: {
        readonly previewId: string;
        readonly previewUrl: string;
        readonly port: number;
    };
}

/** Restores an already-running process identity without inventing a new reservation after reload. */
export function resolveQaapReattachedPreviewIdentity(
    port: number,
    probe: QaapDevPreviewProbeResponse,
): QaapReattachedPreviewIdentity | undefined {
    if (!probe.previewId || !probe.processId) {
        return undefined;
    }
    return {
        processId: probe.processId,
        claim: {
            previewId: probe.previewId,
            previewUrl: probe.previewUrl,
            port,
        },
    };
}
