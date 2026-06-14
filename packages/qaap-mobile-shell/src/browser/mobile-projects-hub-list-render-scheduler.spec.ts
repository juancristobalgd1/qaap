// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapChatViewStreamUpdateScheduler } from '../common/qaap-chat-view-stream-update-scheduler';

describe('work-hub list render scheduler integration', () => {

    it('coalesces bursty scheduleRenderList calls into one hub list rebuild per frame', () => {
        let renderListCalls = 0;
        let rafCallback: (() => void) | undefined;
        const scheduler = new QaapChatViewStreamUpdateScheduler(
            () => { renderListCalls++; },
            () => 0,
            {
                scheduleFrame: callback => {
                    rafCallback = callback;
                    return 1;
                },
                cancelFrame: () => {
                    rafCallback = undefined;
                },
                setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
                clearTimeout: () => undefined,
            },
        );

        for (let i = 0; i < 50; i++) {
            scheduler.schedule();
        }
        expect(renderListCalls).to.equal(0);

        rafCallback?.();
        expect(renderListCalls).to.equal(1);
        expect(scheduler.getFlushCount()).to.equal(1);
    });
});
