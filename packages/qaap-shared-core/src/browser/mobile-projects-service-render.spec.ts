// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

describe('armWorkspaceReloadWatchdog', () => {
    let disableJSDOM: (() => void) | undefined;
    let arm: (onNoReload: () => void, timeoutMs?: number) => () => void;
    let clock: sinon.SinonFakeTimers;

    before(() => {
        disableJSDOM = enableJSDOM();
        arm = require('./mobile-projects-service-render').armWorkspaceReloadWatchdog;
    });

    after(() => disableJSDOM?.());

    beforeEach(() => {
        clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => clock.restore());

    function fire(type: string): void {
        window.dispatchEvent(new window.Event(type));
    }

    it('reports a missing reload once the grace period elapses', () => {
        let fired = 0;
        arm(() => fired++, 1_000);
        clock.tick(999);
        expect(fired).to.equal(0);
        clock.tick(1);
        expect(fired).to.equal(1);
        fire('beforeunload');
        clock.tick(5_000);
        expect(fired).to.equal(1);
    });

    it('is cancelled once the page is hidden for the reload', () => {
        let fired = 0;
        arm(() => fired++, 1_000);
        fire('pagehide');
        clock.tick(5_000);
        expect(fired).to.equal(0);
    });

    it('restarts the grace period on beforeunload so a vetoed navigation still reports', () => {
        let fired = 0;
        arm(() => fired++, 1_000);
        clock.tick(800);
        fire('beforeunload');
        clock.tick(800);
        expect(fired).to.equal(0);
        clock.tick(200);
        expect(fired).to.equal(1);
    });
});
