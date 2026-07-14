// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Channel } from '@theia/core/lib/common/message-rpc/channel';
import { RpcConnectionHandler } from '@theia/core/lib/common/messaging/proxy-factory';
import { DefaultMessagingService, ConnectionHandlers } from '@theia/core/lib/node/messaging/default-messaging-service';
import { ReconnectableSocketChannel } from '@theia/core/lib/node/messaging/websocket-frontend-connection-service';
import type { Socket } from 'socket.io';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';

let rpcHandlerPatched = false;
let messagingPatched = false;

/** Wrap every backend RPC target so filesystem/workspace calls run under the caller login. */
export function installQaapRpcAuthPatches(registry: QaapWebsocketAuthRegistry): void {
    if (rpcHandlerPatched) {
        return;
    }
    rpcHandlerPatched = true;
    const prototype = RpcConnectionHandler.prototype as {
        onConnection: (connection: Channel) => void;
        targetFactory: (proxy: object) => unknown;
        factoryConstructor: new () => {
            createProxy(): object;
            listen(connection: Channel): void;
            target: unknown;
        };
    };
    const originalOnConnection = prototype.onConnection;
    prototype.onConnection = function patchedOnConnection(this: RpcConnectionHandler<object>, connection: Channel): void {
        const factory = new this.factoryConstructor();
        const proxy = factory.createProxy();
        const rawTarget = this.targetFactory(proxy);
        factory.target = wrapTargetWithRpcAuth(rawTarget as object, connection, registry);
        factory.listen(connection);
    };
    void originalOnConnection;
}

export function installQaapMessagingAuthPatches(
    messaging: DefaultMessagingService,
    registry: QaapWebsocketAuthRegistry,
): void {
    if (messagingPatched) {
        return;
    }
    messagingPatched = true;
    const service = messaging as DefaultMessagingService & {
        handleConnection(channel: Channel): void;
        getConnectionChannelHandlers(mainChannel: Channel): ConnectionHandlers<Channel>;
    };

    const originalHandleConnection = service.handleConnection.bind(service);
    service.handleConnection = (mainChannel: Channel): void => {
        registry.bindMainChannel(mainChannel, resolveSocketId(mainChannel));
        originalHandleConnection(mainChannel);
    };

    const originalGetHandlers = service.getConnectionChannelHandlers.bind(service);
    service.getConnectionChannelHandlers = (mainChannel: Channel): ConnectionHandlers<Channel> => {
        const handlers = originalGetHandlers(mainChannel);
        const originalRoute = handlers.route.bind(handlers);
        handlers.route = (path: string, rpcChannel: Channel): string | false => {
            registry.associateRpcChannel(rpcChannel, mainChannel);
            return registry.runWithRpcChannel(rpcChannel, () => originalRoute(path, rpcChannel));
        };
        return handlers;
    };
}

function wrapTargetWithRpcAuth<T extends object>(
    target: T,
    rpcChannel: Channel,
    registry: QaapWebsocketAuthRegistry,
): T {
    return new Proxy(target, {
        get(obj, prop, receiver): unknown {
            const value = Reflect.get(obj, prop, receiver);
            if (typeof value !== 'function') {
                return value;
            }
            return (...args: unknown[]): unknown => registry.runWithRpcChannel(rpcChannel, () => Reflect.apply(value, obj, args));
        },
    });
}

function resolveSocketId(mainChannel: Channel): string | undefined {
    const reconnectable = mainChannel as ReconnectableSocketChannel & { socket?: Socket };
    return reconnectable.socket?.id;
}

/** Test-only reset so specs can reinstall patches. */
export function resetQaapAuthPatchStateForTests(): void {
    rpcHandlerPatched = false;
    messagingPatched = false;
}
