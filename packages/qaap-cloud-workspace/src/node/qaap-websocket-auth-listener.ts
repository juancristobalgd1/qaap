// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import { inject, injectable } from '@theia/core/shared/inversify';
import type { Request } from '@theia/core/shared/express';
import { MessagingListenerContribution } from '@theia/core/lib/node/messaging/messaging-listeners';
import { Socket } from 'socket.io';
import { QaapGithubAuthGuard } from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';

/** Binds the authenticated GitHub login to each frontend websocket connection. */
@injectable()
export class QaapWebsocketAuthListener implements MessagingListenerContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapWebsocketAuthRegistry)
    protected readonly registry: QaapWebsocketAuthRegistry;

    onDidWebSocketUpgrade(request: http.IncomingMessage, socket: Socket): void {
        if (this.auth.isSkipAuthEnabled()) {
            return;
        }
        const ctx = this.auth.authenticate(this.asExpressRequest(request));
        if (ctx.kind !== 'authenticated') {
            return;
        }
        this.registry.bindSocketLogin(socket.id, ctx.userLogin);
        socket.on('disconnect', () => this.registry.unbindSocket(socket.id));
    }

    /** Minimal Request adapter so {@link QaapGithubAuthGuard.authenticate} can read cookies. */
    protected asExpressRequest(request: http.IncomingMessage): Request {
        return request as Request;
    }
}
