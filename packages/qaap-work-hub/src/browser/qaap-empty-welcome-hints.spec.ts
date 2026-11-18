// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
// Modules below may touch the DOM while loading; it is removed again after the imports
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { createQaapEmptyWelcomeHints, resolveEmptyWelcomeHintIds } from './qaap-empty-welcome-hints';

disableJSDOM();

describe('qaap-empty-welcome-hints', () => {

    let restoreDOM: () => void;

    beforeEach(() => {
        restoreDOM = enableJSDOM();
    });

    afterEach(() => {
        restoreDOM();
    });

    it('offers Connect GitHub only while no account is signed in', () => {
        expect(resolveEmptyWelcomeHintIds(false)).to.deep.equal(['openProject', 'startTask', 'connectGithub']);
        expect(resolveEmptyWelcomeHintIds(true)).to.deep.equal(['openProject', 'startTask']);
    });

    it('renders one chip per hint and runs the matching existing action on click', () => {
        const calls: string[] = [];
        const group = createQaapEmptyWelcomeHints(false, {
            openProject: () => calls.push('openProject'),
            startTask: () => calls.push('startTask'),
            connectGithub: () => calls.push('connectGithub'),
        });
        const chips = [...group.querySelectorAll<HTMLButtonElement>('button.theia-mobile-agent-transcript-empty-hint')];
        expect(chips.map(chip => chip.getAttribute('data-welcome-hint'))).to.deep.equal(['openProject', 'startTask', 'connectGithub']);
        expect(chips.map(chip => chip.textContent)).to.deep.equal(['Open a project', 'Start a task', 'Connect GitHub']);
        chips.forEach(chip => chip.click());
        expect(calls).to.deep.equal(['openProject', 'startTask', 'connectGithub']);
    });

    it('omits Connect GitHub when signed in', () => {
        const group = createQaapEmptyWelcomeHints(true, {
            openProject: () => undefined,
            startTask: () => undefined,
            connectGithub: () => undefined,
        });
        expect(group.querySelector('[data-welcome-hint="connectGithub"]')).to.equal(null);
        expect(group.querySelectorAll('button')).to.have.length(2);
    });
});
