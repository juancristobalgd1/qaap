// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { WebSocketConnectionSource } from '@theia/core/lib/browser/messaging/ws-connection-source';
import { QAAP_AUTH_API_PATH } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { QAAP_REQUIRE_LOGIN_EVENT, qaapAuthenticatedFetchInit } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';

/** The subset of a Socket.IO client socket this class drives (kept structural for tests). */
export interface QaapHandshakeSocket {
    on(event: 'connect_error', listener: () => void): unknown;
    connect(): unknown;
    disconnect(): unknown;
    readonly io: { reconnection(enabled: boolean): unknown };
}

const SESSION_PROBE_INTERVAL_MS = 10_000;

/**
 * In hosted mode the backend refuses the Socket.IO handshake of a browser whose session expired
 * (HTTP 403 on polling, a closed upgrade on WebSocket). Theia would retry forever behind a frozen
 * workbench. After a refused handshake this source asks the auth endpoint whether the session is
 * gone; only an explicit `signedIn: false` (never a network error or a 5xx during a restart) stops
 * the reconnect loop and asks for the login gate. Signing in again resumes the connection (the
 * OAuth return also reloads the page).
 */
@injectable()
export class QaapWebSocketConnectionSource extends WebSocketConnectionSource {

    protected pausedForLogin = false;
    protected sessionProbeInFlight = false;
    protected lastSessionProbeAt = 0;

    protected override createWebSocket(url: string): ReturnType<WebSocketConnectionSource['createWebSocket']> {
        const socket = super.createWebSocket(url);
        this.watchHandshakeRefusals(socket);
        return socket;
    }

    protected watchHandshakeRefusals(socket: QaapHandshakeSocket): void {
        socket.on('connect_error', () => {
            void this.handleHandshakeError(socket);
        });
        if (typeof window !== 'undefined') {
            window.addEventListener('qaap-auth-session-changed', () => this.resumeAfterLogin(socket));
        }
    }

    protected async handleHandshakeError(socket: QaapHandshakeSocket, now: number = Date.now()): Promise<void> {
        if (this.pausedForLogin || this.sessionProbeInFlight || now - this.lastSessionProbeAt < SESSION_PROBE_INTERVAL_MS) {
            return;
        }
        this.lastSessionProbeAt = now;
        this.sessionProbeInFlight = true;
        try {
            if (await this.isSignedOut()) {
                this.pauseForLogin(socket);
            }
        } catch {
            // Unreachable backend (restart, network): keep Theia's normal reconnect loop.
        } finally {
            this.sessionProbeInFlight = false;
        }
    }

    protected pauseForLogin(socket: QaapHandshakeSocket): void {
        this.pausedForLogin = true;
        socket.io.reconnection(false);
        socket.disconnect();
        if (typeof window !== 'undefined') {
            // Handled by QaapLoginContribution; before layout its post-layout sync shows the gate.
            window.dispatchEvent(new Event(QAAP_REQUIRE_LOGIN_EVENT));
        }
    }

    protected resumeAfterLogin(socket: QaapHandshakeSocket): void {
        if (!this.pausedForLogin) {
            return;
        }
        this.pausedForLogin = false;
        this.lastSessionProbeAt = 0;
        socket.io.reconnection(true);
        socket.connect();
    }

    /** True only when the auth endpoint answers and says the browser has no session. */
    protected async isSignedOut(): Promise<boolean> {
        const response = await fetch(`${QAAP_AUTH_API_PATH}/session`, qaapAuthenticatedFetchInit());
        if (response.status !== 200) {
            return false;
        }
        const body = await response.json() as { signedIn?: unknown };
        return body?.signedIn === false;
    }
}
