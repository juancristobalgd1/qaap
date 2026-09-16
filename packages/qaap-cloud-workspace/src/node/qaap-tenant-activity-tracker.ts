// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type {
    QaapTenantActivityReason,
    QaapTenantRuntimeStatus,
} from '../common/qaap-cloud-api-types';
import { canonicalQaapTenantLogin, QaapTenantRuntimeStore } from './qaap-tenant-runtime-store';

interface ActiveOperation {
    readonly tenantLogin: string;
    readonly operationId: string;
    readonly reason: QaapTenantActivityReason;
    readonly startedAt: number;
}

/** Central activity/lease tracker used by HTTP, WebSocket, agent and terminal seams. */
@injectable()
export class QaapTenantActivityTracker {

    @inject(QaapTenantRuntimeStore)
    protected readonly store: QaapTenantRuntimeStore;

    protected readonly operations = new Map<string, ActiveOperation>();
    protected operationSequence = 0;

    touch(ownerLogin: string | undefined, reason: QaapTenantActivityReason, at = Date.now()): void {
        if (!ownerLogin?.trim()) {
            return;
        }
        this.store.touch(ownerLogin, reason, at);
    }

    beginOperation(ownerLogin: string | undefined, operationId: string, reason: QaapTenantActivityReason): () => void {
        if (!ownerLogin?.trim()) {
            return () => undefined;
        }
        const tenantLogin = canonicalQaapTenantLogin(ownerLogin);
        const key = `${tenantLogin}\u0000${operationId}\u0000${this.operationSequence++}`;
        this.touch(tenantLogin, reason);
        this.operations.set(key, { tenantLogin, operationId, reason, startedAt: Date.now() });
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            this.operations.delete(key);
            this.touch(tenantLogin, reason);
        };
    }

    protect(ownerLogin: string | undefined, durationMs: number, reason: QaapTenantActivityReason = 'user'): void {
        if (!ownerLogin?.trim()) {
            return;
        }
        const tenantLogin = canonicalQaapTenantLogin(ownerLogin);
        const current = this.store.get(tenantLogin);
        const until = Date.now() + Math.max(0, durationMs);
        this.store.setState(tenantLogin, current?.state ?? 'active', {
            protectedUntil: new Date(until).toISOString(),
            lastActivityAt: new Date().toISOString(),
            lastActivityReason: reason,
        });
    }

    isProtected(ownerLogin: string, now = Date.now()): boolean {
        const tenantLogin = canonicalQaapTenantLogin(ownerLogin);
        for (const operation of this.operations.values()) {
            if (operation.tenantLogin === tenantLogin) {
                return true;
            }
        }
        const protectedUntil = this.store.get(tenantLogin)?.protectedUntil;
        return !!protectedUntil && Date.parse(protectedUntil) > now;
    }

    activeOperationCount(ownerLogin: string): number {
        const tenantLogin = canonicalQaapTenantLogin(ownerLogin);
        return [...this.operations.values()].filter(operation => operation.tenantLogin === tenantLogin).length;
    }

    status(ownerLogin: string): QaapTenantRuntimeStatus | undefined {
        return this.store.get(canonicalQaapTenantLogin(ownerLogin));
    }
}
