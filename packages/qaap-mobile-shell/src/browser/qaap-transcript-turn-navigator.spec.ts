// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

import { expect } from 'chai';
import { attachTranscriptTurnNavigator } from './qaap-transcript-turn-navigator';

describe('qaap-transcript-turn-navigator', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        const raf = (callback: FrameRequestCallback): number => setTimeout(() => callback(performance.now()), 0) as unknown as number;
        window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = (handle: number): void => clearTimeout(handle);
        globalThis.requestAnimationFrame = raf;
        globalThis.cancelAnimationFrame = (handle: number): void => clearTimeout(handle);
        HTMLElement.prototype.scrollIntoView = () => undefined;
    });

    it('shows jump dots for long conversations and marks the active turn', async () => {
        const mount = document.createElement('div');
        const scroller = document.createElement('div');
        Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
        scroller.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 300, width: 300, height: 400, x: 0, y: 0, toJSON: () => undefined });
        for (let index = 0; index < 3; index++) {
            const row = document.createElement('div');
            row.className = 'theia-mobile-agent-transcript-user-wrap';
            row.setAttribute('data-transcript-message-id', `u${index}`);
            row.getBoundingClientRect = () => ({ top: index * 120, bottom: index * 120 + 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: index * 120, toJSON: () => undefined });
            scroller.append(row);
        }
        mount.append(scroller);
        document.body.append(mount);

        const disposable = attachTranscriptTurnNavigator(mount, scroller);
        await new Promise(resolve => setTimeout(resolve, 5));

        const nav = mount.querySelector<HTMLElement>('.theia-mobile-agent-transcript-turn-nav');
        const buttons = [...mount.querySelectorAll<HTMLButtonElement>('.theia-mobile-agent-transcript-turn-nav-dot')];
        expect(nav?.hidden).to.equal(false);
        expect(buttons.length).to.equal(3);
        expect(buttons[0].classList.contains('theia-mod-active')).to.equal(true);
        disposable.dispose();
    });

    it('hides for short conversations', () => {
        const mount = document.createElement('div');
        const scroller = document.createElement('div');
        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-transcript-user-wrap';
        row.setAttribute('data-transcript-message-id', 'u1');
        scroller.append(row);
        mount.append(scroller);
        document.body.append(mount);

        const disposable = attachTranscriptTurnNavigator(mount, scroller);

        expect(mount.querySelector<HTMLElement>('.theia-mobile-agent-transcript-turn-nav')?.hidden).to.equal(true);
        disposable.dispose();
    });
});
