// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { createStickyComposerUntilDoneSheetOption, createStickyComposerUntilDoneToggle } from './qaap-sticky-composer-until-done-toggle';

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

        it('labels the goal toggle "Goal" with the target icon', () => {
            const button = createStickyComposerUntilDoneToggle({ checked: false, onToggle: () => undefined });
            expect(button.querySelector('.codicon-target')).to.not.equal(null);
            expect(button.querySelector('.codicon-sync')).to.equal(null);
            expect(button.querySelector('.theia-mobile-projects-sticky-composer-until-done-label')?.textContent).to.equal('Goal');
        });

        it('explains Goal in the Mode sheet when it can be used', () => {
            const option = createStickyComposerUntilDoneSheetOption({ checked: false, onToggle: () => undefined }, () => undefined);
            expect(option.querySelector('.theia-mobile-projects-sticky-composer-until-done-option-hint')?.textContent)
                .to.equal('Keeps working and verifying until the goal is met');
        });

        it('turns a Goal row blocked by approvals into a shortcut to the approval picker', () => {
            const calls: string[] = [];
            const option = createStickyComposerUntilDoneSheetOption({
                checked: false,
                disabledReason: 'Requires auto-approve',
                onToggle: () => calls.push('toggle'),
                onResolveDisabled: () => calls.push('resolve'),
            }, () => calls.push('close'));

            option.click();
            expect(option.classList.contains('theia-mod-resolvable')).to.equal(true);
            expect(option.hasAttribute('aria-disabled')).to.equal(false);
            expect(option.textContent).to.contain('Change approvals');
            expect(calls).to.deep.equal(['close', 'resolve']);
        });

        it('keeps a blocked Goal row inert when nothing can fix it from the sheet', () => {
            let toggled = false;
            const option = createStickyComposerUntilDoneSheetOption({
                checked: true,
                disabledReason: 'Not available in Plan mode',
                onToggle: () => toggled = true,
            }, () => undefined);

            option.click();
            expect(option.getAttribute('aria-disabled')).to.equal('true');
            expect(option.textContent).to.contain('Not available in Plan mode');
            expect(toggled).to.equal(false);
        });
    });
});
