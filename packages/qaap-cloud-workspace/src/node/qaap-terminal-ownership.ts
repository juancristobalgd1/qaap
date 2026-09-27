// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { ManagedProcess } from '@theia/process/lib/common/process-manager-types';
import { TerminalProcess } from '@theia/process/lib/node';
import { isQaapHostedRuntime } from './qaap-docker-control-plane';
import { QaapTenantActivityTracker } from './qaap-tenant-activity-tracker';

/**
 * Ownership index for Theia terminal processes.
 *
 * Theia's ProcessManager is intentionally process-global. Qaap therefore keeps
 * the owner next to the numeric process id and applies an authorization check
 * at the ProcessManager seam. This protects RPC methods and the raw terminal
 * channel without changing the upstream terminal package.
 */
@injectable()
export class QaapTerminalOwnership {

    @inject(QaapTenantActivityTracker) @optional()
    protected readonly activity: QaapTenantActivityTracker | undefined;

    protected readonly ownerByProcessId = new Map<number, string>();

    bind(process: ManagedProcess, ownerLogin: string | undefined, processId = process.id): void {
        if (!(process instanceof TerminalProcess)) {
            return;
        }
        const owner = ownerLogin?.trim().toLowerCase();
        if (!owner) {
            return;
        }
        this.ownerByProcessId.set(processId, owner);
        this.activity?.touch(owner, 'terminal');
        const forget = (): void => {
            this.ownerByProcessId.delete(processId);
        };
        process.onExit(forget);
        process.onError(forget);
    }

    unbind(processId: number): void {
        this.ownerByProcessId.delete(processId);
    }

    /**
     * Local development deliberately keeps Theia's normal single-user behavior.
     * Hosted mode is fail-closed: an authenticated connection can only see a
     * terminal that was registered from that same authenticated context.
     */
    canAccess(process: ManagedProcess, ownerLogin: string | undefined): boolean {
        if (!isQaapHostedRuntime(globalThis.process.env)) {
            return true;
        }
        if (!(process instanceof TerminalProcess)) {
            return true;
        }
        const requestedOwner = ownerLogin?.trim().toLowerCase();
        const actualOwner = this.ownerByProcessId.get(process.id);
        return !!requestedOwner && !!actualOwner && requestedOwner === actualOwner;
    }
}

/**
 * Install the Qaap seam on the existing ProcessManager instance.
 * The patch is intentionally narrow: only terminal processes are tenant
 * scoped, and only hosted runtimes change the upstream visibility behavior.
 */
export function installQaapTerminalOwnership(
    processManager: {
        register(process: ManagedProcess): number;
        get(id: number): ManagedProcess | undefined;
    },
    ownership: QaapTerminalOwnership,
    currentLogin: () => string | undefined,
): void {
    const manager = processManager as typeof processManager & { __qaapTerminalOwnershipInstalled?: boolean };
    if (manager.__qaapTerminalOwnershipInstalled) {
        return;
    }
    manager.__qaapTerminalOwnershipInstalled = true;

    const originalRegister = processManager.register.bind(processManager);
    processManager.register = (process: ManagedProcess): number => {
        const id = originalRegister(process);
        ownership.bind(process, currentLogin(), id);
        return id;
    };

    const originalGet = processManager.get.bind(processManager);
    processManager.get = (id: number): ManagedProcess | undefined => {
        const process = originalGet(id);
        if (!process || ownership.canAccess(process, currentLogin())) {
            return process;
        }
        return undefined;
    };
}
