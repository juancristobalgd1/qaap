// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/**
 * Stable, machine-readable reasons the GitHub OAuth callback puts in `qaap_oauth_reason`.
 * The static login gate (`qaap-product/resources/qaap-login-gate.js`) keeps its own English copy
 * of the mapping; `qaap-oauth-error-reason.spec.ts` guards that both lists stay in sync.
 */
export const QAAP_OAUTH_ERROR_REASONS = [
    'access_denied',
    'state_lost',
    'missing_code',
    'not_configured',
    'exchange_failed',
    'github_error',
] as const;

export type QaapOAuthErrorReason = typeof QAAP_OAUTH_ERROR_REASONS[number];

export class QaapOAuthErrorMessages {
    /** User-facing, localized sentence for a callback failure reason (unknown/absent reasons get a generic retry hint). */
    static describe(reason: string | undefined): string {
        switch (reason) {
            case 'access_denied':
                return nls.localize('qaap/auth/oauth/accessDenied', 'GitHub sign-in was cancelled. Choose "Sign in with GitHub" to try again.');
            case 'state_lost':
                return nls.localize('qaap/auth/oauth/stateLost', 'Your sign-in session expired before GitHub responded. Please try again.');
            case 'missing_code':
                return nls.localize('qaap/auth/oauth/missingCode', 'GitHub did not complete the sign-in. Please try again.');
            case 'not_configured':
                return nls.localize('qaap/auth/oauth/notConfigured', 'GitHub sign-in isn’t configured on this server yet. Ask the administrator to set the GitHub OAuth credentials.');
            case 'exchange_failed':
                return nls.localize('qaap/auth/oauth/exchangeFailed', 'We could not finish signing you in with GitHub. Please try again in a moment.');
            case 'github_error':
            default:
                return nls.localize('qaap/auth/oauth/generic', 'GitHub sign-in failed. Please try again.');
        }
    }
}
