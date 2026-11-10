// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0

import { expect } from 'chai';
import * as sinon from 'sinon';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { showAgentCliUpdateToast } from './qaap-agent-cli-update-toast';

describe('CLI update notice dismissal', () => {
    let disableJSDOM: (() => void) | undefined;
    before(() => { disableJSDOM = enableJSDOM(); });
    after(() => { disableJSDOM?.(); });
    afterEach(() => sinon.restore());

    it('schedules dismissal and pauses it while the user interacts or an update runs', () => {
        const schedule = sinon.stub(window, 'setTimeout').returns(1 as unknown as ReturnType<typeof window.setTimeout>);
        const clear = sinon.stub(window, 'clearTimeout');
        const dismissed = sinon.spy();
        const toast = showAgentCliUpdateToast({ id: 'codex', label: 'Codex', bin: 'codex', latestVersion: '1.0.0', updateAvailable: true, updateSupported: true }, {
            onCancel: () => undefined, onUpdate: () => undefined, onDismiss: dismissed
        });
        try {
            expect(schedule.calledWith(sinon.match.func, 8000)).to.equal(true);
            toast.root.dispatchEvent(new window.Event('pointerenter'));
            expect(clear.calledWith(1)).to.equal(true);
            const count = schedule.callCount;
            toast.setUpdating(true);
            toast.root.dispatchEvent(new window.Event('pointerleave'));
            expect(schedule.callCount).to.equal(count);
            expect(dismissed.called).to.equal(false);
        } finally {
            toast.dispose();
        }
    });

    it('mounts a single notice even when called again, and groups pending updates in the title', () => {
        const info = { id: 'codex', label: 'Codex', bin: 'codex', latestVersion: '1.0.0', updateAvailable: true, updateSupported: true };
        const handlers = { onCancel: () => undefined, onUpdate: () => undefined, onDismiss: () => undefined };
        const first = showAgentCliUpdateToast(info, handlers);
        const second = showAgentCliUpdateToast(info, handlers, { pendingCount: 3 });
        try {
            expect(document.querySelectorAll('.qaap-agent-cli-update-toast')).to.have.length(1);
            expect(second.root.querySelector('.qaap-agent-cli-update-toast-title')?.textContent).to.equal('3 CLI updates available');
        } finally {
            first.dispose();
            second.dispose();
        }
    });

    it('labels the non-destructive action Later and keeps it separate from Update', () => {
        const toast = showAgentCliUpdateToast({ id: 'codex', label: 'Codex', bin: 'codex', latestVersion: '1.0.0', updateAvailable: true, updateSupported: true }, {
            onCancel: () => undefined, onUpdate: () => undefined, onDismiss: () => undefined,
        });
        try {
            const labels = Array.from(toast.root.querySelectorAll<HTMLButtonElement>('.qaap-agent-cli-update-toast-action')).map(button => button.textContent);
            expect(labels).to.deep.equal(['Later', 'Update']);
        } finally {
            toast.dispose();
        }
    });

    it('dispatches the Update button to the update handler', () => {
        const onUpdate = sinon.spy();
        const toast = showAgentCliUpdateToast({ id: 'codex', label: 'Codex', bin: 'codex', latestVersion: '1.0.0', updateAvailable: true, updateSupported: true }, {
            onCancel: () => undefined, onUpdate, onDismiss: () => undefined,
        });
        try {
            toast.root.querySelector<HTMLButtonElement>('.qaap-agent-cli-update-toast-action.qaap-mod-primary')?.click();
            expect(onUpdate.calledOnce).to.equal(true);
        } finally {
            toast.dispose();
        }
    });
});
