// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

export function resolveAgentPickerConnectionDescription(
    agentId: string,
    agentLabel: string,
    fallbackDescription: string,
): string {
    switch (agentId.trim().toLowerCase()) {
        case 'codex':
            return nls.localize(
                'qaap/agentPicker/codexNotConnected',
                '{0} · Sign in with your ChatGPT account to connect',
                agentLabel,
            );
        case 'claude':
            return nls.localize(
                'qaap/agentPicker/claudeNotConnected',
                '{0} · Sign in with your Claude account to connect',
                agentLabel,
            );
        default:
            return nls.localize(
                'qaap/agentPicker/descriptionNotConnected',
                '{0} · Not connected on this workspace',
                fallbackDescription,
            );
    }
}

export function resolveAgentLoginDialogSubtitle(agentId: string): string {
    switch (agentId.trim().toLowerCase()) {
        case 'codex':
            return nls.localize(
                'qaap/mobileProjects/agentLoginDialogCodexSubtitle',
                'Sign in to Codex with your ChatGPT account, then finish the browser verification to connect it on this workspace.',
            );
        case 'claude':
            return nls.localize(
                'qaap/mobileProjects/agentLoginDialogClaudeSubtitle',
                'Sign in to Claude Code with your Claude account, then finish the browser authorization to connect it on this workspace.',
            );
        default:
            return nls.localize(
                'qaap/mobileProjects/agentLoginDialogSubtitle',
                "Use your own subscription for this provider's models.",
            );
    }
}
