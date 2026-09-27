// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    readQaapHostedRuntime,
    rememberQaapHostedRuntime,
} from '@theia/qaap-adapters/lib/common/qaap-hosted-runtime';

export { readQaapHostedRuntime, rememberQaapHostedRuntime };

/**
 * CLIs whose login is a browser redirect to localhost. That callback never reaches a
 * headless VPS, so these agents cannot be signed in (or offered) on hosted runtimes.
 */
export const HOSTED_LOCALHOST_OAUTH_AGENT_IDS: ReadonlySet<string> = new Set(['cursor']);

export function normalizeHostedPolicyAgentId(agentId: string | undefined): string | undefined {
    const normalized = agentId?.trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }
    return normalized === 'cursor-agent' ? 'cursor' : normalized;
}

export function isHostedLocalhostOAuthAgent(agentId: string | undefined): boolean {
    const normalized = normalizeHostedPolicyAgentId(agentId);
    return !!normalized && HOSTED_LOCALHOST_OAUTH_AGENT_IDS.has(normalized);
}

/** True when this agent must stay out of hosted pickers and login CTAs. */
export function isAgentHiddenOnHostedRuntime(agentId: string | undefined, hosted = readQaapHostedRuntime()): boolean {
    return hosted && isHostedLocalhostOAuthAgent(agentId);
}

export function assertAgentAllowedOnHostedRuntime(agentId: string | undefined): void {
    if (isAgentHiddenOnHostedRuntime(agentId)) {
        throw new Error(localizeHostedLocalhostOAuthAgentMessage(agentId));
    }
}

export function localizeHostedLocalhostOAuthAgentMessage(agentId?: string): string {
    const normalized = normalizeHostedPolicyAgentId(agentId);
    if (normalized === 'cursor') {
        return nls.localize(
            'qaap/agentLogin/hostedLocalhostOAuthNamed',
            'Cursor Agent needs a desktop browser login, which cannot finish on this cloud workspace. Use QAIQ, Codex, Claude Code, or Grok (device-code or API key).',
        );
    }
    return nls.localize(
        'qaap/agentLogin/hostedLocalhostOAuth',
        'This agent needs a desktop browser login, which cannot finish on this cloud workspace. Use a device-code or API-key agent such as QAIQ, Codex, Claude Code, or Grok.',
    );
}

export function localizeHostedMissingCodingAgentMessage(): string {
    return nls.localize(
        'qaap/agentFailure/noCodingAgentHosted',
        'No cloud-ready coding agent CLI is installed. Install QAIQ, Codex, Claude Code, or Grok, then restart Qaap. Cursor Agent is not available here because it cannot finish browser login.',
    );
}

export function localizeHostedComposerNoAgentsMessage(): string {
    return nls.localize(
        'qaap/mobileProjects/stickyComposerNoAgentsHosted',
        'No cloud-ready agent is available. Install QAIQ, Codex, Claude Code, or Grok on the server (device-code or API key), then restart the backend. Cursor Agent is not available on this workspace.',
    );
}

export function localizeHostedComposerNoAgentsFilteredMessage(): string {
    return nls.localize(
        'qaap/mobileProjects/stickyComposerNoAgentsFilteredHosted',
        'Agents were detected on the server but none can sign in on this cloud workspace. Install QAIQ, Codex, Claude Code, or Grok (device-code or API key), then restart the backend.',
    );
}

export function localizeHostedInstallCodingAgentLabel(): string {
    return nls.localize(
        'qaap/mobileProjects/installCodingAgentHosted',
        'Install a cloud-ready CLI',
    );
}
