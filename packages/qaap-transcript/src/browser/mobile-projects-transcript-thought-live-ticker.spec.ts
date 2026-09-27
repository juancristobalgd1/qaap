// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { refreshTranscriptThoughtBriefTitle } from './mobile-projects-transcript-messages-artifacts-helpers';
import { sharedSecondTicker } from './qaap-shared-elapsed-ticker';

/** Real 1 s shared ticker: wait just past one tick. */
const afterTick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 1150));

describe('transcript thought-brief live title on the shared ticker', function (): void {
    this.timeout(10_000);

    let disableJSDOM: (() => void) | undefined;
    let refreshed: boolean[];

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        refreshed = [];
    });

    afterEach(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    const liveBlock = (): { block: HTMLElement; title: HTMLElement } => {
        const block = document.createElement('div');
        block.classList.add('theia-mod-thinking-live');
        const title = document.createElement('span');
        block.append(title);
        document.body.append(block);
        return { block, title };
    };

    const refresh = (title: HTMLElement, block: HTMLElement): void => refreshTranscriptThoughtBriefTitle(title, block, {
        thinking: 'plan',
        thinkingActive: true,
        streaming: true,
        turnStartMs: Date.now(),
    }, {
        refreshTranscriptThoughtBriefTitle: (_title, _block, options) => { refreshed.push(options.thinkingActive); },
    });

    it('registers each block once and refreshes the settled title when thinking ends', async () => {
        const { block, title } = liveBlock();
        refresh(title, block);
        refresh(title, block);
        expect(sharedSecondTicker.has(block)).to.equal(true);
        expect(title.textContent).to.equal('Deep Thinking...');

        block.classList.remove('theia-mod-thinking-live');
        await afterTick();
        expect(refreshed).to.deep.equal([false], 'one settle refresh, not one per registration');
        expect(sharedSecondTicker.has(block)).to.equal(false);
        expect(block.dataset.thoughtLiveTimer).to.equal(undefined);
        block.remove();
    });

    it('drops a detached block and lets a remounted block register again', async () => {
        const { block, title } = liveBlock();
        refresh(title, block);
        block.remove();
        await afterTick();
        expect(sharedSecondTicker.has(block)).to.equal(false);
        expect(refreshed).to.deep.equal([]);

        document.body.append(block);
        refresh(title, block);
        expect(sharedSecondTicker.has(block)).to.equal(true);
        sharedSecondTicker.unregister(block);
        block.remove();
    });
});
