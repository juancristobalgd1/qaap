// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    QaapWorkHubFpsSampler,
    readQaapMemorySnapshot,
} from './qaap-work-hub-runtime-metrics';

describe('qaap-work-hub-runtime-metrics', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    it('readQaapMemorySnapshot returns undefined without performance.memory', () => {
        expect(readQaapMemorySnapshot()).to.equal(undefined);
    });

    it('QaapWorkHubFpsSampler reports frame stats after a short sample', async () => {
        const originalRaf = globalThis.requestAnimationFrame;
        const originalCancel = globalThis.cancelAnimationFrame;
        globalThis.requestAnimationFrame = callback =>
            setTimeout(() => callback(performance.now()), 5) as unknown as number;
        globalThis.cancelAnimationFrame = id => clearTimeout(id);
        const sampler = new QaapWorkHubFpsSampler();
        try {
            sampler.start();
            await new Promise<void>(resolve => {
                setTimeout(() => {
                    const sample = sampler.stop();
                    expect(sample.frameCount).to.be.greaterThan(0);
                    expect(sample.medianFps).to.be.greaterThan(0);
                    expect(sample.durationMs).to.be.greaterThan(0);
                    sampler.dispose();
                    resolve();
                }, 40);
            });
        } finally {
            globalThis.requestAnimationFrame = originalRaf;
            globalThis.cancelAnimationFrame = originalCancel;
        }
    });
});
