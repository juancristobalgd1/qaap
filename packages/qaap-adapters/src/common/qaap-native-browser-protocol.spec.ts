// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isAllowedQaapNativeBrowserUrl,
    sanitizeQaapNativeBrowserBounds,
} from './qaap-native-browser-protocol';

describe('qaap-native-browser-protocol', () => {
    it('allows http/https URLs and blocks non-HTTP schemes and recursive Qaap shell URLs', () => {
        const shell = 'http://localhost:64683';
        expect(isAllowedQaapNativeBrowserUrl('https://github.com/juancristobalgd1/qaap', shell)).to.equal(true);
        expect(isAllowedQaapNativeBrowserUrl('http://127.0.0.1:5173/login', shell)).to.equal(true);
        expect(isAllowedQaapNativeBrowserUrl('http://e098197c82b380e866455984c6a4cb99.localhost:64683/', shell)).to.equal(true);
        expect(isAllowedQaapNativeBrowserUrl('http://localhost:64683/qaap-preview/abc123/', shell)).to.equal(true);
        expect(isAllowedQaapNativeBrowserUrl('http://localhost:64683/qaap-dev/3001/', shell)).to.equal(true);

        expect(isAllowedQaapNativeBrowserUrl('http://localhost:64683/', shell)).to.equal(false);
        expect(isAllowedQaapNativeBrowserUrl('http://localhost:64683/qaap/api/agent-conversations', shell)).to.equal(false);
        expect(isAllowedQaapNativeBrowserUrl('file:///etc/passwd', shell)).to.equal(false);
        expect(isAllowedQaapNativeBrowserUrl('javascript:alert(1)', shell)).to.equal(false);
        expect(isAllowedQaapNativeBrowserUrl('data:text/html,hi', shell)).to.equal(false);
        expect(isAllowedQaapNativeBrowserUrl('', shell)).to.equal(false);
    });

    it('clamps and rounds native bounds to non-negative integers', () => {
        expect(sanitizeQaapNativeBrowserBounds({ x: -12.4, y: 120.6, width: 479.4, height: 642.8 })).to.deep.equal({
            x: 0,
            y: 121,
            width: 479,
            height: 643,
        });
        expect(sanitizeQaapNativeBrowserBounds({ x: Number.NaN, y: Infinity, width: -5, height: 0 })).to.deep.equal({
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        });
    });
});
