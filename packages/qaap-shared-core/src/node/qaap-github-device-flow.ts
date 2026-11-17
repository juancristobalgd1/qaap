// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { randomUUID } from 'crypto';
import { fetchGithubRepositoryRequest } from './qaap-github-api';

/** GitHub's device endpoints live on the web host, next to the OAuth authorize URL. */
export const QAAP_GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const QAAP_GITHUB_DEVICE_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const QAAP_GITHUB_DEVICE_SCOPE = 'read:user repo';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
/** At most this many device flows wait for approval at once; starting another drops the oldest. */
export const QAAP_GITHUB_DEVICE_MAX_LIVE_FLOWS = 4;
/** GitHub's own device codes last 15 minutes; a longer `expires_in` is capped here. */
const MAX_FLOW_LIFETIME_MS = 15 * 60_000;
const DEFAULT_INTERVAL_S = 5;
const SLOW_DOWN_STEP_MS = 5_000;

/** What the browser may see when a flow starts. The `device_code` never leaves the server. */
export interface QaapGithubDeviceStart {
    /** Opaque random id the browser polls with. It is not the device code. */
    readonly flowId: string;
    /** Code the user types on GitHub. Public by design (RFC 8628). */
    readonly userCode: string;
    readonly verificationUri: string;
    /** Minimum seconds between two polls. */
    readonly interval: number;
    readonly expiresIn: number;
}

export type QaapGithubDevicePoll =
    | { readonly status: 'pending'; readonly interval: number }
    | { readonly status: 'complete'; readonly accessToken: string }
    | { readonly status: 'denied' }
    | { readonly status: 'expired' };

/** A GitHub answer the flow cannot continue from. The message is safe to show. */
export class QaapGithubDeviceFlowError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'QaapGithubDeviceFlowError';
    }
}

interface PendingDeviceFlow {
    readonly clientId: string;
    readonly deviceCode: string;
    intervalMs: number;
    readonly expiresAt: number;
    lastPollAt: number;
    polling: boolean;
}

interface GithubDeviceResponse {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    access_token?: string;
    error?: string;
    error_description?: string;
}

/**
 * Pending GitHub device flows, kept in backend memory only. The browser holds an opaque flow id;
 * the device code, the token and the poll timing stay here.
 */
export class QaapGithubDeviceFlows {
    protected readonly flows = new Map<string, PendingDeviceFlow>();

    constructor(protected readonly clock: () => number = Date.now) { }

    /** Number of flows still waiting (after purging expired ones). Exposed for tests. */
    get size(): number {
        this.purgeExpired();
        return this.flows.size;
    }

    async start(clientId: string): Promise<QaapGithubDeviceStart> {
        this.purgeExpired();
        const data = await this.postForm(QAAP_GITHUB_DEVICE_CODE_URL, { client_id: clientId, scope: QAAP_GITHUB_DEVICE_SCOPE });
        if (!data.device_code || !data.user_code || !data.verification_uri) {
            throw new QaapGithubDeviceFlowError(data.error_description || data.error || 'GitHub did not start a device sign-in.');
        }
        const now = this.clock();
        const lifetimeMs = Math.min((data.expires_in ?? MAX_FLOW_LIFETIME_MS / 1000) * 1000, MAX_FLOW_LIFETIME_MS);
        const intervalS = Math.max(data.interval ?? DEFAULT_INTERVAL_S, 1);
        while (this.flows.size >= QAAP_GITHUB_DEVICE_MAX_LIVE_FLOWS) {
            const oldest = this.flows.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.flows.delete(oldest);
        }
        const flowId = randomUUID();
        this.flows.set(flowId, {
            clientId,
            deviceCode: data.device_code,
            intervalMs: intervalS * 1000,
            expiresAt: now + lifetimeMs,
            lastPollAt: now,
            polling: false,
        });
        return {
            flowId,
            userCode: data.user_code,
            verificationUri: data.verification_uri,
            interval: intervalS,
            expiresIn: Math.floor(lifetimeMs / 1000),
        };
    }

    /**
     * One poll. A poll that comes before the server-side interval answers `pending` without asking
     * GitHub, so a fast client cannot trigger GitHub's rate limit. A finished flow is removed at once.
     */
    async poll(flowId: string): Promise<QaapGithubDevicePoll> {
        this.purgeExpired();
        const flow = this.flows.get(flowId);
        if (!flow) {
            return { status: 'expired' };
        }
        const now = this.clock();
        if (flow.polling || now < flow.lastPollAt + flow.intervalMs) {
            return { status: 'pending', interval: flow.intervalMs / 1000 };
        }
        flow.polling = true;
        flow.lastPollAt = now;
        try {
            const data = await this.postForm(QAAP_GITHUB_DEVICE_TOKEN_URL, {
                client_id: flow.clientId,
                device_code: flow.deviceCode,
                grant_type: DEVICE_GRANT_TYPE,
            });
            if (data.access_token) {
                this.flows.delete(flowId);
                return { status: 'complete', accessToken: data.access_token };
            }
            switch (data.error) {
                case 'authorization_pending':
                    return { status: 'pending', interval: flow.intervalMs / 1000 };
                case 'slow_down':
                    flow.intervalMs += SLOW_DOWN_STEP_MS;
                    return { status: 'pending', interval: flow.intervalMs / 1000 };
                case 'expired_token':
                    this.flows.delete(flowId);
                    return { status: 'expired' };
                case 'access_denied':
                    this.flows.delete(flowId);
                    return { status: 'denied' };
                default:
                    this.flows.delete(flowId);
                    throw new QaapGithubDeviceFlowError(data.error_description || data.error || 'GitHub device sign-in failed.');
            }
        } catch (err) {
            // Any failure ends the flow: the user starts again instead of polling a dead code.
            this.flows.delete(flowId);
            throw err;
        } finally {
            const current = this.flows.get(flowId);
            if (current) {
                current.polling = false;
            }
        }
    }

    protected purgeExpired(): void {
        const now = this.clock();
        for (const [flowId, flow] of this.flows) {
            if (now >= flow.expiresAt) {
                this.flows.delete(flowId);
            }
        }
    }

    protected async postForm(url: string, fields: Record<string, string>): Promise<GithubDeviceResponse> {
        const response = await fetchGithubRepositoryRequest(url, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(fields).toString(),
        });
        const data = await response.json().catch(() => undefined) as GithubDeviceResponse | undefined;
        if (!data) {
            throw new QaapGithubDeviceFlowError(`GitHub device sign-in failed (HTTP ${response.status}).`);
        }
        return data;
    }
}
