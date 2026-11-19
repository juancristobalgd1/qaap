// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import type { QaapAgentCliUpdateInfo, QaapAgentCliUpdateResult } from '../common/qaap-agent-cli-update';
import { QaapAgentCliUpdateTracker, QAAP_AGENT_CLI_UPDATE_SUCCESS_VISIBLE_MS } from './qaap-agent-cli-update-tracker';

class TrackerProbe extends QaapAgentCliUpdateTracker {
    readonly requests: string[] = [];
    outcome: () => Promise<QaapAgentCliUpdateResult> = () => Promise.resolve({ ok: true, id: 'codex', installedVersion: '1.1.0' });

    protected override requestUpdate(agentId: string): Promise<QaapAgentCliUpdateResult> {
        this.requests.push(agentId);
        return this.outcome();
    }
}

const codex: QaapAgentCliUpdateInfo = {
    id: 'codex', label: 'Codex', bin: 'codex', latestVersion: '1.1.0', updateAvailable: true, updateSupported: true,
};

describe('QaapAgentCliUpdateTracker', () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
        clock = sinon.useFakeTimers();
    });

    afterEach(() => {
        clock.restore();
    });

    it('is single-flight: a second start for a running harness joins the same request', async () => {
        const tracker = new TrackerProbe();
        let release: (result: QaapAgentCliUpdateResult) => void = () => undefined;
        tracker.outcome = () => new Promise(resolve => { release = resolve; });

        const first = tracker.start(codex);
        const second = tracker.start(codex);
        expect(tracker.isUpdating('codex')).to.equal(true);
        release({ ok: true, id: 'codex', installedVersion: '1.1.0' });
        const [a, b] = await Promise.all([first, second]);

        expect(tracker.requests).to.deep.equal(['codex']);
        expect(a.status).to.equal('succeeded');
        expect(b).to.equal(a);
    });

    it('marks success, then removes the chip on its own after the visible window', async () => {
        const tracker = new TrackerProbe();
        let changes = 0;
        tracker.onDidChange(() => { changes++; });

        await tracker.start(codex);

        expect(tracker.getJob('codex')?.status).to.equal('succeeded');
        expect(tracker.getJob('codex')?.installedVersion).to.equal('1.1.0');
        clock.tick(QAAP_AGENT_CLI_UPDATE_SUCCESS_VISIBLE_MS - 1);
        expect(tracker.getJob('codex')).to.not.equal(undefined);
        clock.tick(1);
        expect(tracker.getJob('codex')).to.equal(undefined);
        expect(changes).to.be.greaterThan(2);
    });

    it('keeps a failure until the user dismisses it, and Retry starts a fresh run', async () => {
        const tracker = new TrackerProbe();
        tracker.outcome = () => Promise.resolve({ ok: false, id: 'codex', message: 'EACCES: permission denied' });

        const failed = await tracker.start(codex);
        clock.tick(60_000);

        expect(failed.status).to.equal('failed');
        expect(failed.detail).to.equal('EACCES: permission denied');
        expect(tracker.getJob('codex')?.status).to.equal('failed');

        tracker.outcome = () => Promise.resolve({ ok: true, id: 'codex', installedVersion: '1.1.0' });
        const retried = await tracker.start(codex);

        expect(tracker.requests).to.deep.equal(['codex', 'codex']);
        expect(retried.status).to.equal('succeeded');
    });

    it('does not show raw npm output as the failure detail', async () => {
        const tracker = new TrackerProbe();
        tracker.outcome = () => Promise.resolve({ ok: false, id: 'codex', message: 'npm error code ENOENT\nnpm error syscall mkdir' });

        const failed = await tracker.start(codex);

        expect(failed.status).to.equal('failed');
        expect(failed.detail).to.equal(undefined);
    });

    it('turns a thrown transport error into a failed job instead of leaving it updating', async () => {
        const tracker = new TrackerProbe();
        tracker.outcome = () => Promise.reject(new Error('network down'));

        const failed = await tracker.start(codex);

        expect(failed.status).to.equal('failed');
        expect(tracker.isUpdating('codex')).to.equal(false);
    });

    it('cannot dismiss a running update, but can dismiss a finished one', async () => {
        const tracker = new TrackerProbe();
        let release: (result: QaapAgentCliUpdateResult) => void = () => undefined;
        tracker.outcome = () => new Promise(resolve => { release = resolve; });

        const running = tracker.start(codex);
        tracker.dismiss('codex');
        expect(tracker.getJob('codex')?.status).to.equal('updating');

        release({ ok: false, id: 'codex', message: 'busy' });
        await running;
        tracker.dismiss('codex');
        expect(tracker.getJob('codex')).to.equal(undefined);
    });
});
