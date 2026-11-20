// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { Event } from '@theia/core/lib/common/event';

/**
 * Structural contract of the managed GitHub MCP server's connection state, so the composer (a lower layer)
 * can show a "Connect GitHub" chip without importing `@theia/qaap-ai-config`. Implemented and bound there;
 * consumers inject it optionally (an app without the managed server simply shows no chip).
 */
export const QaapGithubMcpConnectionState = Symbol('QaapGithubMcpConnectionState');

/**
 * - `unknown`: no GitHub turn has tried to start the server yet.
 * - `connected`: the server runs.
 * - `needs-credential`: no GitHub credential exists.
 * - `auth-required`: GitHub refused the token; signing in again can help.
 * - `untrusted`: the workspace is not trusted, so the server is not started.
 * - `policy-rejected`: the endpoint refuses a token GitHub accepts (Copilot policy, OAuth app restriction);
 *   signing in again does not help, so no Connect action is offered.
 * - `error`: the server could not connect for another reason.
 */
export type QaapGithubMcpConnectionKind =
    'unknown' | 'connected' | 'needs-credential' | 'auth-required' | 'untrusted' | 'policy-rejected' | 'error';

export interface QaapGithubMcpConnectionSnapshot {
    readonly kind: QaapGithubMcpConnectionKind;
    /** The desktop app, where `gh auth login` is also a way to provide a credential. */
    readonly desktop: boolean;
}

export interface QaapGithubMcpConnectionState {
    readonly snapshot: QaapGithubMcpConnectionSnapshot;
    readonly onDidChange: Event<QaapGithubMcpConnectionSnapshot>;
    /**
     * The chip's action: GitHub sign-in for `needs-credential` / `auth-required`, the workspace trust dialog
     * for `untrusted`. Does nothing in any other state.
     */
    connect(): Promise<void>;
}

/** Whether a chip should be shown for `kind`: only when the user can act on it. */
export function qaapGithubMcpConnectionNeedsAction(kind: QaapGithubMcpConnectionKind): boolean {
    return kind === 'needs-credential' || kind === 'auth-required' || kind === 'untrusted';
}
