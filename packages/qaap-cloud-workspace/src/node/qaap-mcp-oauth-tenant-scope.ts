// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { KeyStoreService } from '@theia/core/lib/common/key-store';
import { MCP_OAUTH_KEYSTORE_SERVICE } from '@theia/ai-mcp/lib/node/mcp-oauth-keystore';
import { MCPOAuthClientProviderFactory } from '@theia/ai-mcp/lib/node/mcp-oauth-client-provider-factory';
import { MCPOAuthCredentialStore } from '@theia/ai-mcp/lib/node/mcp-oauth-credential-store';
import { isQaapHostedRuntime } from './qaap-docker-control-plane';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';

const QAAP_MCP_ACCOUNT_PREFIX = 'qaap:user:';
let installed = false;

/**
 * Prefix the MCP OAuth account namespace for one authenticated tenant.
 * Non-MCP keystore services are deliberately passed through untouched.
 */
export function createQaapScopedMcpKeyStore(
    keyStore: KeyStoreService,
    ownerLogin: string | undefined,
): KeyStoreService {
    const owner = ownerLogin?.trim().toLowerCase();
    if (!owner) {
        if (isQaapHostedRuntime(globalThis.process.env)) {
            throw new Error('Refusing MCP OAuth keystore access without an authenticated tenant.');
        }
        return keyStore;
    }
    const prefix = `${QAAP_MCP_ACCOUNT_PREFIX}${encodeURIComponent(owner)}:`;
    const scopedAccount = (account: string): string => `${prefix}${account}`;
    const isScopedAccount = (account: string): boolean => account.startsWith(prefix);
    const unscopedAccount = (account: string): string => account.slice(prefix.length);

    return new Proxy(keyStore, {
        get(target, property, receiver): unknown {
            if (property === 'setPassword') {
                return (service: string, account: string, password: string): Promise<void> =>
                    target.setPassword(service, service === MCP_OAUTH_KEYSTORE_SERVICE ? scopedAccount(account) : account, password);
            }
            if (property === 'getPassword') {
                return (service: string, account: string): Promise<string | undefined> =>
                    target.getPassword(service, service === MCP_OAUTH_KEYSTORE_SERVICE ? scopedAccount(account) : account);
            }
            if (property === 'deletePassword') {
                return (service: string, account: string): Promise<boolean> =>
                    target.deletePassword(service, service === MCP_OAUTH_KEYSTORE_SERVICE ? scopedAccount(account) : account);
            }
            if (property === 'keys') {
                return async (service: string): Promise<string[]> => {
                    const accounts = await target.keys(service);
                    return service === MCP_OAUTH_KEYSTORE_SERVICE
                        ? accounts.filter(isScopedAccount).map(unscopedAccount)
                        : accounts;
                };
            }
            if (property === 'findCredentials') {
                return async (service: string): Promise<Array<{ account: string; password: string }>> => {
                    const credentials = await target.findCredentials(service);
                    return service === MCP_OAUTH_KEYSTORE_SERVICE
                        ? credentials.filter(entry => isScopedAccount(entry.account)).map(entry => ({
                            account: unscopedAccount(entry.account),
                            password: entry.password,
                        }))
                        : credentials;
                };
            }
            if (property === 'findPassword') {
                return async (service: string): Promise<string | undefined> => {
                    if (service !== MCP_OAUTH_KEYSTORE_SERVICE) {
                        return target.findPassword(service);
                    }
                    const credentials = await target.findCredentials(service);
                    return credentials.find(entry => isScopedAccount(entry.account))?.password;
                };
            }
            return Reflect.get(target, property, receiver);
        },
    });
}

/**
 * Existing Theia MCP classes are connection-scoped, but their OAuth key store
 * is constructed upstream. Wrap only the two seams that receive/use it rather
 * than forking the whole MCP package.
 */
export function installQaapMcpOAuthStoragePatches(registry: QaapWebsocketAuthRegistry): void {
    if (installed) {
        return;
    }
    installed = true;

    const factoryPrototype = MCPOAuthClientProviderFactory.prototype as MCPOAuthClientProviderFactory & {
        create: MCPOAuthClientProviderFactory['create'];
    };
    const originalCreate = factoryPrototype.create;
    factoryPrototype.create = function patchedCreate(this: MCPOAuthClientProviderFactory, ...args: Parameters<typeof originalCreate>) {
        const ownerKeyStore = createQaapScopedMcpKeyStore(
            (this as unknown as { keyStore: KeyStoreService }).keyStore,
            registry.getCurrentLogin(),
        );
        const scopedFactory = new Proxy(this, {
            get(target, property, receiver): unknown {
                return property === 'keyStore' ? ownerKeyStore : Reflect.get(target, property, receiver);
            },
        });
        return originalCreate.apply(scopedFactory, args);
    };

    const credentialPrototype = MCPOAuthCredentialStore.prototype as MCPOAuthCredentialStore & {
        hasTokens: MCPOAuthCredentialStore['hasTokens'];
        clear: MCPOAuthCredentialStore['clear'];
    };
    const originalHasTokens = credentialPrototype.hasTokens;
    credentialPrototype.hasTokens = function patchedHasTokens(this: MCPOAuthCredentialStore, ...args: Parameters<typeof originalHasTokens>) {
        return originalHasTokens.apply(withScopedKeyStore(this, registry), args);
    };
    const originalClear = credentialPrototype.clear;
    credentialPrototype.clear = function patchedClear(this: MCPOAuthCredentialStore, ...args: Parameters<typeof originalClear>) {
        return originalClear.apply(withScopedKeyStore(this, registry), args);
    };
}

function withScopedKeyStore<T extends object>(
    target: T,
    registry: QaapWebsocketAuthRegistry,
): T {
    const targetWithKeyStore = target as unknown as { keyStore: KeyStoreService };
    const keyStore = createQaapScopedMcpKeyStore(targetWithKeyStore.keyStore, registry.getCurrentLogin());
    return new Proxy(target, {
        get(object, property, receiver): unknown {
            return property === 'keyStore' ? keyStore : Reflect.get(object, property, receiver);
        },
    });
}
