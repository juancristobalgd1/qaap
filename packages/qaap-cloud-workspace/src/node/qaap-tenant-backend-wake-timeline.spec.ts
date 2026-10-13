// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapTenantBackendWakeTimeline } from './qaap-tenant-backend-wake-timeline';
import { QaapTenantRuntimeMetrics } from './qaap-tenant-runtime-metrics';

describe('QaapTenantBackendWakeTimeline', () => {

    function clock(...times: number[]): () => number {
        let index = 0;
        return () => times[Math.min(index++, times.length - 1)];
    }

    it('records the time between consecutive marks as phase durations', () => {
        const timeline = new QaapTenantBackendWakeTimeline(clock(1_000, 1_040, 1_940, 2_240, 6_440, 6_440));
        timeline.action = 'started';
        timeline.mark('prepare');
        timeline.mark('container');
        timeline.mark('relay');
        timeline.mark('ready');
        const sample = timeline.sample(5_440.4, true);
        expect(sample).to.deep.include({ totalMs: 5_440, ok: true, action: 'started' });
        expect(sample.phases).to.deep.equal({ prepare: 40, container: 900, relay: 300, ready: 4_200 });
    });

    it('formats one compact log line per wake', () => {
        const timeline = new QaapTenantBackendWakeTimeline(clock(0, 10, 20, 20));
        timeline.action = 'created';
        timeline.mark('prepare');
        timeline.mark('container');
        expect(QaapTenantBackendWakeTimeline.formatLogLine('alice', timeline.sample(25, true)))
            .to.equal('[qaap-tenant] backend wake alice 25ms action=created prepare=10ms container=10ms');
        expect(QaapTenantBackendWakeTimeline.formatLogLine('alice', timeline.sample(30_000, false), new Error('not ready')))
            .to.equal('[qaap-tenant] backend wake failed alice 30000ms action=created prepare=10ms container=10ms error="not ready"');
    });
});

describe('QaapTenantRuntimeMetrics backend wakes', () => {

    function wake(totalMs: number, ok = true): Parameters<QaapTenantRuntimeMetrics['recordBackendWake']>[0] {
        return { at: '2026-10-13T00:00:00.000Z', totalMs, ok, phases: { ready: totalMs } };
    }

    it('reports no percentiles before the first wake', () => {
        expect(new QaapTenantRuntimeMetrics().snapshot().backendWake).to.deep.equal({ count: 0, failures: 0, window: 0 });
    });

    it('reports nearest-rank p50/p95/max over successful wakes and the latest sample', () => {
        const metrics = new QaapTenantRuntimeMetrics();
        for (let ms = 100; ms <= 2_000; ms += 100) {
            metrics.recordBackendWake(wake(ms));
        }
        metrics.recordBackendWake(wake(30_000, false));
        const snapshot = metrics.snapshot().backendWake;
        expect(snapshot).to.deep.include({ count: 21, failures: 1, window: 20, p50Ms: 1_000, p95Ms: 1_900, maxMs: 2_000 });
        expect(snapshot.last).to.deep.include({ totalMs: 30_000, ok: false });
    });

    it('keeps only the most recent wakes in the percentile window', () => {
        const metrics = new QaapTenantRuntimeMetrics();
        metrics.recordBackendWake(wake(60_000));
        for (let i = 0; i < 100; i++) {
            metrics.recordBackendWake(wake(1_000));
        }
        expect(metrics.snapshot().backendWake).to.deep.include({ count: 101, window: 100, maxMs: 1_000 });
    });
});
