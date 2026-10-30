// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import type { DevServerPreviewStatus } from '../common/qaap-agent-dev-server-guard';

/** Upper bound for the readiness probe: the guard answers the agent within this window. */
export const QAAP_DEV_PREVIEW_STATUS_PROBE_TIMEOUT_MS = 1500;

/**
 * Measures whether the reserved preview port answers HTTP, from the tenant backend
 * (which shares the network namespace with the dev servers). Any HTTP response counts as
 * answering, whatever its status; refusal, reset or timeout count as not answering.
 * Redirects are never followed.
 */
export function probeReservedDevPreviewStatus(port: number, timeoutMs: number = QAAP_DEV_PREVIEW_STATUS_PROBE_TIMEOUT_MS): Promise<DevServerPreviewStatus> {
    return new Promise<DevServerPreviewStatus>(resolve => {
        let request: http.ClientRequest | undefined;
        let settled = false;
        const settle = (status: DevServerPreviewStatus): void => {
            if (!settled) {
                settled = true;
                clearTimeout(deadline);
                request?.destroy();
                resolve(status);
            }
        };
        const deadline = setTimeout(() => settle({ answering: false }), timeoutMs);
        try {
            request = http.request({ host: '127.0.0.1', port, path: '/', method: 'HEAD', timeout: timeoutMs }, response => {
                settle({ answering: true, httpStatus: response.statusCode });
            });
        } catch {
            // Invalid port: nothing can be answering there.
            settle({ answering: false });
            return;
        }
        request.on('error', () => settle({ answering: false }));
        request.on('timeout', () => settle({ answering: false }));
        request.end();
    });
}
