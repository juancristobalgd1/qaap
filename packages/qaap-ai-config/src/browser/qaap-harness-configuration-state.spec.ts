// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveHarnessCardAction } from './qaap-harness-configuration-state';

describe('Qaap harness configuration card action', () => {
    it('hides install on servers that disallow it and keeps it available in local/dev', () => {
        expect(resolveHarnessCardAction(false, 'ready', false)).to.equal('install-unavailable');
        expect(resolveHarnessCardAction(false, 'ready', true)).to.equal('install');
    });

    it('shows the harness toggle when installed and waits for availability before offering install', () => {
        expect(resolveHarnessCardAction(true, 'ready', false)).to.equal('toggle');
        expect(resolveHarnessCardAction(false, 'loading', true)).to.equal('loading');
        expect(resolveHarnessCardAction(false, 'unavailable', true)).to.equal('availability-unknown');
    });
});
