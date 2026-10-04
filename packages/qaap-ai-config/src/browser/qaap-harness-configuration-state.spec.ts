// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveHarnessCardAction, resolveHarnessCardStatus } from './qaap-harness-configuration-state';

describe('Qaap harness configuration card action', () => {
    it('hides install on servers that disallow it and keeps it available in local/dev', () => {
        expect(resolveHarnessCardAction(false, 'ready', false)).to.equal('install-unavailable');
        expect(resolveHarnessCardAction(false, 'ready', true)).to.equal('install');
    });

    it('distinguishes harnesses without an installable package from servers that disable installs', () => {
        expect(resolveHarnessCardAction(false, 'ready', false, false)).to.equal('install-no-package');
        expect(resolveHarnessCardAction(false, 'ready', false, true)).to.equal('install-unavailable');
        expect(resolveHarnessCardAction(true, 'ready', false, false)).to.equal('toggle');
    });

    it('shows the harness toggle when installed and waits for status before offering install', () => {
        expect(resolveHarnessCardAction(true, 'ready', false)).to.equal('toggle');
        expect(resolveHarnessCardAction(false, 'loading', true)).to.equal('loading');
        expect(resolveHarnessCardAction(false, 'unavailable', true)).to.equal('availability-unknown');
    });

    it('keeps installed disconnected harnesses toggleable and labels them as installed', () => {
        expect(resolveHarnessCardAction(true, 'ready', true)).to.equal('toggle');
        expect(resolveHarnessCardStatus(true, 'ready', 'disconnected')).to.equal('installed-disconnected');
    });

    it('keeps disabled installed harnesses listed and never offers install for them', () => {
        const installed = true;
        const enabled = false;
        expect(enabled).to.equal(false);
        expect(resolveHarnessCardAction(installed, 'ready', true)).to.equal('toggle');
        expect(resolveHarnessCardStatus(installed, 'ready', 'connected')).to.equal('available');
    });
});
