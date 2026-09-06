// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ConfirmDialog } from '@theia/core/lib/browser';
import { nls } from '@theia/core/lib/common/nls';
import {
    localizeVerifyCommitReadiness,
    type VerifyCommitReadiness,
} from '../common/qaap-verify-commit-readiness';

export async function confirmVerifyCommitReadiness(
    readiness: VerifyCommitReadiness,
    options?: { onBlocked?: (message: string) => void },
): Promise<boolean> {
    if (readiness.blocksCommit) {
        options?.onBlocked?.(localizeVerifyCommitReadiness(readiness.level));
        return false;
    }
    if (!readiness.requiresConfirmation) {
        return true;
    }
    const confirmed = await new ConfirmDialog({
        title: nls.localize('qaap/verify/commitConfirmTitle', 'Commit without current checks?'),
        msg: nls.localize(
            'qaap/verify/commitConfirmMessage',
            '{0} Commit anyway?',
            localizeVerifyCommitReadiness(readiness.level),
        ),
        ok: nls.localize('qaap/verify/commitAnyway', 'Commit anyway'),
        cancel: nls.localize('qaap/mobileProjects/parallelCancel', 'Back'),
    }).open();
    return !!confirmed;
}
