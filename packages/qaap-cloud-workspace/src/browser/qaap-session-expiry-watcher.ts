// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, interfaces, postConstruct } from '@theia/core/shared/inversify';
import { WebSocketConnectionSource } from '@theia/core/lib/browser/messaging/ws-connection-source';
import { QAAP_AUTH_API_PATH } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { QAAP_REQUIRE_LOGIN_EVENT, qaapAuthenticatedFetchInit } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';

/** The subset of a Socket.IO client socket this watcher drives (kept structural for tests). */
export interface QaapHandshakeSocket {
    on(event: 'connect_error', listener: () => void): unknown;
    connect(): unknown;
    disconnect(): unknown;
    readonly io: { reconnection(enabled: boolean): unknown };
}

/** The subset of Theia's `WebSocketConnectionSource` (browser or Electron) the watcher needs. */
export interface QaapWatchableConnectionSource {
    readonly socket: QaapHandshakeSocket | undefined;
}

const SESSION_PROBE_INTERVAL_MS = 10_000;
const QAAP_AUTH_SESSION_CHANGED_EVENT = 'qaap-auth-session-changed';

/**
 * In hosted mode the backend refuses the Socket.IO handshake of a browser whose session expired
 * (HTTP 403 on polling, a closed upgrade on WebSocket). Theia would retry forever behind a frozen
 * workbench. After a refused handshake this watcher asks the auth endpoint whether the session is
 * gone; only an explicit `signedIn: false` (never a network error or a 5xx during a restart) stops
 * the reconnect loop and asks for the login gate. Signing in again resumes the connection (the
 * OAuth return also reloads the page).
 *
 * It decorates whatever `WebSocketConnectionSource` instance is bound (browser or Electron) from an
 * activation hook instead of subclassing it: a rebind would create a second singleton whose
 * `@postConstruct` opens a second socket with the same frontend id, and the backend would close
 * the first one as "reconnecting same front end".
 */
@injectable()
export class QaapSessionExpiryWatcher {

    protected readonly watchedSources = new WeakSet<object>();
    protected readonly pausedSockets = new Set<QaapHandshakeSocket>();
    protected sessionProbeInFlight = false;
    protected lastSessionProbeAt = 0;

    @postConstruct()
    protected init(): void {
        if (typeof window !== 'undefined') {
            window.addEventListener(QAAP_AUTH_SESSION_CHANGED_EVENT, () => this.resumeAfterLogin());
        }
    }

    /** Idempotent: `toService` bindings re-run activation hooks on every resolution. */
    watch<T extends QaapWatchableConnectionSource>(source: T): T {
        const socket = source.socket;
        if (!socket || this.watchedSources.has(source)) {
            return source;
        }
        this.watchedSources.add(source);
        socket.on('connect_error', () => {
            void this.handleHandshakeError(socket);
        });
        return source;
    }

    protected async handleHandshakeError(socket: QaapHandshakeSocket, now: number = Date.now()): Promise<void> {
        if (this.pausedSockets.has(socket) || this.sessionProbeInFlight || now - this.lastSessionProbeAt < SESSION_PROBE_INTERVAL_MS) {
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
        this.pausedSockets.add(socket);
        socket.io.reconnection(false);
        socket.disconnect();
        if (typeof window !== 'undefined') {
            // Handled by QaapLoginContribution; before layout its post-layout sync shows the gate.
            window.dispatchEvent(new Event(QAAP_REQUIRE_LOGIN_EVENT));
        }
    }

    /** The session-changed event also fires on sign-out; only a fresh sign-in resumes. */
    protected resumeAfterLogin(): void {
        if (this.pausedSockets.size === 0 || !this.isSignedIn()) {
            return;
        }
        const sockets = [...this.pausedSockets];
        this.pausedSockets.clear();
        this.lastSessionProbeAt = 0;
        for (const socket of sockets) {
            socket.io.reconnection(true);
            socket.connect();
        }
    }

    protected isSignedIn(): boolean {
        return readQaapSignedIn();
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

/**
 * Binds the watcher and attaches it to the `WebSocketConnectionSource` instance core already binds
 * (`toSelf` in the browser, `toService(ElectronWebSocketConnectionSource)` in Electron) without
 * rebinding it, so exactly one source and one socket exist per frontend.
 */
export function bindQaapSessionExpiryWatcher(bind: interfaces.Bind, onActivation: interfaces.Container['onActivation']): void {
    bind(QaapSessionExpiryWatcher).toSelf().inSingletonScope();
    onActivation(WebSocketConnectionSource, (context, source) =>
        context.container.get(QaapSessionExpiryWatcher).watch(source as unknown as QaapWatchableConnectionSource) as unknown as WebSocketConnectionSource);
}
