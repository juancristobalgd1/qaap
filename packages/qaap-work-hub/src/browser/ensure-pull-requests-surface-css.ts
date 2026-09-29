// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapLazyStylesheets } from '@theia/qaap-product-theme/lib/browser/qaap-lazy-stylesheets';

let pullRequestsSurfaceCss: Promise<void> | undefined;

/**
 * Loads the Work Hub pull request list / header / detail styles (`?qaap-lazy`, not in
 * `bundle.css`). The PR surfaces render synchronously, so entry points call this
 * fire-and-forget and `QaapLazySurfaceStylesheetsPreload` warms it once the app is idle.
 */
export function ensurePullRequestsSurfaceCss(): Promise<void> {
    if (!pullRequestsSurfaceCss) {
        pullRequestsSurfaceCss = import('../../src/browser/style/qaap-work-hub-pull-requests.css?qaap-lazy')
            .then(module => QaapLazyStylesheets.load(module.default));
    }
    return pullRequestsSurfaceCss;
}
