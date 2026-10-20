// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import { injectable } from '@theia/core/shared/inversify';

interface QaapSecurityLogWindow {
    readonly startedAt: number;
    suppressed: number;
}

const LOG_WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 10_000;

/**
 * Per-client sampling for high-volume security events (refused Socket.IO handshakes). A browser
 * with an expired session, or a scanner, retries every few seconds; logging each attempt floods
 * `docker logs`. The first event of a client per minute is logged; the next logged one carries the
 * number suppressed in between.
 */
@injectable()
export class QaapSecurityLogRateLimiter {

    protected readonly windows = new Map<string, QaapSecurityLogWindow>();

    /**
     * Returns `undefined` when the event must be dropped, otherwise the extra fields to log
     * (`client`, and `suppressed` when earlier events of this client were dropped).
     */
    admit(event: string, request: http.IncomingMessage, now: number = Date.now()): { client: string; suppressed?: number } | undefined {
        const client = this.clientAddress(request);
        const key = `${event}\u0000${client}`;
        const window = this.windows.get(key);
        if (window && now - window.startedAt < LOG_WINDOW_MS) {
            window.suppressed += 1;
            return undefined;
        }
        this.windows.delete(key);
        if (this.windows.size >= MAX_TRACKED_KEYS) {
            // Map iteration order is insertion order: drop the oldest window.
            const oldest = this.windows.keys().next().value;
            if (oldest !== undefined) {
                this.windows.delete(oldest);
            }
        }
        this.windows.set(key, { startedAt: now, suppressed: 0 });
        return window?.suppressed ? { client, suppressed: window.suppressed } : { client };
    }

    /**
     * The backend listens on loopback behind Caddy, so the peer is the proxy: only then is the
     * first `X-Forwarded-For` hop (set by Caddy) the client.
     */
    protected clientAddress(request: http.IncomingMessage): string {
        const peer = request.socket?.remoteAddress ?? 'unknown';
        if (!/^(127\.|::1$|::ffff:127\.)/.test(peer)) {
            return peer;
        }
        const header = request.headers['x-forwarded-for'];
        const forwarded = (Array.isArray(header) ? header[0] : header)?.split(',', 1)[0]?.trim();
        return forwarded || peer;
    }
}
