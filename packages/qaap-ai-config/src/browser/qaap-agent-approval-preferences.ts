// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';
import { injectable } from '@theia/core/shared/inversify';
import {
    QAAP_AUTO_APPROVE_READONLY_SHELL_DEFAULT,
    QAAP_AUTO_APPROVE_READONLY_SHELL_PREF,
} from '@theia/qaap-shared-core/lib/common/qaap-bash-readonly-classifier';

export const qaapAgentApprovalPreferenceSchema: PreferenceSchema = {
    properties: {
        [QAAP_AUTO_APPROVE_READONLY_SHELL_PREF]: {
            type: 'boolean',
            default: QAAP_AUTO_APPROVE_READONLY_SHELL_DEFAULT,
            markdownDescription: nls.localize(
                'qaap/preferences/autoApproveReadOnlyShell',
                'Auto-approve read-only shell commands: let agents run shell commands that only read (for example `ls`, `cat`, `grep`, `find` without '
                + '`-exec`, `git status`/`log`/`diff`) without asking for approval, even under **Request approval**. '
                + 'Commands with redirections, substitutions, or any write/exec are still asked for, and destructive '
                + 'commands are never auto-approved.',
            ),
        },
    },
};

@injectable()
export class QaapAgentApprovalPreferenceContribution implements PreferenceContribution {
    readonly schema = qaapAgentApprovalPreferenceSchema;
}
