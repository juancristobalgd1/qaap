// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
// The notice module touches the DOM while loading.
const disableImportJSDOM = enableJSDOM();
import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { QaapTenantUpdateNotice } from './qaap-tenant-update-notice';
import type { QaapTenantUpdateState } from './qaap-tenant-update-service';
disableImportJSDOM();

const DISMISSED_KEY = 'qaap.tenantUpdate.dismissed';

/** Minimal service double: the notice only reads state, subscribes, and forwards clicks. */
class ServiceDouble {
    readonly emitter = new Emitter<QaapTenantUpdateState>();
    readonly onDidChangeState = this.emitter.event;
    state: QaapTenantUpdateState = { status: undefined, phase: 'idle' };
    updateCalls = 0;
    started = 0;
    stopped = 0;

    getState(): QaapTenantUpdateState {
        return this.state;
    }

    start(): void {
        this.started += 1;
    }

    stop(): void {
        this.stopped += 1;
    }

    async updateNow(): Promise<void> {
        this.updateCalls += 1;
    }

    publish(state: QaapTenantUpdateState): void {
        this.state = state;
        this.emitter.fire(state);
    }
}

describe('QaapTenantUpdateNotice', () => {
    useSuiteJSDOM();

    let service: ServiceDouble;
    let notice: QaapTenantUpdateNotice;

    function root(): HTMLElement {
        const element = document.querySelector<HTMLElement>('.qaap-tenant-update-notice');
        if (!element) {
            throw new Error('the notice is not mounted');
        }
        return element;
    }

    beforeEach(() => {
        sessionStorage.removeItem(DISMISSED_KEY);
        service = new ServiceDouble();
        notice = new QaapTenantUpdateNotice();
        (notice as unknown as { service: unknown }).service = service;
        notice.onStart();
    });

    afterEach(() => {
        notice.onStop();
        sessionStorage.removeItem(DISMISSED_KEY);
    });

    it('stays hidden while no update is pending', () => {
        service.publish({ status: { updateAvailable: false, runningTasks: 0 }, phase: 'idle' });
        expect(root().hidden).to.equal(true);
        expect(service.started).to.equal(1);
    });

    it('announces the pending version with an "Update now" action', () => {
        service.publish({ status: { updateAvailable: true, runningTasks: 0 }, phase: 'idle' });
        expect(root().hidden).to.equal(false);
        expect(root().getAttribute('role')).to.equal('status');
        expect(root().querySelector('p')?.textContent).to.equal('A new version of Qaap is ready.');
        const action = root().querySelector<HTMLButtonElement>('.qaap-tenant-update-notice-action');
        expect(action?.textContent).to.equal('Update now');
        action?.click();
        expect(service.updateCalls).to.equal(1);
    });

    it('shows progress and disables the action while updating', () => {
        service.publish({ status: { updateAvailable: true, runningTasks: 0 }, phase: 'updating' });
        const action = root().querySelector<HTMLButtonElement>('.qaap-tenant-update-notice-action');
        expect(action?.disabled).to.equal(true);
        expect(action?.textContent).to.equal('Updating…');
    });

    it('offers a retry after a failed update', () => {
        service.publish({ status: { updateAvailable: true, runningTasks: 0 }, phase: 'failed' });
        const action = root().querySelector<HTMLButtonElement>('.qaap-tenant-update-notice-action');
        expect(action?.textContent).to.equal('Try again');
        expect(action?.disabled).to.equal(false);
    });

    it('hides for the rest of the tab session when dismissed, and returns once no update is pending', () => {
        service.publish({ status: { updateAvailable: true, runningTasks: 0 }, phase: 'idle' });
        root().querySelector<HTMLButtonElement>('.qaap-tenant-update-notice-dismiss')?.click();
        expect(root().hidden).to.equal(true);
        expect(sessionStorage.getItem(DISMISSED_KEY)).to.equal('1');

        service.publish({ status: { updateAvailable: true, runningTasks: 0 }, phase: 'idle' });
        expect(root().hidden).to.equal(true);

        service.publish({ status: { updateAvailable: false, runningTasks: 0 }, phase: 'idle' });
        expect(sessionStorage.getItem(DISMISSED_KEY)).to.equal(null);
        service.publish({ status: { updateAvailable: true, runningTasks: 0 }, phase: 'idle' });
        expect(root().hidden).to.equal(false);
    });

    it('removes itself and stops the service on stop', () => {
        notice.onStop();
        expect(document.querySelector('.qaap-tenant-update-notice')).to.equal(null);
        expect(service.stopped).to.equal(1);
    });
});
