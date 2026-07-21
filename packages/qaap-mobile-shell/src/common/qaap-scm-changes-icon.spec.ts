// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_MESSAGE_CIRCLE_SVG_MARKUP, QAAP_SCM_CHANGES_SVG_MARKUP } from './qaap-scm-changes-icon';

describe('qaap-scm-changes-icon', () => {

    it('uses the Lucide message-circle glyph for Chat tab', () => {
        expect(QAAP_MESSAGE_CIRCLE_SVG_MARKUP).to.include('M2.992 16.342');
        expect(QAAP_MESSAGE_CIRCLE_SVG_MARKUP).to.include('stroke="currentColor"');
    });

    it('uses the Cursor Changes glyph (minus, plus, frame)', () => {
        const paths = QAAP_SCM_CHANGES_SVG_MARKUP.match(/<path d="/g);
        expect(paths).to.have.length(3);
        expect(QAAP_SCM_CHANGES_SVG_MARKUP).to.include('9.72363');
        expect(QAAP_SCM_CHANGES_SVG_MARKUP).to.include('4.22363');
        expect(QAAP_SCM_CHANGES_SVG_MARKUP).to.include('12.1963');
    });
});
