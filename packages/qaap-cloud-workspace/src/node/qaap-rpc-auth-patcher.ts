// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Channel, MessageProvider } from '@theia/core/lib/common/message-rpc/channel';
import { RpcConnectionHandler } from '@theia/core/lib/common/messaging/proxy-factory';
import { DefaultMessagingService, ConnectionHandlers } from '@theia/core/lib/node/messaging/default-messaging-service';
import { ReconnectableSocketChannel } from '@theia/core/lib/node/messaging/websocket-frontend-connection-service';
import type { Socket } from 'socket.io';
import { keyStoreServicePath } from '@theia/core/lib/common/key-store';
import { githubRepoServicePath } from '@theia/ai-ide/lib/common/github-repo-protocol';
import * as path from 'path';
import {
    isPathUnderUserWorkspace,
    resolveQaapReposRoot,
    resolveUserReposRoot,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { isQaapHostedRuntime } from './qaap-docker-control-plane';
import { isRealPathUnder } from '@theia/qaap-mobile-shell/lib/node/qaap-realpath-guard';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';
import { createQaapTenantKeyStoreRpcTarget } from './qaap-key-store-tenant-scope';

let rpcHandlerPatched = false;
let messagingPatched = false;
let reconnectableChannelConnectPatched = false;
let originalReconnectableChannelConnect: ((this: ReconnectableSocketChannel, socket: Socket) => void) | undefined;

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
        const scopedTarget = this.path === keyStoreServicePath
            ? createQaapTenantKeyStoreRpcTarget(rawTarget as never, registry)
            : this.path === githubRepoServicePath
                ? createQaapTenantGitHubRepoRpcTarget(rawTarget as object, registry)
                : rawTarget;
        factory.target = wrapTargetWithRpcAuth(scopedTarget as object, connection, registry);
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
    patchReconnectableChannelConnect(registry);
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
            const login = registry.getLoginForRpcChannel(rpcChannel);
            return registry.runWithLogin(login, () => {
                bindInboundChannelAuth(rpcChannel, registry, login);
                return originalRoute(path, rpcChannel);
            });
        };
        return handlers;
    };
}

/**
 * Theia keeps the main channel alive across frontend websocket reconnects. The channel's
 * underlying Socket.IO socket changes, so refresh the channel-to-socket association whenever
 * Theia reconnects it. Without this, a later RPC is executed without the authenticated owner
 * after the old socket id has been removed from the registry.
 */
function patchReconnectableChannelConnect(registry: QaapWebsocketAuthRegistry): void {
    if (reconnectableChannelConnectPatched) {
        return;
    }
    reconnectableChannelConnectPatched = true;
    const prototype = ReconnectableSocketChannel.prototype as ReconnectableSocketChannel & {
        connect(socket: Socket): void;
    };
    originalReconnectableChannelConnect = prototype.connect;
    prototype.connect = function patchedConnect(this: ReconnectableSocketChannel, socket: Socket): void {
        originalReconnectableChannelConnect?.call(this, socket);
        registry.bindMainChannel(this, socket.id);
    };
}

/** Keep the legacy GitHub-repository metadata RPC from reading another tenant's checkout. */
function createQaapTenantGitHubRepoRpcTarget<T extends object>(target: T, registry: QaapWebsocketAuthRegistry): T {
    return new Proxy(target, {
        get(obj, prop, receiver): unknown {
            const value = Reflect.get(obj, prop, receiver);
            if (prop !== 'getGitHubRepoInfo' || typeof value !== 'function' || !isQaapHostedRuntime()) {
                return value;
            }
            return (workspacePath: unknown): unknown => {
                const ownerLogin = registry.getCurrentLogin();
                if (!ownerLogin || typeof workspacePath !== 'string' || !workspacePath.trim()) {
                    throw new Error('Hosted GitHub repository metadata requires an authenticated tenant.');
                }
                const candidate = path.resolve(workspacePath);
                const reposRoot = resolveQaapReposRoot();
                const tenantRoot = resolveUserReposRoot(reposRoot, ownerLogin);
                if (!isPathUnderUserWorkspace(candidate, reposRoot, ownerLogin) || !isRealPathUnder(candidate, tenantRoot)) {
                    throw new Error('GitHub repository metadata path is outside the authenticated tenant.');
                }
                return Reflect.apply(value, obj, [candidate]);
            };
        },
    });
}

/**
 * Raw channels (notably `/services/terminals/:id`) install event listeners and
 * receive data after routing has returned. Capture the authenticated owner at
 * listener-registration time so later messages cannot lose the AsyncLocalStorage
 * context and bypass ProcessManager's owner check.
 */
function bindInboundChannelAuth(
    channel: Channel,
    registry: QaapWebsocketAuthRegistry,
    login: string | undefined,
): void {
    const channelWithMarker = channel as Channel & { __qaapInboundAuthBound?: boolean };
    if (channelWithMarker.__qaapInboundAuthBound) {
        return;
    }
    channelWithMarker.__qaapInboundAuthBound = true;
    const originalOnMessage = channel.onMessage;
    Object.defineProperty(channel, 'onMessage', {
        configurable: true,
        value: (listener: (provider: MessageProvider) => void) => originalOnMessage(
            provider => registry.runWithLogin(login, () => listener(provider)),
        ),
    });
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
    if (reconnectableChannelConnectPatched && originalReconnectableChannelConnect) {
        const prototype = ReconnectableSocketChannel.prototype as ReconnectableSocketChannel & {
            connect(socket: Socket): void;
        };
        prototype.connect = originalReconnectableChannelConnect;
    }
    rpcHandlerPatched = false;
    messagingPatched = false;
    reconnectableChannelConnectPatched = false;
    originalReconnectableChannelConnect = undefined;
}
