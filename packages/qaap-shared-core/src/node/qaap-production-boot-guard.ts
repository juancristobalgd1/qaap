// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
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
        reportQaapFatalBootReason(readiness.fatalReason ?? 'production readiness check failed');
        process.exit(1);
    }
}

/**
 * Theia redirects `console` to its asynchronous logger, so a `console.error` right before
 * `process.exit` never reaches `docker logs`. Write the reason synchronously to stderr instead.
 */
export function reportQaapFatalBootReason(reason: string, writeSync: (fd: number, text: string) => unknown = fs.writeSync): void {
    try {
        writeSync(2, `[qaap-security] ${reason}\n`);
    } catch {
        // stderr is gone: the exit code is the only signal left.
    }
}
