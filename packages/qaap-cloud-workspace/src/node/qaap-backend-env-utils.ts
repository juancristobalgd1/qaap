// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { EnvironmentUtils } from '@theia/core/lib/node/environment-utils';
import { isQaapBackendOnlyEnvKey } from './qaap-child-process-env';

/**
 * Theia's terminals (and any other consumer of {@link EnvironmentUtils}) build the child env as the
 * full backend `process.env` plus overrides, so a user shell would inherit every backend secret
 * (`env | grep SECRET`). This subclass removes backend-only keys from the merged result; it is
 * rebound over the upstream class so the upstream terminal package stays untouched.
 */
@injectable()
export class QaapBackendEnvironmentUtils extends EnvironmentUtils {

    override mergeProcessEnv(env: Record<string, string | null> = {}): Record<string, string> {
        const merged = super.mergeProcessEnv(env);
        for (const key of Object.keys(merged)) {
            if (isQaapBackendOnlyEnvKey(key)) {
                delete merged[key];
            }
        }
        return merged;
    }
}
