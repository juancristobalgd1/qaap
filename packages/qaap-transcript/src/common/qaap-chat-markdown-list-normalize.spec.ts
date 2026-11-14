// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { normalizeChatMarkdownListBreaks } from './qaap-chat-markdown-list-normalize';

describe('normalizeChatMarkdownListBreaks', () => {

    it('moves a bullet marker pasted after a bold title onto its own paragraph', () => {
        expect(normalizeChatMarkdownListBreaks('**Mockup Studio Pro** * **Canvas** editor')).to.equal(
            '**Mockup Studio Pro**\n\n* **Canvas** editor'
        );
    });

    it('moves an ordered marker pasted after sentence text onto its own paragraph', () => {
        expect(normalizeChatMarkdownListBreaks('Plan ready: 1. **Scope** first. 2. **Build** next.')).to.equal(
            'Plan ready:\n\n1. **Scope** first.\n\n2. **Build** next.'
        );
    });

    it('leaves fenced code blocks untouched', () => {
        const code = '```\nSee note. * **not a list**\n```';
        expect(normalizeChatMarkdownListBreaks(code)).to.equal(code);
    });

    it('leaves inline code spans untouched', () => {
        const text = 'Run `npm test. * **x**` then stop.';
        expect(normalizeChatMarkdownListBreaks(text)).to.equal(text);
    });

    it('does not rewrite markdown that is already valid', () => {
        const valid = '**Title**\n\n* first item\n* second item\n\n1. step one\n2. step two';
        expect(normalizeChatMarkdownListBreaks(valid)).to.equal(valid);
    });

    it('does not split a hyphenated word or a lowercase continuation', () => {
        const prose = 'Use the well-known approach. - it works in version 2.1 today.';
        expect(normalizeChatMarkdownListBreaks(prose)).to.equal(prose);
    });
});
