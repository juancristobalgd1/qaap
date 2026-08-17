// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { evaluateQaapProductionAuthReadiness } from './qaap-production-auth-readiness';

/**
 * Fail-closed boot: a production runtime without GitHub OAuth (and without skip-auth)
 * must not listen. Operators would otherwise get a login gate that can never succeed.
 */
@injectable()
export class QaapProductionBootGuardContribution implements BackendApplicationContribution {

    initialize(): void {
        const readiness = evaluateQaapProductionAuthReadiness();
        if (readiness.ready) {
            return;
        }
        console.error(`[qaap-security] ${readiness.fatalReason}`);
        process.exit(1);
    }
}
