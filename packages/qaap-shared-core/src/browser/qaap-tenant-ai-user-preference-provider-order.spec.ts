// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Container, ContainerModule, injectable } from '@theia/core/shared/inversify';
import { JSONObject } from '@theia/core/shared/@lumino/coreutils';
import { Emitter } from '@theia/core/lib/common/event';
import {
    PreferenceProvider,
    PreferenceProviderDataChanges,
    PreferenceResolveResult,
    PreferenceScope,
} from '@theia/core/lib/common/preferences';
import {
    decorateQaapTenantAiUserPreferenceProvider,
    QaapTenantAiUserPreferenceProvider,
} from './qaap-tenant-ai-user-preference-provider';

disableJSDOM();

/** Stand-in for the upstream User-scope provider (UserConfigsPreferenceProvider). */
@injectable()
class FakeUpstreamUserProvider implements PreferenceProvider {
    readonly emitter = new Emitter<PreferenceProviderDataChanges>();
    readonly onDidPreferencesChanged = this.emitter.event;
    readonly ready = Promise.resolve();
    canHandleScope(): boolean {
        return true;
    }
    get<T>(_name: string): T | undefined {
        return undefined;
    }
    resolve<T>(_name: string): PreferenceResolveResult<T> {
        return {};
    }
    async setPreference(): Promise<boolean> {
        return true;
    }
    getPreferences(): JSONObject {
        return {};
    }
    getScope(): PreferenceScope {
        return PreferenceScope.User;
    }
    getContainerUri(): undefined {
        return undefined;
    }
    dispose(): void { }
}

/** Upstream registration: the User provider is bound as a named PreferenceProvider and resolved lazily. */
const upstreamUserBinding = new ContainerModule(bind => {
    bind(PreferenceProvider).to(FakeUpstreamUserProvider).inSingletonScope().whenTargetNamed(PreferenceScope.User);
});

describe('QaapTenantAiUserPreferenceProvider decoration order', () => {

    it('wraps the User provider when the decorator is loaded before anything resolves it (preload seam)', () => {
        const container = new Container();
        container.load(new ContainerModule((_bind, _unbind, _isBound, _rebind, _unbindAsync, onActivation) => {
            decorateQaapTenantAiUserPreferenceProvider(onActivation, () => true);
        }));
        container.load(upstreamUserBinding);
        const user = container.getNamed<PreferenceProvider>(PreferenceProvider, PreferenceScope.User);
        expect(user).to.be.instanceOf(QaapTenantAiUserPreferenceProvider);
    });

    it('does not wrap a singleton that was already resolved before the decorator was loaded', () => {
        // Documents the failure mode: the first resolution is cached, and a later onActivation never runs for it.
        const container = new Container();
        container.load(upstreamUserBinding);
        const early = container.getNamed<PreferenceProvider>(PreferenceProvider, PreferenceScope.User);
        container.load(new ContainerModule((_bind, _unbind, _isBound, _rebind, _unbindAsync, onActivation) => {
            decorateQaapTenantAiUserPreferenceProvider(onActivation, () => true);
        }));
        const later = container.getNamed<PreferenceProvider>(PreferenceProvider, PreferenceScope.User);
        expect(later).to.equal(early);
        expect(later).not.to.be.instanceOf(QaapTenantAiUserPreferenceProvider);
    });
});
