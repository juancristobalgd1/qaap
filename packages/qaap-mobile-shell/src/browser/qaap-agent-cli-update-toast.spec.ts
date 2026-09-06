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
});
