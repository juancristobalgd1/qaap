// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as path from 'path';
import { QaapTenantStorageQuotaService } from './qaap-tenant-storage-quota-service';

const GIB = 1024 ** 3;

/** Replaces the `du` probe with sizes per root, and counts the probes. */
class SizedStorageQuota extends QaapTenantStorageQuotaService {
    probes = 0;
    failProbe = false;

    constructor(protected readonly sizeOf: (root: string) => number) {
        super();
    }

    protected override async measureBytes(root: string): Promise<number> {
        this.probes++;
        if (this.failProbe) {
            throw new Error('du failed');
        }
        return this.sizeOf(root);
    }
}

function billingWith(storageGb: number, options: { readonly throws?: boolean } = {}): unknown {
    return {
        getEntitlements: async () => {
            if (options.throws) {
                throw new Error('store unreadable');
            }
            return { storageGb };
        },
        peekEntitlements: () => ({ storageGb }),
    };
}

describe('QaapTenantStorageQuotaService', () => {
    let previousRepos: string | undefined;
    let previousConfig: string | undefined;

    beforeEach(() => {
        previousRepos = process.env.QAAP_REPOS_ROOT;
        previousConfig = process.env.QAAP_TENANT_CONFIG_ROOT;
        process.env.QAAP_REPOS_ROOT = '/srv/test-repos';
        process.env.QAAP_TENANT_CONFIG_ROOT = '/srv/test-config';
    });

    afterEach(() => {
        for (const [key, value] of [['QAAP_REPOS_ROOT', previousRepos], ['QAAP_TENANT_CONFIG_ROOT', previousConfig]] as const) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    /** Repos hold `repoGib`, the tenant config root holds `configGib`. */
    // The service resolves its roots (`D:\srv\test-repos\…` on Windows), so compare resolved paths.
    const sized = (repoGib: number, configGib = 0): SizedStorageQuota => new SizedStorageQuota(root =>
        path.resolve(root).startsWith(path.resolve('/srv/test-repos')) ? repoGib * GIB : configGib * GIB);

    it('reports over the limit when the owner uses more than the plan storage', async () => {
        const service = sized(9, 2);
        (service as any).billing = billingWith(10);
        expect(await service.isOverStorageLimit('Alice')).to.equal(true);
    });

    it('allows the owner who is within the plan storage', async () => {
        const service = sized(9);
        (service as any).billing = billingWith(10);
        expect(await service.isOverStorageLimit('alice')).to.equal(false);
    });

    it('fails open when the size cannot be measured', async () => {
        const service = sized(50);
        service.failProbe = true;
        (service as any).billing = billingWith(10);
        expect(await service.isOverStorageLimit('alice')).to.equal(false);
    });

    it('fails open when the plan cannot be read', async () => {
        const service = sized(50);
        (service as any).billing = billingWith(10, { throws: true });
        expect(await service.isOverStorageLimit('alice')).to.equal(false);
        expect(service.probes).to.equal(0);
    });

    it('reuses a fresh measurement instead of probing again', async () => {
        const service = sized(11);
        (service as any).billing = billingWith(10);
        await service.isOverStorageLimit('alice');
        const probesAfterFirst = service.probes;
        await service.isOverStorageLimit('alice');
        expect(service.probes).to.equal(probesAfterFirst);
    });

    it('answers the sync peek from the background measurement, failing open before it lands', async () => {
        const service = sized(11);
        (service as any).billing = billingWith(10);
        expect(service.peekOverStorageLimit('alice')).to.equal(false);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(service.peekOverStorageLimit('alice')).to.equal(true);
    });
});
