// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { createStickyComposerUntilDoneToggle } from './qaap-sticky-composer-until-done-toggle';

describe('sticky composer Until done toggle', () => {
    const css = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-composer-goal-loop.css'),
        'utf8',
    );

    it('shows the disabled reason on hover and keyboard focus', () => {
        expect(css).to.match(
            /\.theia-mobile-projects-sticky-composer-until-done\.theia-mod-disabled::after\s*\{[^}]*content:\s*attr\(data-disabled-reason\);/s,
        );
        expect(css).to.match(
            /\.theia-mobile-projects-sticky-composer-until-done\.theia-mod-disabled:hover::after,[\s\S]*?:focus-visible::after\s*\{[^}]*visibility:\s*visible;/,
        );
    });

    describe('DOM behavior', () => {
        let disableJSDOM: (() => void) | undefined;

        before(() => {
            disableJSDOM = enableJSDOM();
        });

        afterEach(() => {
            document.body.replaceChildren();
        });

        after(() => {
            disableJSDOM?.();
            disableJSDOM = undefined;
        });

        it('publishes the reason on disabled toolbar controls and ignores clicks', () => {
            let toggled = false;
            const button = createStickyComposerUntilDoneToggle({
                checked: true,
                disabledReason: 'Turn off Request approval to use Until done.',
                onToggle: () => toggled = true,
            });

            button.click();
            expect(button.getAttribute('aria-disabled')).to.equal('true');
            expect(button.dataset.disabledReason).to.equal('Turn off Request approval to use Until done.');
            expect(button.title).to.equal(button.dataset.disabledReason);
            expect(button.getAttribute('aria-label')).to.contain(button.dataset.disabledReason ?? '');
            expect(toggled).to.equal(false);
        });
    });
});
