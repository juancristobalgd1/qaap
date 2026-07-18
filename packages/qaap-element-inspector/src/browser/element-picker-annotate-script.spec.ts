// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    ELEMENT_ANNOTATION_POINT_TYPE,
    ELEMENT_ANNOTATION_REANCHOR_TYPE,
    ELEMENT_PICKER_MESSAGE_TYPE,
    ELEMENT_SET_MODE_TYPE,
} from './element-inspector-types';
import { buildElementBridgeScript, buildElementPickerScript } from './element-picker-script';

describe('element-picker annotate bridge', () => {
    it('bridge script includes annotate mode protocol without removing select types', () => {
        const bridge = buildElementBridgeScript({
            channelId: 'channel-1',
            parentOrigin: 'https://app.qaap.example',
        });
        expect(bridge).to.contain(ELEMENT_SET_MODE_TYPE);
        expect(bridge).to.contain(ELEMENT_ANNOTATION_POINT_TYPE);
        expect(bridge).to.contain(ELEMENT_ANNOTATION_REANCHOR_TYPE);
        expect(bridge).to.contain('annotateReady');
        expect(bridge).to.contain("mode === 'annotate'");
        expect(bridge).to.contain('qaap-annotate-mode');
        expect(bridge).to.contain('theia-mini-browser-annotate-style');
        expect(bridge).to.contain('channel-1');
        expect(bridge).to.contain('event.source !== window.parent');
        expect(bridge).to.contain('event.origin !== PARENT_ORIGIN');
    });

    it('picker script still posts the select capture message type', () => {
        const picker = buildElementPickerScript();
        expect(picker).to.contain(ELEMENT_PICKER_MESSAGE_TYPE);
        expect(picker).to.contain('Pick an element');
    });
});
