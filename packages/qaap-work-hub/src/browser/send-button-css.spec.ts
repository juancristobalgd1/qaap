// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The send button is styled in one place. A later, more specific rule for the idle, ready or
 * sized states would silently repaint it (a cream fill at 32px was measured live), so this guards
 * every stylesheet that targets it.
 */
describe('sticky composer send button CSS', () => {
    const styleDirs = [
        path.join(__dirname, '..', '..', 'src', 'browser', 'style'),
        path.join(__dirname, '..', '..', '..', 'qaap-composer', 'src', 'browser', 'style'),
        path.join(__dirname, '..', '..', '..', 'qaap-transcript', 'src', 'browser', 'style'),
    ];
    const cssFiles = styleDirs.flatMap(dir => fs.readdirSync(dir)
        .filter(file => file.endsWith('.css'))
        .map(file => path.join(dir, file)));

    /** Rules whose selectors target the send button itself (not its icon). */
    function sendRules(): { file: string; selector: string; body: string }[] {
        const rules: { file: string; selector: string; body: string }[] = [];
        for (const file of cssFiles) {
            const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
            const block = /([^{}]+)\{([^{}]*)\}/g;
            let match: RegExpExecArray | null;
            while ((match = block.exec(css)) !== null) {
                for (const selector of match[1].split(',').map(part => part.trim())) {
                    if (/sticky-composer-send(?!-icon)/.test(selector)) {
                        rules.push({ file: path.basename(file), selector, body: match[2] });
                    }
                }
            }
        }
        return rules;
    }

    it('keeps the fill, size and colour of the send button in its own canonical rules only', () => {
        // Selectors allowed to set fill, size or colour: the base button, its hover, press, disabled and
        // ready states, and the stop/stopping states, which are owned by other behaviour.
        const allowed = /\.theia-mobile-projects-sticky-composer-send(?::hover:not\(:disabled\)|:active:not\(:disabled\)|:disabled|\[aria-disabled='true'\]|\.theia-mod-ready:not\(:disabled\):not\(\.theia-mod-stop\)|\.theia-mod-stop(?:ping)?(?::disabled)?)?$/;
        const sizing = /(?:^|;|\s)(?:background|background-color|width|min-width|max-width|height|color|flex|flex-basis)\s*:/;
        const offenders = sendRules()
            .filter(rule => sizing.test(rule.body) && !allowed.test(rule.selector))
            .map(rule => `${rule.file}: ${rule.selector}`);
        expect(offenders).to.deep.equal([]);
    });

    it('gives the ready state the grey fill, not the cream one', () => {
        const ready = sendRules().find(rule => rule.selector.includes('theia-mod-ready'));
        expect(ready).to.not.equal(undefined);
        expect(ready!.body).to.match(/color-mix\(in srgb,\s*var\(--theia-foreground\)\s*20%/);
        expect(ready!.body).to.not.match(/send-ready-bg|#fff|#E58E40/i);
    });
});
