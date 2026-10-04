// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapTenantResourceOverrides } from './qaap-tenant-resource-overrides';

describe('QaapTenantResourceOverrides (per-login tenant limits)', () => {
    const GIB = 1024 ** 3;
    const base = 4 * GIB;

    it('keeps the default for users without an override and when unset', () => {
        expect(QaapTenantResourceOverrides.memoryBytes('bob', base, {})).to.equal(base);
        expect(QaapTenantResourceOverrides.memoryBytes('bob', base, { QAAP_TENANT_MEMORY_LIMIT_OVERRIDES: 'alice=8g' })).to.equal(base);
        expect(QaapTenantResourceOverrides.memoryBytes(undefined, base, { QAAP_TENANT_MEMORY_LIMIT_OVERRIDES: 'alice=8g' })).to.equal(base);
        expect(QaapTenantResourceOverrides.nanoCpus('bob', 2e9, { QAAP_TENANT_CPU_LIMIT_OVERRIDES: 'alice=4' })).to.equal(2e9);
    });

    it('raises a login case-insensitively, in bytes or with a unit', () => {
        const env = { QAAP_TENANT_MEMORY_LIMIT_OVERRIDES: ' Alice = 8g , bob=6442450944', QAAP_TENANT_CPU_LIMIT_OVERRIDES: 'alice=3.5' };
        expect(QaapTenantResourceOverrides.memoryBytes('alice', base, env)).to.equal(8 * GIB);
        expect(QaapTenantResourceOverrides.memoryBytes('BOB', base, env)).to.equal(6 * GIB);
        expect(QaapTenantResourceOverrides.nanoCpus('alice', 2e9, env)).to.equal(3.5e9);
    });

    it('caps at the global maximum and never lowers the default', () => {
        expect(QaapTenantResourceOverrides.memoryBytes('alice', base, { QAAP_TENANT_MEMORY_LIMIT_OVERRIDES: 'alice=64g' })).to.equal(16 * GIB);
        expect(QaapTenantResourceOverrides.memoryBytes('alice', base,
            { QAAP_TENANT_MEMORY_LIMIT_OVERRIDES: 'alice=64g', QAAP_TENANT_MEMORY_LIMIT_MAX: '10g' })).to.equal(10 * GIB);
        expect(QaapTenantResourceOverrides.memoryBytes('alice', base, { QAAP_TENANT_MEMORY_LIMIT_OVERRIDES: 'alice=1g' })).to.equal(base);
        expect(QaapTenantResourceOverrides.memoryBytes('alice', base, { QAAP_TENANT_MEMORY_LIMIT_OVERRIDES: 'alice=lots' })).to.equal(base);
        expect(QaapTenantResourceOverrides.nanoCpus('alice', 2e9, { QAAP_TENANT_CPU_LIMIT_OVERRIDES: 'alice=64' })).to.equal(8e9);
        expect(QaapTenantResourceOverrides.nanoCpus('alice', 2e9, { QAAP_TENANT_CPU_LIMIT_OVERRIDES: 'alice=-1' })).to.equal(2e9);
        expect(QaapTenantResourceOverrides.pidsLimit('alice', 256, { QAAP_TENANT_PIDS_LIMIT_OVERRIDES: 'alice=1024' })).to.equal(1024);
        expect(QaapTenantResourceOverrides.pidsLimit('alice', 256, { QAAP_TENANT_PIDS_LIMIT_OVERRIDES: 'alice=100000' })).to.equal(4096);
        expect(QaapTenantResourceOverrides.pidsLimit('alice', 256, { QAAP_TENANT_PIDS_LIMIT_OVERRIDES: 'alice=64' })).to.equal(256);
        expect(QaapTenantResourceOverrides.pidsLimit('bob', 256, { QAAP_TENANT_PIDS_LIMIT_OVERRIDES: 'alice=1024' })).to.equal(256);
    });
});
