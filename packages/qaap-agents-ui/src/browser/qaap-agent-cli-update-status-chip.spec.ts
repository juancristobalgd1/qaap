// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentCliUpdateInfo, QaapAgentCliUpdateResult } from '../common/qaap-agent-cli-update';
import type { QaapAgentCliUpdateTracker as Tracker } from './qaap-agent-cli-update-tracker';
import type { QaapAgentCliUpdateStatusChip as Chip } from './qaap-agent-cli-update-status-chip';

const codex: QaapAgentCliUpdateInfo = {
    id: 'codex', label: 'Codex', bin: 'codex', latestVersion: '1.1.0', updateAvailable: true, updateSupported: true,
};

function flush(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

describe('QaapAgentCliUpdateStatusChip', () => {
    let disableJSDOM: (() => void) | undefined;
    let trackerModule: typeof import('./qaap-agent-cli-update-tracker');
    let chipModule: typeof import('./qaap-agent-cli-update-status-chip');
    let chip: Chip | undefined;
    let tracker: Tracker | undefined;
    let requests: string[];
    let outcome: () => Promise<QaapAgentCliUpdateResult>;

    before(() => {
        disableJSDOM = enableJSDOM();
        trackerModule = require('./qaap-agent-cli-update-tracker');
        chipModule = require('./qaap-agent-cli-update-status-chip');
    });

    after(() => disableJSDOM?.());

    beforeEach(() => {
        requests = [];
        outcome = () => new Promise(() => undefined);
        class Probe extends trackerModule.QaapAgentCliUpdateTracker {
            protected override requestUpdate(agentId: string): Promise<QaapAgentCliUpdateResult> {
                requests.push(agentId);
                return outcome();
            }
        }
        tracker = new Probe();
        chip = new chipModule.QaapAgentCliUpdateStatusChip();
        Object.assign(chip, { tracker });
        chip.onStart();
    });

    afterEach(() => {
        chip?.onStop();
        tracker?.dispose();
        chip = undefined;
        tracker = undefined;
    });

    function stack(): HTMLElement {
        return document.querySelector<HTMLElement>('.qaap-agent-cli-update-status-stack')!;
    }

    it('shows a compact live chip while a harness updates, and hides the stack when idle', () => {
        expect(stack().hidden).to.equal(true);

        void tracker!.start(codex);

        expect(stack().hidden).to.equal(false);
        expect(stack().getAttribute('aria-live')).to.equal('polite');
        const label = stack().querySelector('.qaap-agent-cli-update-status-label')!.textContent;
        expect(label).to.equal('Updating Codex…');
        expect(stack().querySelector('.qaap-agent-cli-update-status-action')).to.equal(null);
    });

    it('shows the version on success and a Retry action on failure that restarts the update', async () => {
        outcome = () => Promise.resolve({ ok: true, id: 'codex', installedVersion: '1.1.0' });
        await tracker!.start(codex);
        await flush();
        expect(stack().querySelector('.qaap-agent-cli-update-status-label')!.textContent).to.equal('Codex updated to 1.1.0');

        outcome = () => Promise.resolve({ ok: false, id: 'codex', message: 'EACCES: permission denied' });
        await tracker!.start(codex);
        await flush();
        const failedLabel = stack().querySelector('.qaap-agent-cli-update-status-label')!.textContent;
        expect(failedLabel).to.equal('Codex update failed');
        const retry = stack().querySelector<HTMLButtonElement>('.qaap-agent-cli-update-status-action')!;
        expect(retry.textContent).to.equal('Retry');
        expect(stack().querySelector('.qaap-agent-cli-update-status-error')!.textContent).to.equal('EACCES: permission denied');

        outcome = () => new Promise(() => undefined);
        retry.click();
        await flush();

        expect(requests).to.deep.equal(['codex', 'codex', 'codex']);
        expect(stack().querySelector('.qaap-agent-cli-update-status-label')!.textContent).to.equal('Updating Codex…');
    });

    it('opens the details on click and keeps the failed chip until its close button is used', async () => {
        outcome = () => Promise.resolve({ ok: false, id: 'codex', message: 'EACCES: permission denied' });
        await tracker!.start(codex);
        await flush();

        const toggle = stack().querySelector<HTMLButtonElement>('.qaap-agent-cli-update-status-toggle')!;
        toggle.click();
        expect(toggle.getAttribute('aria-expanded')).to.equal('true');
        expect(stack().querySelector('.qaap-agent-cli-update-status')!.classList.contains('qaap-mod-open')).to.equal(true);

        const close = stack().querySelector<HTMLButtonElement>('.qaap-agent-cli-update-status-close')!;
        close.click();
        expect(tracker!.getJob('codex')).to.equal(undefined);
        expect(stack().hidden).to.equal(true);
    });
});
