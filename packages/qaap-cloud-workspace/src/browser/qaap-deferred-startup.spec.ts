// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { QaapDeferredStartup, QaapVisibleInterval } from './qaap-deferred-startup';

disableJSDOM();

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new window.Event('visibilitychange'));
}

class TestDeferredStartup extends QaapDeferredStartup {
    constructor(ready: Promise<void>) {
        super();
        (this as unknown as { stateService: Partial<FrontendApplicationStateService> }).stateService = {
            reachedState: () => ready,
        };
    }
}

describe('QaapVisibleInterval', () => {

    before(() => disableJSDOM = enableJSDOM());
    after(() => disableJSDOM());

    it('skips ticks while hidden and ticks once when the tab becomes visible again', async () => {
        setVisibility('visible');
        let ticks = 0;
        const interval = new QaapVisibleInterval(() => { ticks++; }, 20);
        try {
            setVisibility('hidden');
            await sleep(90);
            expect(ticks).to.equal(0);
            setVisibility('visible');
            expect(ticks).to.equal(1);
            await sleep(70);
            expect(ticks).to.be.greaterThan(1);
        } finally {
            interval.dispose();
        }
        const afterDispose = ticks;
        await sleep(60);
        setVisibility('visible');
        expect(ticks).to.equal(afterDispose);
    });
});

describe('QaapDeferredStartup', () => {

    before(() => disableJSDOM = enableJSDOM());
    after(() => disableJSDOM());

    it('runs the task only after the app reached ready (and an idle slot)', async () => {
        let resolveReady: () => void = () => undefined;
        const ready = new Promise<void>(resolve => { resolveReady = resolve; });
        let ran = false;
        new TestDeferredStartup(ready).whenReadyAndIdle(() => { ran = true; });
        await sleep(10);
        expect(ran).to.equal(false);
        resolveReady();
        for (let i = 0; i < 40 && !ran; i++) {
            await sleep(100);
        }
        expect(ran).to.equal(true);
    }).timeout(10_000);

    it('never runs a task disposed before ready', async () => {
        let resolveReady: () => void = () => undefined;
        const ready = new Promise<void>(resolve => { resolveReady = resolve; });
        let ran = false;
        const handle = new TestDeferredStartup(ready).whenReadyAndIdle(() => { ran = true; });
        handle.dispose();
        resolveReady();
        await sleep(2_000);
        expect(ran).to.equal(false);
    }).timeout(10_000);
});
