// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Container, ContainerModule, injectable } from '@theia/core/shared/inversify';
import { JSONObject, JSONValue } from '@theia/core/shared/@lumino/coreutils';
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

const API_KEY = 'ai-features.openrouter.openrouterApiKey';
const POLICY = 'ai-features.chat.defaultChatAgent';

@injectable()
class FakeSharedUserProvider implements PreferenceProvider {
    readonly values: Record<string, JSONValue> = { [API_KEY]: 'sk-other-tenant', [POLICY]: 'Coder', 'editor.fontSize': 14 };
    readonly emitter = new Emitter<PreferenceProviderDataChanges>();
    readonly onDidPreferencesChanged = this.emitter.event;
    readonly ready = Promise.resolve();
    canHandleScope(): boolean {
        return true;
    }
    get<T>(name: string): T | undefined {
        return this.values[name] as unknown as T;
    }
    resolve<T>(name: string): PreferenceResolveResult<T> {
        return { value: this.get<T>(name) };
    }
    async setPreference(key: string, value: JSONValue): Promise<boolean> {
        this.values[key] = value;
        return true;
    }
    getPreferences(): JSONObject {
        return { ...this.values };
    }
    dispose(): void {
        this.emitter.dispose();
    }
}

describe('QaapTenantAiUserPreferenceProvider', () => {

    let tenant: boolean;
    let shared: FakeSharedUserProvider;
    let provider: QaapTenantAiUserPreferenceProvider;
    let events: PreferenceProviderDataChanges[];

    beforeEach(() => {
        tenant = true;
        shared = new FakeSharedUserProvider();
        provider = new QaapTenantAiUserPreferenceProvider(shared, () => tenant);
        events = [];
        provider.onDidPreferencesChanged(changes => events.push(changes));
    });

    it('never exposes shared credentials to a tenant; other AI settings may inherit operator policy', () => {
        expect(provider.get(API_KEY)).to.equal(undefined);
        expect(provider.get(POLICY)).to.equal('Coder');
        expect(provider.get('editor.fontSize')).to.equal(14);
        expect(provider.getPreferences()).to.deep.equal({ [POLICY]: 'Coder', 'editor.fontSize': 14 });
    });

    it('keeps tenant writes out of the shared provider and fires a change event', async () => {
        const pushed: string[] = [];
        provider.onDidChangeTenantSetting(key => pushed.push(key));
        await provider.setPreference(POLICY, 'Architect');
        expect(provider.get(POLICY)).to.equal('Architect');
        expect(shared.values[POLICY]).to.equal('Coder');
        expect(pushed).to.deep.equal([POLICY]);
        expect(events).to.deep.equal([{ [POLICY]: { preferenceName: POLICY, oldValue: 'Coder', newValue: 'Architect', scope: PreferenceScope.User } }]);
    });

    it('tracks resets for deletion and falls back again', async () => {
        await provider.setPreference(API_KEY, 'sk-alice');
        await provider.setPreference(API_KEY, undefined as unknown as JSONValue);
        expect(provider.get(API_KEY)).to.equal(undefined);
        expect([...provider.tenantResetKeys()]).to.deep.equal([API_KEY]);
        expect(events.map(change => change[API_KEY].newValue)).to.deep.equal(['sk-alice', undefined]);
    });

    it('hydrates stored settings with events but keeps edits made before hydration', async () => {
        await provider.setPreference(POLICY, 'Architect');
        provider.applyTenantSettings({ [POLICY]: 'Stale', [API_KEY]: 'sk-alice', 'editor.fontSize': 20 });
        expect(provider.get(POLICY)).to.equal('Architect');
        expect(provider.get(API_KEY)).to.equal('sk-alice');
        expect(provider.get('editor.fontSize')).to.equal(14);
        expect(events.map(Object.keys)).to.deep.equal([[POLICY], [API_KEY]]);
    });

    it('drops shared-file change events for keys the tenant does not read from it', () => {
        shared.emitter.fire({
            [API_KEY]: { preferenceName: API_KEY, newValue: 'sk-leak', scope: PreferenceScope.User },
            'editor.fontSize': { preferenceName: 'editor.fontSize', newValue: 16, scope: PreferenceScope.User },
        });
        expect(events.map(Object.keys)).to.deep.equal([['editor.fontSize']]);
    });

    it('is a pass-through for local / anonymous users', async () => {
        tenant = false;
        expect(provider.get(API_KEY)).to.equal('sk-other-tenant');
        await provider.setPreference(API_KEY, 'sk-local');
        expect(shared.values[API_KEY]).to.equal('sk-local');
        expect(provider.tenantSettings().size).to.equal(0);
    });

    it('decorates only the User-scope provider binding', () => {
        const container = new Container();
        container.load(new ContainerModule((bind, _unbind, _isBound, _rebind, _unbindAsync, onActivation) => {
            bind(PreferenceProvider).to(FakeSharedUserProvider).inSingletonScope().whenTargetNamed(PreferenceScope.User);
            bind(PreferenceProvider).to(FakeSharedUserProvider).inSingletonScope().whenTargetNamed(PreferenceScope.Workspace);
            decorateQaapTenantAiUserPreferenceProvider(onActivation, () => true);
        }));
        const user = container.getNamed<PreferenceProvider>(PreferenceProvider, PreferenceScope.User);
        expect(user).to.be.instanceOf(QaapTenantAiUserPreferenceProvider);
        expect(container.getNamed<PreferenceProvider>(PreferenceProvider, PreferenceScope.User)).to.equal(user);
        expect(container.getNamed(PreferenceProvider, PreferenceScope.Workspace)).to.be.instanceOf(FakeSharedUserProvider);
    });
});
