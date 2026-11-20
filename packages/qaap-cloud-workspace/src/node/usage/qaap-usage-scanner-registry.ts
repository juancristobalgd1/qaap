// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import * as os from 'os';
import { QaapUsageScanner } from './qaap-usage-scanner';
import { QaapUsageScanTarget, QaapUsageScanTargetResolver } from './qaap-usage-scan-target';

/** One owner's view of the usage logs: the scanner over their agent home and where it points. */
export interface QaapUsageOwnerScan {
    readonly scanner: QaapUsageScanner;
    readonly target: QaapUsageScanTarget;
}

/**
 * One scanner per agent home. Owners whose agents share a home (desktop, a per-tenant backend, a shared agent
 * uid) share one scanner; in uid-per-user mode each owner gets the scanner of their own private home, so a user
 * never sees another user's usage.
 */
@injectable()
export class QaapUsageScannerRegistry {

    @inject(QaapUsageScanTargetResolver)
    protected readonly targets: QaapUsageScanTargetResolver;

    protected readonly scanners = new Map<string, QaapUsageScanner>();

    forOwner(ownerLogin: string | undefined): QaapUsageOwnerScan {
        const target = this.targets.resolve(ownerLogin);
        let scanner = this.scanners.get(target.key);
        if (!scanner) {
            scanner = this.createScanner().useTarget(target);
            this.scanners.set(target.key, scanner);
        }
        return { scanner, target };
    }

    /**
     * A harness instance's usage (`codex#2`): its own scanner over the configuration folder of its launch plan,
     * cached per instance id. Without overrides (the base harness, or any non-desktop backend) it is the owner's
     * ordinary scanner, unchanged.
     */
    forHarnessInstance(
        ownerLogin: string | undefined,
        instanceId: string,
        overrides: Readonly<Record<string, string>>,
    ): QaapUsageOwnerScan {
        if (Object.keys(overrides).length === 0) {
            return this.forOwner(ownerLogin);
        }
        const target = QaapUsageScanTarget.harnessHome({
            instanceId: `${ownerLogin?.trim().toLowerCase() ?? ''}:${instanceId}`,
            env: process.env,
            backendHome: os.homedir(),
            overrides,
        });
        let scanner = this.scanners.get(target.key);
        if (!scanner) {
            scanner = this.createScanner().useTarget(target);
            this.scanners.set(target.key, scanner);
        }
        return { scanner, target };
    }

    /** Overridable in tests. */
    protected createScanner(): QaapUsageScanner {
        return new QaapUsageScanner();
    }
}
