// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildQaapVisualFlowMarkdown,
    buildQaapVisualVerificationMarkdown,
    buildQaapVisualVideoMarkdown,
    conversationLikelyNeedsVisualVerification,
    parseQaapCaptureDirective,
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

    it('captures when the agent invokes the [QAAP capture] directive', () => {
        expect(conversationLikelyNeedsVisualVerification({
            messages: [
                { role: 'user', content: 'levanta la app y muestra una captura de la primera pantalla' },
                { role: 'agent', content: 'La app está lista en el 8080.\n\n[QAAP capture]' },
            ],
        })).to.equal(true);
        // Directive inside a text segment counts too.
        expect(conversationLikelyNeedsVisualVerification({
            messages: [{
                role: 'agent',
                content: 'done',
                segments: [{ type: 'text', content: 'Listo.\n[QAAP capture: / /pricing]' }],
            }],
        })).to.equal(true);
    });

    it('captures mechanically when the turn edited a renderable file', () => {
        expect(conversationLikelyNeedsVisualVerification({
            messages: [{
                role: 'agent',
                content: 'done',
                segments: [{ type: 'tool', name: 'Edit', args: '{"file_path":"src/App.tsx"}' }],
            }],
        })).to.equal(true);
    });

    it('stays quiet without a directive or renderable edits — no natural-language guessing', () => {
        // Ask-only reply, nothing edited.
        expect(conversationLikelyNeedsVisualVerification({
            messages: [
                { role: 'user', content: 'creme un cambio en la ui' },
                { role: 'agent', content: '¿Dónde está el proyecto? ¿Qué debe mostrar?' },
            ],
        })).to.equal(false);
        // Non-visual edit and no directive: the agent decides, not a keyword list.
        expect(conversationLikelyNeedsVisualVerification({
            messages: [
                { role: 'user', content: 'dame una evidencia visual de esta aplicacion' },
                {
                    role: 'agent',
                    content: 'Aquí tienes una descripción de la app…',
                    segments: [{ type: 'tool', name: 'Write', args: '{"file_path":"notes.md"}' }],
                },
            ],
        })).to.equal(false);
    });

    it('parses directive routes with validation and cap', () => {
        expect(parseQaapCaptureDirective({ content: 'Listo.\n[QAAP capture]' }))
            .to.deep.equal({ requested: true, mode: 'image', routes: [] });
        expect(parseQaapCaptureDirective({ content: '[qaap capture: / /Pricing /a/b bad-route /c /d]' }))
            .to.deep.equal({ requested: true, mode: 'image', routes: ['/', '/pricing', '/a/b'] });
        expect(parseQaapCaptureDirective({ content: 'sin directiva' }))
            .to.deep.equal({ requested: false, mode: 'image', routes: [] });
    });

    it('parses the video-record directive', () => {
        expect(parseQaapCaptureDirective({ content: 'Grabado.\n[QAAP record]' }))
            .to.deep.equal({ requested: true, mode: 'video', routes: [] });
        expect(parseQaapCaptureDirective({ content: '[QAAP record: / /checkout]' }))
            .to.deep.equal({ requested: true, mode: 'video', routes: ['/', '/checkout'] });
    });

    it('builds a video evidence block with per-route findings', () => {
        const markdown = buildQaapVisualVideoMarkdown('/evidence/v.webm', [
            { label: '/', result: { status: 'passed', summary: 'ok', issues: [] } },
            { label: '/checkout', result: { status: 'warning', summary: '1 finding', issues: ['overflow'] } },
        ]);
        expect(markdown.match(/\[QAAP visual verification\]/g)).to.have.length(1);
        expect(markdown).to.contain('Review recommended');
        expect(markdown).to.contain('Recorded a video tour of 2 pages.');
        expect(markdown).to.contain('- `/checkout`: overflow');
        expect(markdown).to.contain('[QAAP preview video](/evidence/v.webm)');
    });
});
