// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';
import { MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { isQaapMobileDevice, QAAP_MOBILE_DEVICE_MEDIA_QUERY } from './qaap-mobile-device';

describe('qaap-mobile-device', () => {
    const globalWithWindow = global as unknown as { window?: Window };
    let originalWindow: Window | undefined;

    beforeEach(() => {
        originalWindow = globalWithWindow.window;
    });

    afterEach(() => {
        globalWithWindow.window = originalWindow;
    });

    function setMobileMatch(matches: boolean): string[] {
        const queries: string[] = [];
        globalWithWindow.window = {
            matchMedia: (query: string): MediaQueryList => {
                queries.push(query);
                return { matches, media: query } as MediaQueryList;
            },
        } as Window;
        return queries;
    }

    it('uses the same narrow viewport or coarse pointer rule as the mobile shell and boot gate', () => {
        expect(QAAP_MOBILE_DEVICE_MEDIA_QUERY).to.equal(MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY);
        const loginGatePath = path.join(__dirname, '..', '..', '..', 'qaap-product', 'resources', 'qaap-login-gate.js');
        const loginGate = fs.readFileSync(loginGatePath, 'utf8');
        expect(loginGate).to.include(`window.matchMedia('${QAAP_MOBILE_DEVICE_MEDIA_QUERY}')`);
    });

    it('queries the shared mobile rule and reports mobile when it matches', () => {
        const queries = setMobileMatch(true);
        expect(isQaapMobileDevice()).to.equal(true);
        expect(queries).to.deep.equal([QAAP_MOBILE_DEVICE_MEDIA_QUERY]);
    });

    it('reports desktop when the shared mobile rule does not match', () => {
        setMobileMatch(false);
        expect(isQaapMobileDevice()).to.equal(false);
    });

    it('uses desktop semantics when matchMedia is unavailable or throws', () => {
        globalWithWindow.window = {} as Window;
        expect(isQaapMobileDevice()).to.equal(false);

        globalWithWindow.window = {
            matchMedia: () => { throw new Error('media query unavailable'); },
        } as unknown as Window;
        expect(isQaapMobileDevice()).to.equal(false);
    });
});
