// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveScrollBehavior, scrollElementToEndAfterLayout } from './qaap-prefers-reduced-motion';

describe('qaap-prefers-reduced-motion', () => {

    it('resolveScrollBehavior uses auto when reduced motion is preferred', () => {
        expect(resolveScrollBehavior('smooth', true)).to.equal('auto');
    });

    it('resolveScrollBehavior keeps the preferred behavior otherwise', () => {
        expect(resolveScrollBehavior('smooth', false)).to.equal('smooth');
        expect(resolveScrollBehavior('auto', false)).to.equal('auto');
    });

    it('scrollElementToEndAfterLayout snaps once the scroller has height', () => {
        let clientHeight = 0;
        let scrollTop = 0;
        const scroller = {
            get clientHeight(): number { return clientHeight; },
            scrollHeight: 400,
            get scrollTop(): number { return scrollTop; },
            set scrollTop(value: number) { scrollTop = value; },
            scrollTo(options: { top: number }): void { scrollTop = options.top; },
        } as unknown as HTMLElement;
        scrollElementToEndAfterLayout(scroller);
        expect(scrollTop).to.equal(0);
        clientHeight = 320;
        scrollElementToEndAfterLayout(scroller);
        expect(scrollTop).to.equal(400);
    });
});
