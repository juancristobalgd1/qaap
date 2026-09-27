// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import { Container, interfaces, METADATA_KEY } from '@theia/core/shared/inversify';
import { PreferenceScope } from '@theia/core/lib/common/preferences';
import { PreferencesContribution } from '@theia/preferences/lib/browser/preferences-contribution';
import { Preference } from '@theia/preferences/lib/browser/util/preference-types';
import { PreferencesWidget } from '@theia/preferences/lib/browser/views/preference-widget';
import { QaapPreferencesContribution, rebindQaapPreferencesContribution } from './qaap-preferences-contribution';

disableJSDOM();

describe('QaapPreferencesContribution', () => {

    function injectedServices(target: Function): interfaces.ServiceIdentifier[] {
        const services: interfaces.ServiceIdentifier[] = [];
        for (let current = target; current && current !== Object.prototype.constructor; current = Object.getPrototypeOf(current)) {
            const props: Record<string, { key: string | symbol, value: unknown }[]> = Reflect.getOwnMetadata(METADATA_KEY.TAGGED_PROP, current) ?? {};
            for (const tags of Object.values(props)) {
                const injectTag = tags.find(tag => tag.key === METADATA_KEY.INJECT_TAG);
                if (injectTag) {
                    services.push(injectTag.value as interfaces.ServiceIdentifier);
                }
            }
        }
        return services;
    }

    const scope: Preference.SelectedScopeDetails = { scope: PreferenceScope.User, uri: undefined, activeScopeIsFolder: false };

    function createContainer(): { container: Container, widgetsCreated: () => number, scopesSet: unknown[] } {
        const container = new Container();
        let created = 0;
        const scopesSet: unknown[] = [];
        // Stub every service the upstream contribution (and its base classes) inject, except the widget.
        for (const service of injectedServices(PreferencesContribution)) {
            if (service !== PreferencesWidget && !container.isBound(service)) {
                container.bind(service).toConstantValue({});
            }
        }
        container.bind(PreferencesWidget).toDynamicValue(() => {
            created++;
            return { currentScope: scope, setScope: (value: unknown) => scopesSet.push(value) } as unknown as PreferencesWidget;
        }).inSingletonScope();
        // Mirrors upstream `bindViewContribution(bind, PreferencesContribution)`.
        container.bind(PreferencesContribution).toSelf().inSingletonScope();
        rebindQaapPreferencesContribution(container.bind.bind(container), container.rebind.bind(container));
        return { container, widgetsCreated: () => created, scopesSet };
    }

    it('does not build the Settings widget when the contribution is resolved at startup', () => {
        const { container, widgetsCreated } = createContainer();

        const contribution = container.get(PreferencesContribution);

        expect(contribution).to.be.instanceOf(QaapPreferencesContribution);
        expect(widgetsCreated()).to.equal(0);
    });

    it('resolves the Settings widget once a command needs the selected scope', () => {
        const { container, widgetsCreated, scopesSet } = createContainer();
        const contribution = container.get(PreferencesContribution);
        const tracker = (contribution as unknown as { scopeTracker: PreferencesWidget }).scopeTracker;

        expect(tracker.currentScope).to.deep.equal(scope);
        tracker.setScope(PreferenceScope.Workspace);

        expect(widgetsCreated()).to.equal(1);
        expect(scopesSet).to.deep.equal([PreferenceScope.Workspace]);
    });
});
