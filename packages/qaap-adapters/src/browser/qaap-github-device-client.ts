// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { QaapUserFacingErrors } from '../common/qaap-user-facing-error';
import { QAAP_AUTH_API_PATH, QAAP_GITHUB_API_PATH } from '../common/qaap-github-api-types';
import { qaapAuthenticatedFetchInit } from './qaap-github-auth-client';

/** Answer of `POST /device/start`. The browser never receives a device code, only this flow id. */
export interface QaapGithubDeviceStart {
    readonly flowId: string;
    readonly userCode: string;
    readonly verificationUri: string;
    /** Minimum seconds between polls. */
    readonly interval: number;
    readonly expiresIn: number;
}

export type QaapGithubDevicePollResult =
    | { readonly status: 'pending'; readonly interval: number }
    | { readonly status: 'complete'; readonly user?: { readonly login: string; readonly name: string; readonly avatarUrl: string } }
    | { readonly status: 'denied' }
    | { readonly status: 'expired' };

/** Desktop only: asks the backend to start a GitHub device sign-in. */
export async function startQaapGithubDeviceFlow(): Promise<QaapGithubDeviceStart> {
    const response = await fetch(`${QAAP_GITHUB_API_PATH}/device/start`, qaapAuthenticatedFetchInit({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
    }));
    if (!response.ok) {
        throw await QaapUserFacingErrors.fromResponse(response, nls.localize('qaap/githubDevice/startFailed', 'GitHub sign-in could not start.'));
    }
    return response.json() as Promise<QaapGithubDeviceStart>;
}

/** One poll of a device sign-in started by {@link startQaapGithubDeviceFlow}. */
export async function pollQaapGithubDeviceFlow(flowId: string): Promise<QaapGithubDevicePollResult> {
    const response = await fetch(`${QAAP_GITHUB_API_PATH}/device/poll`, qaapAuthenticatedFetchInit({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowId }),
    }));
    if (!response.ok) {
        throw await QaapUserFacingErrors.fromResponse(response, nls.localize('qaap/githubDevice/pollFailed', 'GitHub sign-in could not be completed.'));
    }
    return response.json() as Promise<QaapGithubDevicePollResult>;
}

/**
 * Desktop only: ends the GitHub session and its cookie on the backend. The local app session is left
 * alone, so the app stays usable in local mode (the login gate is not shown).
 */
export async function signOutQaapGithubDesktop(): Promise<void> {
    await fetch(`${QAAP_AUTH_API_PATH}/signout`, qaapAuthenticatedFetchInit({ method: 'POST' }));
}
