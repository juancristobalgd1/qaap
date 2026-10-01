// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapTenantBusyProbe } from './qaap-tenant-busy-probe';

describe('Qaap tenant busy probe', () => {
    const secret = 'x'.repeat(48);
    const now = 1_700_000_000_000;

    it('verifies a probe for the same tenant and secret', () => {
        const probe = QaapTenantBusyProbe.create('Alice', secret, now);
        expect(QaapTenantBusyProbe.verify(probe, secret, 'alice', now + 1_000)).to.equal(true);
    });

    it('rejects another tenant, another secret, tampering and stale probes', () => {
        const probe = QaapTenantBusyProbe.create('alice', secret, now);
        expect(QaapTenantBusyProbe.verify(probe, secret, 'bob', now)).to.equal(false);
        expect(QaapTenantBusyProbe.verify(probe, 'y'.repeat(48), 'alice', now)).to.equal(false);
        expect(QaapTenantBusyProbe.verify(`${now + 1}${probe.slice(String(now).length)}`, secret, 'alice', now)).to.equal(false);
        expect(QaapTenantBusyProbe.verify(probe, secret, 'alice', now + 120_000)).to.equal(false);
        expect(QaapTenantBusyProbe.verify(undefined, secret, 'alice', now)).to.equal(false);
        expect(QaapTenantBusyProbe.verify('garbage', secret, 'alice', now)).to.equal(false);
    });

    it('refuses short secrets', () => {
        expect(() => QaapTenantBusyProbe.create('alice', 'short')).to.throw();
        expect(QaapTenantBusyProbe.verify('1.abc', 'short', 'alice')).to.equal(false);
    });

    it('parses only well-formed busy status payloads', () => {
        expect(QaapTenantBusyProbe.parseStatus({ busy: true, runningTasks: 2 })).to.deep.equal({ busy: true, runningTasks: 2, draining: false });
        expect(QaapTenantBusyProbe.parseStatus({ busy: 'yes' })).to.equal(undefined);
        expect(QaapTenantBusyProbe.parseStatus(undefined)).to.equal(undefined);
    });
});
