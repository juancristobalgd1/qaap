// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import {
    QAAP_USER_REPOS_SEGMENT,
    resolveQaapReposRoot,
    resolveQaapTenantUserRoot,
    safeUserIdSegment,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapBillingStore } from './qaap-billing-store';

const GIB = 1024 ** 3;
/** A measurement is reused this long; `du` over a large checkout is not free. */
export const QAAP_TENANT_STORAGE_MEASURE_TTL_MS = 10 * 60 * 1000;
const MEASURE_TIMEOUT_MS = 60 * 1000;

/**
 * Enforces the plan's `storageGb` per owner. The owner's storage is the bytes under their repositories
 * directory and their tenant data root, measured with `du -sk` in a child process (never blocking the
 * event loop) and cached for {@link QAAP_TENANT_STORAGE_MEASURE_TTL_MS}. Every failure to measure or to
 * read the plan fails open: a broken probe must not stop the owner from working.
 */
@injectable()
export class QaapTenantStorageQuotaService {

    @inject(QaapBillingStore) @optional()
    protected readonly billing: QaapBillingStore | undefined;

    protected readonly measurements = new Map<string, { readonly bytes: number | undefined; readonly at: number }>();
    protected readonly pending = new Map<string, Promise<number | undefined>>();

    /** Async verdict: measures when the cached size is stale. `false` when the plan or the size is unknown. */
    async isOverStorageLimit(ownerLogin: string): Promise<boolean> {
        const key = this.keyOf(ownerLogin);
        if (!key || !this.billing) {
            return false;
        }
        let storageGb: number;
        try {
            storageGb = (await this.billing.getEntitlements(key)).storageGb;
        } catch {
            return false;
        }
        const bytes = await this.usageBytes(key);
        return bytes !== undefined && bytes > storageGb * GIB;
    }

    /**
     * Sync verdict for hot paths (agent turn start): answers from the cached measurement and starts a
     * background measurement when it is missing or stale. Until the first measurement it answers `false`.
     */
    peekOverStorageLimit(ownerLogin: string | undefined): boolean {
        const key = this.keyOf(ownerLogin);
        if (!key) {
            return false;
        }
        const measured = this.measurements.get(key);
        if (!measured || Date.now() - measured.at >= QAAP_TENANT_STORAGE_MEASURE_TTL_MS) {
            void this.usageBytes(key).catch(() => undefined);
        }
        const storageGb = this.billing?.peekEntitlements(key)?.storageGb;
        return storageGb !== undefined && measured?.bytes !== undefined && measured.bytes > storageGb * GIB;
    }

    /** Bytes the owner uses, from the cache while fresh; `undefined` when the measurement failed. */
    async usageBytes(ownerLogin: string): Promise<number | undefined> {
        const key = this.keyOf(ownerLogin);
        if (!key) {
            return undefined;
        }
        const cached = this.measurements.get(key);
        if (cached && Date.now() - cached.at < QAAP_TENANT_STORAGE_MEASURE_TTL_MS) {
            return cached.bytes;
        }
        let running = this.pending.get(key);
        if (!running) {
            running = this.measureOwner(key).then(bytes => {
                this.measurements.set(key, { bytes, at: Date.now() });
                return bytes;
            }).finally(() => this.pending.delete(key));
            this.pending.set(key, running);
        }
        return running;
    }

    /** The directories whose size counts against the owner's plan. */
    protected storageRootsFor(ownerLogin: string): string[] {
        return [
            path.join(resolveQaapReposRoot(), QAAP_USER_REPOS_SEGMENT, safeUserIdSegment(ownerLogin)),
            resolveQaapTenantUserRoot(ownerLogin),
        ];
    }

    /** Sum of the owner's roots; `undefined` (fail open) when any root could not be measured. */
    protected async measureOwner(ownerLogin: string): Promise<number | undefined> {
        try {
            let total = 0;
            for (const root of this.storageRootsFor(ownerLogin)) {
                total += await this.measureBytes(root);
            }
            return total;
        } catch (error) {
            console.warn(`[qaap-storage] Could not measure the storage of ${ownerLogin}; not enforcing the limit: `
                + (error instanceof Error ? error.message : String(error)));
            return undefined;
        }
    }

    /**
     * Bytes under `root` by `du -sk`, asynchronously. A missing root is empty. Partial output of a
     * `du` that met unreadable subdirectories is still used.
     */
    protected async measureBytes(root: string): Promise<number> {
        try {
            await fs.promises.access(root);
        } catch {
            return 0;
        }
        return new Promise<number>((resolve, reject) => {
            execFile('du', ['-sk', root], { timeout: MEASURE_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout) => {
                const kib = Number.parseInt(String(stdout).trim().split(/\s+/)[0] ?? '', 10);
                if (Number.isFinite(kib) && kib >= 0) {
                    resolve(kib * 1024);
                } else {
                    reject(error ?? new Error('du printed no size'));
                }
            });
        });
    }

    protected keyOf(ownerLogin: string | undefined): string | undefined {
        const key = ownerLogin?.trim().toLowerCase();
        return key ? key : undefined;
    }
}
