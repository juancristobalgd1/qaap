// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildQaapVisualFlowMarkdown,
    buildQaapVisualVerificationMarkdown,
    conversationLikelyNeedsVisualVerification,
    QAAP_VISUAL_VERIFICATION_MARKER,
} from './qaap-visual-verification';

describe('qaap-visual-verification', () => {
    it('builds persistent screenshot evidence with warnings', () => {
        const markdown = buildQaapVisualVerificationMarkdown('/evidence/1', {
            status: 'warning',
            summary: 'Preview loaded with 2 findings.',
            issues: ['Missing page heading', 'One broken image'],
        });
        expect(markdown).to.contain(QAAP_VISUAL_VERIFICATION_MARKER);
        expect(markdown).to.contain('Review recommended');
        expect(markdown).to.contain('Missing page heading');
        expect(markdown).to.contain('![QAAP preview evidence](/evidence/1)');
    });

    it('builds one evidence block per walked route, marked once', () => {
        const markdown = buildQaapVisualFlowMarkdown([
            { label: '/', imageUrl: '/evidence/1', result: { status: 'passed', summary: 'Home ok.', issues: [] } },
            { label: '/checkout', imageUrl: '/evidence/2', result: { status: 'warning', summary: '1 finding.', issues: ['overflow'] } },
        ]);
        expect(markdown.match(/\[QAAP visual verification\]/g)).to.have.length(1);
        expect(markdown).to.contain('Review recommended');
        expect(markdown).to.contain('Walked 2 pages of the app flow.');
        expect(markdown).to.contain('![QAAP preview evidence /](/evidence/1)');
        expect(markdown).to.contain('![QAAP preview evidence /checkout](/evidence/2)');
        expect(markdown).to.contain('- overflow');
    });

    it('detects UI requests and edited visual files', () => {
        expect(conversationLikelyNeedsVisualVerification({
            messages: [{ role: 'user', content: 'Rediseña la pantalla principal' }],
        })).to.equal(true);
        expect(conversationLikelyNeedsVisualVerification({
            messages: [{
                role: 'agent',
                content: 'done',
                segments: [{ type: 'tool', name: 'Edit', args: '{"file_path":"src/App.tsx"}' }],
            }],
        })).to.equal(true);
        expect(conversationLikelyNeedsVisualVerification({
            messages: [{ role: 'user', content: 'Corrige el cálculo del backend' }],
        })).to.equal(false);
    });
});
