// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    QaapTenantUidRegistry,
    QAAP_TENANT_UID_BASE,
    QAAP_TENANT_UID_MAX,
    QAAP_RESERVED_TENANT_UIDS,
    resolveDefaultTenantUidRegistryPath,
} from './qaap-tenant-uid-registry';

describe('QaapTenantUidRegistry', () => {
    let dir: string;
    let registryPath: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-uid-'));
        registryPath = path.join(dir, 'uid-registry.json');
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('assigns stable uids: same login → same uid across calls', () => {
        const reg = new QaapTenantUidRegistry(registryPath);
        const first = reg.resolve('alice');
        const second = reg.resolve('alice');
        expect(second).to.deep.equal(first);
        expect(first.uid).to.be.at.least(QAAP_TENANT_UID_BASE);
    });

    it('mirrors gid onto uid (private per-tenant group)', () => {
        const reg = new QaapTenantUidRegistry(registryPath);
        const id = reg.resolve('alice');
        expect(id.gid).to.equal(id.uid);
    });

    it('never collides: N distinct logins → N distinct uids', () => {
        const reg = new QaapTenantUidRegistry(registryPath);
        const logins = ['alice', 'bob', 'carol', 'dave', 'erin'];
        const uids = logins.map(l => reg.resolve(l).uid);
        expect(new Set(uids).size).to.equal(logins.length);
    });

    it('persists assignments across a fresh instance (reload)', () => {
        const aliceUid = new QaapTenantUidRegistry(registryPath).resolve('alice').uid;
        const bobUid = new QaapTenantUidRegistry(registryPath).resolve('bob').uid;
        // A reloaded registry must return the SAME uid for alice and a NEW one for bob.
        const reloaded = new QaapTenantUidRegistry(registryPath);
        expect(reloaded.resolve('alice').uid).to.equal(aliceUid);
        expect(reloaded.resolve('bob').uid).to.equal(bobUid);
        expect(bobUid).to.not.equal(aliceUid);
    });

    it('keys by the path segment so two logins that sanitize alike share the uid (uid ⇔ tree)', () => {
        const reg = new QaapTenantUidRegistry(registryPath);
        // safeUserIdSegment replaces unsafe chars with '_', so both of these map to segment 'a_b' —
        // the SAME on-disk tree, hence they must share the uid or the uid and the tree would drift.
        const a = reg.resolve('a@b');
        const b = reg.resolve('a_b');
        expect(b.uid).to.equal(a.uid);
    });

    it('returns shared reserved uids for buckets without consuming the tenant range', () => {
        const reg = new QaapTenantUidRegistry(registryPath);
        expect(reg.resolve('_anonymous').uid).to.equal(QAAP_RESERVED_TENANT_UIDS._anonymous);
        expect(reg.resolve('_dev').uid).to.equal(QAAP_RESERVED_TENANT_UIDS._dev);
        expect(reg.resolve(undefined).uid).to.equal(QAAP_RESERVED_TENANT_UIDS._unknown);
        expect(reg.resolve('').uid).to.equal(QAAP_RESERVED_TENANT_UIDS._unknown);
        // A real tenant still starts at the base — buckets did not advance nextUid.
        expect(reg.resolve('alice').uid).to.equal(QAAP_TENANT_UID_BASE);
        // Reserved uids sit below the tenant base so they can never collide with a real assignment.
        for (const uid of Object.values(QAAP_RESERVED_TENANT_UIDS)) {
            expect(uid).to.be.below(QAAP_TENANT_UID_BASE);
        }
    });

    it('recomputes nextUid above the highest assigned uid when the counter is missing/behind', () => {
        // Simulate a registry file whose nextUid lags the map (corruption / manual edit).
        fs.writeFileSync(registryPath, JSON.stringify({ nextUid: QAAP_TENANT_UID_BASE, map: { alice: 20005 } }));
        const reg = new QaapTenantUidRegistry(registryPath);
        expect(reg.resolve('alice').uid).to.equal(20005);
        // A new tenant must not reuse a taken uid — it goes above the highest seen.
        expect(reg.resolve('bob').uid).to.equal(20006);
    });

    it('fails closed when the tenant uid range is exhausted', () => {
        fs.writeFileSync(registryPath, JSON.stringify({ nextUid: QAAP_TENANT_UID_MAX, map: {} }));
        const reg = new QaapTenantUidRegistry(registryPath);
        expect(() => reg.resolve('alice')).to.throw(/range exhausted/);
    });

    it('resolveDefaultTenantUidRegistryPath sits beside reposRoot, honoring the env override', () => {
        const original = process.env.QAAP_TENANT_UID_REGISTRY_PATH;
        try {
            delete process.env.QAAP_TENANT_UID_REGISTRY_PATH;
            expect(resolveDefaultTenantUidRegistryPath('/workspace/repos')).to.equal('/workspace/.qaap/uid-registry.json');
            process.env.QAAP_TENANT_UID_REGISTRY_PATH = '/custom/registry.json';
            expect(resolveDefaultTenantUidRegistryPath('/workspace/repos')).to.equal('/custom/registry.json');
        } finally {
            if (original === undefined) {
                delete process.env.QAAP_TENANT_UID_REGISTRY_PATH;
            } else {
                process.env.QAAP_TENANT_UID_REGISTRY_PATH = original;
            }
        }
    });
});
