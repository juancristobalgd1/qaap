// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import * as https from 'https';
import { injectable } from '@theia/core/shared/inversify';
import { WebsocketEndpoint } from '@theia/core/lib/node/messaging/websocket-endpoint';
import { Server, ServerOptions } from 'socket.io';

/**
 * Upstream endpoint plus permessage-deflate.
 *
 * Every frontend RPC shares one socket. Plugin sync sends each plugin's metadata with its TextMate
 * grammars inline (several MB for the built-ins), and the Work Hub's workspace / chat RPCs queue
 * behind it: on a 1.6 Mbps phone link the real composer waited ~30 s with no HTTP traffic. That JSON
 * compresses about 10×. Browsers always offer the extension; frames below the threshold stay raw.
 */
@injectable()
export class QaapWebsocketEndpoint extends WebsocketEndpoint {

    static readonly PER_MESSAGE_DEFLATE_THRESHOLD = 1024;

    override onStart(server: http.Server | https.Server): void {
        const socketServer = new Server(server, this.createServerOptions());
        // Accept every namespace by using /.*/
        socketServer.of(/.*/).on('connection', async socket => {
            if (await this.allowConnect(socket.request)) {
                await this.handleConnection(socket);
                this.messagingListener.onDidWebSocketUpgrade(socket.request, socket);
            } else {
                socket.disconnect(true);
            }
        });
    }

    protected createServerOptions(): Partial<ServerOptions> {
        return {
            pingInterval: this.checkAliveTimeout,
            pingTimeout: this.checkAliveTimeout * 2,
            maxHttpBufferSize: this.maxHttpBufferSize,
            perMessageDeflate: { threshold: QaapWebsocketEndpoint.PER_MESSAGE_DEFLATE_THRESHOLD },
            allowRequest: (req, callback) => {
                this.wsRequestValidator.allowWsUpgrade(req).then(
                    allowed => callback(undefined, allowed),
                    error => {
                        console.error('Error during WebSocket allowRequest validation:', error);
                        callback(error?.message ?? 'Validation error', false);
                    }
                );
            }
        };
    }
}
