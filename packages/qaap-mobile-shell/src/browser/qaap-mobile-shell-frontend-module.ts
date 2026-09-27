// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// qaap-mobile-touch-scroll.css is imported by the Work Hub composition root together with the other product
// stylesheets so the cascade order stays in one place.

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';
import { MobileEditorGestureContribution } from './mobile-editor-gesture-contribution';
import { LongPressContextMenuContribution } from './long-press-context-menu';
import { MobileTouchScrollContribution } from './mobile-touch-scroll-contribution';
import { QaapMobileAppPreferenceContribution } from './qaap-mobile-app-preferences';

export default new ContainerModule(bind => {
    bind(MobileEditorGestureContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MobileEditorGestureContribution);

    bind(LongPressContextMenuContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(LongPressContextMenuContribution);

    bind(MobileTouchScrollContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MobileTouchScrollContribution);

    bind(QaapMobileAppPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapMobileAppPreferenceContribution);
});
