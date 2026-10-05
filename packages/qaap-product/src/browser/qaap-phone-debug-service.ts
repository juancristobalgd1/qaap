// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { IJSONSchema, IJSONSchemaSnippet } from '@theia/core/lib/common/json-schema';
import { DebugConfiguration } from '@theia/debug/lib/common/debug-configuration';
import { DebuggerDescription, DebugService } from '@theia/debug/lib/common/debug-service';
import { CommandIdVariables } from '@theia/variable-resolver/lib/common/variable-types';

/**
 * Bound by `qaap-product-plugin-frontend-module`, i.e. only when the entry has plugin-ext (desktop).
 * That module loads before `qaap-product-bindings-frontend-module`.
 */
export const QaapPluginHostFrontend = Symbol('QaapPluginHostFrontend');

/** The backend debug service proxy (`DebugPath`) the phone entry talks to. */
export const QaapPhoneDebugServer = Symbol('QaapPhoneDebugServer');

/**
 * `DebugService` for the phone entry (bundle.mobile.js).
 *
 * The desktop entry rebinds `DebugService` to plugin-ext's `PluginDebugService`, which owns the
 * `onDid*` events. The phone entry has no plugin-ext, so `@theia/debug` would hand out the raw RPC
 * proxy, and subscribing to `onDidChangeDebugConfigurationProviders` would send a notification the
 * backend does not implement (`this.target[method] is not a function`). Events stay local here
 * (no plugin contributes debuggers on a phone); requests go to the backend unchanged.
 */
@injectable()
export class QaapPhoneDebugService implements DebugService {

    @inject(QaapPhoneDebugServer)
    protected readonly server: DebugService;

    protected readonly onDidChangeDebugConfigurationProvidersEmitter = new Emitter<void>();

    get onDidChangeDebugConfigurationProviders(): Event<void> {
        return this.onDidChangeDebugConfigurationProvidersEmitter.event;
    }

    debugTypes(): Promise<string[]> {
        return this.server.debugTypes();
    }

    getDebuggersForLanguage(language: string): Promise<DebuggerDescription[]> {
        return this.server.getDebuggersForLanguage(language);
    }

    provideDebuggerVariables(debugType: string): Promise<CommandIdVariables> {
        return this.server.provideDebuggerVariables(debugType);
    }

    getSchemaAttributes(debugType: string): Promise<IJSONSchema[]> {
        return this.server.getSchemaAttributes(debugType);
    }

    getConfigurationSnippets(): Promise<IJSONSchemaSnippet[]> {
        return this.server.getConfigurationSnippets();
    }

    provideDebugConfigurations(debugType: string, workspaceFolderUri: string | undefined): Promise<DebugConfiguration[]> {
        return this.server.provideDebugConfigurations(debugType, workspaceFolderUri);
    }

    fetchDynamicDebugConfiguration(name: string, type: string, folder?: string): Promise<DebugConfiguration | undefined> {
        return this.server.fetchDynamicDebugConfiguration(name, type, folder);
    }

    resolveDebugConfiguration(config: DebugConfiguration, workspaceFolderUri: string | undefined): ReturnType<DebugService['resolveDebugConfiguration']> {
        return this.server.resolveDebugConfiguration(config, workspaceFolderUri);
    }

    resolveDebugConfigurationWithSubstitutedVariables(
        config: DebugConfiguration,
        workspaceFolderUri: string | undefined
    ): ReturnType<DebugService['resolveDebugConfiguration']> {
        return this.server.resolveDebugConfigurationWithSubstitutedVariables(config, workspaceFolderUri);
    }

    createDebugSession(config: DebugConfiguration, workspaceFolderUri: string | undefined): Promise<string> {
        return this.server.createDebugSession(config, workspaceFolderUri);
    }

    terminateDebugSession(sessionId: string): Promise<void> {
        return this.server.terminateDebugSession(sessionId);
    }

    dispose(): void {
        this.onDidChangeDebugConfigurationProvidersEmitter.dispose();
        this.server.dispose();
    }
}
