// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildQaapPreviewBridgeLoader,
    injectQaapPreviewBridgeLoader,
    QAAP_PREVIEW_BRIDGE_INIT_TYPE,
    QAAP_PREVIEW_BRIDGE_READY_TYPE,
} from './qaap-preview-bridge-protocol';

describe('qaap-preview-bridge-protocol', () => {
    it('locks loader initialization to the configured parent source and origin', () => {
        const script = buildQaapPreviewBridgeLoader('https://app.qaap.example');
        expect(script).to.contain(QAAP_PREVIEW_BRIDGE_READY_TYPE);
        expect(script).to.contain(QAAP_PREVIEW_BRIDGE_INIT_TYPE);
        expect(script).to.contain('event.source!==window.parent');
        expect(script).to.contain('event.origin!==parentOrigin');
        expect(script).not.to.contain("postMessage({type:" + JSON.stringify(QAAP_PREVIEW_BRIDGE_READY_TYPE) + "},'*')");
    });

    it('injects once before head closes', () => {
        const html = '<html><head><title>App</title></head><body></body></html>';
        const injected = injectQaapPreviewBridgeLoader(html, 'https://app.qaap.example');
        expect(injected.indexOf('data-qaap-preview-bridge-loader')).to.be.lessThan(injected.indexOf('</head>'));
        expect(injectQaapPreviewBridgeLoader(injected, 'https://app.qaap.example')).to.equal(injected);
    });
});
