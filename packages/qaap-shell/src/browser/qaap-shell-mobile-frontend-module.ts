// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { PreferenceService, createPreferenceProxy } from '@theia/core/lib/common/preferences';
import { TabBarToolbarFactory } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { ToolbarFactory } from '@theia/toolbar/lib/browser/toolbar-interfaces';
import { TOOLBAR_ENABLE_PREFERENCE_ID, ToolbarPreferences, ToolbarPreferencesSchema } from '@theia/toolbar/lib/common/toolbar-preference-contribution';

/**
 * Mobile entry only (`qaapMobile.mobileOnly` of @theia/qaap-product), which leaves out
 * @theia/toolbar: {@link QaapApplicationShellWithToolbar} keeps its layout slot with an empty,
 * hidden tab-bar toolbar (`toolbar.showToolbar` is forced to `false` below, so a stray user setting cannot enable it).
 */
export default new ContainerModule((bind, _unbind, isBound) => {
    if (isBound(ToolbarFactory)) {
        return;
    }
    bind(ToolbarFactory).toFactory(({ container }) => () => container.get<TabBarToolbarFactory>(TabBarToolbarFactory)());
    bind(ToolbarPreferences).toDynamicValue(({ container }) => {
        const preferences = createPreferenceProxy(container.get<PreferenceService>(PreferenceService), ToolbarPreferencesSchema);
        return new Proxy(preferences, {
            get: (target, property, receiver) => property === TOOLBAR_ENABLE_PREFERENCE_ID ? false : Reflect.get(target, property, receiver)
        });
    }).inSingletonScope();
});
