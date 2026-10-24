// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Container, ContainerModule, inject, injectable, named } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { PreferenceProvider, PreferenceScope } from '@theia/core/lib/common/preferences';
import { PreferenceConfigurations } from '@theia/core/lib/common/preferences/preference-configurations';
import { UserConfigsPreferenceProvider, UserStorageLocationProvider } from '@theia/preferences/lib/common/user-configs-preference-provider';
import { UserPreferenceProviderFactory } from '@theia/preferences/lib/common/user-preference-provider';
import {
    decorateQaapTenantAiUserPreferenceProvider,
    QaapTenantAiUserPreferenceProvider,
} from './qaap-tenant-ai-user-preference-provider';

disableJSDOM();

/**
 * Stands in for the real upstream User provider: it extends the upstream class, so it has the
 * same injected properties (several of them, resolved after the instance is created).
 */
@injectable()
class TestUserConfigsPreferenceProvider extends UserConfigsPreferenceProvider { }

/** Resolves the User provider via a named injection, as `QaapUserAiSettingsSyncContribution` does. */
@injectable()
class UserPreferenceConsumer {
    @inject(PreferenceProvider) @named(PreferenceScope.User)
    readonly userProvider: PreferenceProvider;
}

function bindUpstreamDependencies(container: Container): void {
    container.bind(UserPreferenceProviderFactory).toConstantValue(() => { throw new Error('not used'); });
    // Never resolves: the provider's async init then stays inert, which is all these tests need.
    container.bind(UserStorageLocationProvider).toConstantValue(() => new Promise(() => { }));
    container.bind(PreferenceConfigurations).toConstantValue({ getSectionNames: () => [], getConfigName: () => 'settings' } as unknown as PreferenceConfigurations);
    container.bind(ILogger).toConstantValue({ error: () => { }, warn: () => { }, info: () => { }, debug: () => { } } as unknown as ILogger)
        .whenTargetNamed('preferences:UserConfigsPreferenceProvider');
}

function loadUserDecoration(container: Container): void {
    container.load(new ContainerModule((_bind, _unbind, _isBound, _rebind, _unbindAsync, onActivation) => {
        decorateQaapTenantAiUserPreferenceProvider(onActivation, () => true);
    }));
    container.load(new ContainerModule(bind => {
        bind(PreferenceProvider).to(TestUserConfigsPreferenceProvider).inSingletonScope().whenTargetNamed(PreferenceScope.User);
        bind(UserPreferenceConsumer).toSelf();
    }));
}

describe('Tenant AI preference provider decoration (instance-based, independent of request chain)', () => {

    describe('User scope', () => {

        it('wraps the upstream User provider when resolved by name', () => {
            const container = new Container();
            bindUpstreamDependencies(container);
            loadUserDecoration(container);
            const user = container.getNamed<PreferenceProvider>(PreferenceProvider, PreferenceScope.User);
            expect(user).to.be.instanceOf(QaapTenantAiUserPreferenceProvider);
            // Theia's launch-preferences api-test reads `userPreferences['providers']` on the wrapped provider.
            const providers = (user as unknown as { providers?: Map<unknown, unknown> }).providers;
            expect(providers).to.be.instanceOf(Map);
        });

        it('wraps the upstream User provider when injected as a @named(User) dependency', () => {
            const container = new Container();
            bindUpstreamDependencies(container);
            loadUserDecoration(container);
            const consumer = container.get(UserPreferenceConsumer);
            expect(consumer.userProvider).to.be.instanceOf(QaapTenantAiUserPreferenceProvider);
        });
    });
});
