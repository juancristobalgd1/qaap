// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { KeyStoreService } from '@theia/core/lib/common/key-store';
import { isQaapHostedRuntime } from './qaap-docker-control-plane';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';

const QAAP_KEYSTORE_NAMESPACE = 'qaap:user:';

/**
 * Namespaces the generic Theia credential RPC by tenant.
 *
 * The browser-facing KeyStoreService is a generic credential vault. It is
 * intentionally scoped at the RPC boundary instead of by changing the global
 * KeyStoreService singleton: backend integrations such as MCP and Copilot
 * have their own storage policies and must not be prefixed a second time.
 */
export function createQaapTenantKeyStoreRpcTarget(
    keyStore: KeyStoreService,
    registry: QaapWebsocketAuthRegistry,
): KeyStoreService {
    return new Proxy(keyStore, {
        get(target, property, receiver): unknown {
            if (!isKeyStoreMethod(property)) {
                return Reflect.get(target, property, receiver);
            }
            return (...args: unknown[]): Promise<unknown> => {
                const ownerLogin = registry.getCurrentLogin()?.trim().toLowerCase();
                if (isQaapHostedRuntime(process.env) && !ownerLogin) {
                    throw new Error('Refusing generic keystore access without an authenticated tenant.');
                }
                if (!ownerLogin) {
                    return Reflect.apply(target[property], target, args) as Promise<unknown>;
                }
                const [service, ...remainingArgs] = args;
                if (typeof service !== 'string' || !service) {
                    throw new Error('Refusing generic keystore access with an invalid service name.');
                }
                return Reflect.apply(target[property], target, [
                    qaapTenantServiceName(ownerLogin, service),
                    ...remainingArgs,
                ]) as Promise<unknown>;
            };
        },
    }) as KeyStoreService;
}

export function qaapTenantServiceName(ownerLogin: string, service: string): string {
    return `${QAAP_KEYSTORE_NAMESPACE}${encodeURIComponent(ownerLogin)}:keystore:${encodeURIComponent(service)}`;
}

function isKeyStoreMethod(property: PropertyKey): property is keyof KeyStoreService {
    return property === 'setPassword'
        || property === 'getPassword'
        || property === 'deletePassword'
        || property === 'findPassword'
        || property === 'findCredentials'
        || property === 'keys';
}
