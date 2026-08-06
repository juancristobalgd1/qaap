/********************************************************************************
 * Copyright (C) 2022 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
 ********************************************************************************/

import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';

import {
    createHttpPatch,
    createProxyResolver,
    createTlsPatch,
    loadSystemCertificates,
    Log,
    LogLevel,
    ProxyAgentParams,
    ProxySupportSetting,
    ResolveProxyWithRequest,
} from '@vscode/proxy-agent';
import { PreferenceRegistryExtImpl } from '../../plugin/preference-registry';
import { WorkspaceExtImpl } from '../../plugin/workspace';

export function connectProxyResolver(workspaceExt: WorkspaceExtImpl, configProvider: PreferenceRegistryExtImpl): void {
    const params = createPluginHostProxyAgentParams(workspaceExt, configProvider);
    const resolveProxy = createProxyResolver(params);
    const lookup = createPatchedModules(params, resolveProxy.resolveProxyWithRequest);
    configureModuleLoading(lookup);
}

export function createPluginHostProxyAgentParams(
    workspaceExt: WorkspaceExtImpl,
    configProvider: PreferenceRegistryExtImpl
): ProxyAgentParams {
    const log: Log = {
        trace: () => undefined,
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    };
    const params: ProxyAgentParams = {
        resolveProxy: async url => workspaceExt.resolveProxy(url),
        getProxyURL: () => configProvider.getConfiguration('http').get<string>('proxy'),
        getProxySupport: () => configProvider.getConfiguration('http').get<ProxySupportSetting>('proxySupport') ?? 'override',
        getNoProxyConfig: () => configProvider.getConfiguration('http').get<string[]>('noProxy') ?? [],
        isAdditionalFetchSupportEnabled: () => false,
        isWebSocketPatchEnabled: () => false,
        addCertificatesV1: () => !!configProvider.getConfiguration('http').get<boolean>('systemCertificates'),
        addCertificatesV2: () => false,
        loadSystemCertificatesFromNode: () => true,
        loadAdditionalCertificates: () => loadSystemCertificates(params),
        log,
        getLogLevel: () => LogLevel.Off,
        proxyResolveTelemetry: () => { },
        isUseHostProxyEnabled: () => true,
        env: process.env,
    };
    return params;
}

interface PatchedModules {
    http: typeof http;
    https: typeof https;
    tls: typeof tls;
}

function createPatchedModules(params: ProxyAgentParams, resolveProxy: ResolveProxyWithRequest): PatchedModules {
    return {
        http: Object.assign(http, createHttpPatch(params, http, resolveProxy)),
        https: Object.assign(https, createHttpPatch(params, https, resolveProxy)),
        tls: Object.assign(tls, createTlsPatch(params, tls))
    };
}

function configureModuleLoading(lookup: PatchedModules): void {
    const node_module = require('module');
    const original = node_module._load;
    node_module._load = function (request: string): typeof tls | typeof http | typeof https {
        if (request === 'tls') {
            return lookup.tls;
        }

        if (request !== 'http' && request !== 'https') {
            return original.apply(this, arguments);
        }

        // Create a shallow copy of the http(s) module to work around extensions that apply changes to the modules
        // See for more info: https://github.com/microsoft/vscode/issues/93167
        return { ...lookup[request] };
    };
}
