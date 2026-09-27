// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { Saveable } from '@theia/core/lib/browser';
import { NavigatorTabBarDecorator } from '@theia/navigator/lib/browser/navigator-tab-bar-decorator';

/**
 * Qaap override of {@link NavigatorTabBarDecorator} that tolerates a missing
 * `applicationShell` during early startup. The upstream implementation accesses
 * `this.applicationShell.widgets` unconditionally, which throws (and prevents the
 * dirty-editors badge from updating) when decoration is requested before
 * `onStart` has assigned the shell — e.g. when the Work Hub boot guard delays
 * shell initialization on mobile.
 */
@injectable()
export class QaapNavigatorTabBarDecorator extends NavigatorTabBarDecorator {

    protected override getDirtyEditorsCount(): number {
        return this.applicationShell?.widgets.filter(widget => Saveable.isDirty(widget)).length ?? 0;
    }
}
