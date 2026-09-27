// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { PreferenceScope } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, interfaces } from '@theia/core/shared/inversify';
import { PreferencesContribution } from '@theia/preferences/lib/browser/preferences-contribution';
import { Preference } from '@theia/preferences/lib/browser/util/preference-types';
import { PreferencesWidget } from '@theia/preferences/lib/browser/views/preference-widget';

/**
 * Stands in for the {@link PreferencesWidget} that upstream {@link PreferencesContribution} injects as its
 * `scopeTracker`. It only exposes the scope API the contribution uses and resolves the real (singleton)
 * widget on first use, i.e. when a preferences command runs.
 */
export class QaapLazyPreferencesScopeTracker {

    constructor(protected readonly resolveWidget: () => PreferencesWidget) { }

    get currentScope(): Preference.SelectedScopeDetails {
        return this.resolveWidget().currentScope;
    }

    setScope(scope: PreferenceScope.User | PreferenceScope.Workspace | URI): void {
        this.resolveWidget().setScope(scope);
    }
}

/**
 * Upstream injects the {@link PreferencesWidget} eagerly, so collecting command contributions at startup
 * built the whole Settings editor (tree, renderers, scrollbars) and kept it re-rendering on every
 * preference schema change registered while the frontend boots, all behind the splash. Re-declaring
 * `scopeTracker` with a lazy stand-in takes precedence over the base class injection, so the widget is
 * only created when Settings is actually opened or a preferences command needs the selected scope.
 */
@injectable()
export class QaapPreferencesContribution extends PreferencesContribution {

    @inject(QaapLazyPreferencesScopeTracker)
    protected override readonly scopeTracker: PreferencesWidget;
}

export function rebindQaapPreferencesContribution(bind: interfaces.Bind, rebind: interfaces.Rebind): void {
    bind(QaapLazyPreferencesScopeTracker)
        .toDynamicValue(({ container }) => new QaapLazyPreferencesScopeTracker(() => container.get(PreferencesWidget)))
        .inSingletonScope();
    bind(QaapPreferencesContribution).toSelf().inSingletonScope();
    rebind(PreferencesContribution).toService(QaapPreferencesContribution);
}
