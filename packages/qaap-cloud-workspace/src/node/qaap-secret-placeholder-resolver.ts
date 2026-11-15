// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import {
    isQaapMaskableSecretPreferenceId,
    isQaapSecretPlaceholder,
    preferenceIdOfQaapSecretPlaceholder,
    readQaapTenantOwnerLogin,
} from '@theia/qaap-shared-core/lib/common/qaap-secret-placeholder';
import { readUserSettingsFromDisk } from './qaap-agent-task-runner-utils2';

/**
 * Turns a placeholder sent by the browser back into the owner's stored API key. Only a tenant backend
 * knows its owner (`QAAP_TENANT_LOGIN`); elsewhere, and for unknown or unset keys, the result is `undefined`.
 * Never logs the key.
 */
@injectable()
export class QaapSecretPlaceholderResolver {

    resolve(value: string | undefined): string | undefined {
        if (!isQaapSecretPlaceholder(value)) {
            return value;
        }
        const preferenceId = preferenceIdOfQaapSecretPlaceholder(value);
        if (!preferenceId || !isQaapMaskableSecretPreferenceId(preferenceId)) {
            return undefined;
        }
        const owner = readQaapTenantOwnerLogin();
        if (!owner) {
            return undefined;
        }
        const stored = readUserSettingsFromDisk(owner)[preferenceId];
        return typeof stored === 'string' && stored.trim() !== '' ? stored : undefined;
    }
}
