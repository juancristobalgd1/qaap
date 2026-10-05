// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_MOBILE_DEVICE_MEDIA_QUERY } from '../common/qaap-mobile-device';
import { isQaapNarrowMobileWorkbench } from './qaap-mobile-layout-utils';

describe('qaap-mobile-layout-utils', () => {
    const globalWithWindow = global as unknown as { window: Window };
    let originalWindow: Window;

    beforeEach(() => {
        originalWindow = globalWithWindow.window;
    });

    afterEach(() => {
        globalWithWindow.window = originalWindow;
    });

    it('uses the shared mobile-device query for shell layout decisions', () => {
        const queries: string[] = [];
        globalWithWindow.window = {
            matchMedia: (query: string): MediaQueryList => {
                queries.push(query);
                return { matches: true, media: query } as MediaQueryList;
            },
        } as Window;

        expect(isQaapNarrowMobileWorkbench()).to.equal(true);
        expect(queries).to.deep.equal([QAAP_MOBILE_DEVICE_MEDIA_QUERY]);
    });
});
