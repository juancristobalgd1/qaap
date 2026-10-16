// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { parseHarnessLastTurn, resolveHarnessCardAction, resolveHarnessCardStatus, resolveHarnessLastTurnAge } from './qaap-harness-configuration-state';

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

describe('Qaap harness last turn', () => {
    it('keeps ok and known failure kinds; unknown kinds read as a generic failure', () => {
        expect(parseHarnessLastTurn({ outcome: 'ok', at: 5, taskId: 't' })).to.deep.equal({ outcome: 'ok', at: 5 });
        expect(parseHarnessLastTurn({ outcome: 'failed', kind: 'auth', at: 5 })).to.deep.equal({ outcome: 'failed', kind: 'auth', at: 5 });
        expect(parseHarnessLastTurn({ outcome: 'failed', kind: 'brand_new_kind', at: 5 })?.kind).to.equal('exit_code');
        expect(parseHarnessLastTurn({ outcome: 'failed', at: 5 })?.kind).to.equal('exit_code');
    });

    it('treats a missing or malformed field as no last turn', () => {
        for (const value of [undefined, JSON.parse('null'), {}, { outcome: 'ok' }, { outcome: 'maybe', at: 1 }, { outcome: 'ok', at: Number.NaN }]) {
            expect(parseHarnessLastTurn(value), JSON.stringify(value)).to.equal(undefined);
        }
    });

    it('rounds the age down to now, minutes, hours or days', () => {
        const now = 10 * 24 * 3_600_000;
        expect(resolveHarnessLastTurnAge(now - 30_000, now)).to.deep.equal({ unit: 'now', value: 0 });
        expect(resolveHarnessLastTurnAge(now + 60_000, now)).to.deep.equal({ unit: 'now', value: 0 });
        expect(resolveHarnessLastTurnAge(now - 5 * 60_000, now)).to.deep.equal({ unit: 'minutes', value: 5 });
        expect(resolveHarnessLastTurnAge(now - 3 * 3_600_000, now)).to.deep.equal({ unit: 'hours', value: 3 });
        expect(resolveHarnessLastTurnAge(now - 2 * 24 * 3_600_000, now)).to.deep.equal({ unit: 'days', value: 2 });
    });
});
