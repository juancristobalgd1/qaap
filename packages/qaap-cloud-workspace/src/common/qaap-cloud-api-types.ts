// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const QAAP_CLOUD_API_PATH = '/qaap/api/cloud';

/** Liveness probe for VPS deploy checklists — agent runner snapshot, no auth required. */
export const QAAP_HEALTH_API_PATH = '/qaap/api/health';

export interface QaapHealthResponse {
    readonly ok: boolean;
    readonly uptimeMs: number;
    readonly agentConfigured: boolean;
    /** Agent ids detected on PATH at startup (excludes the shell pseudo-agent). */
    readonly agents: readonly string[];
    readonly defaultAgent: string;
}

/** Pure builder for {@link QaapHealthResponse} — `ok` when at least one agent CLI was detected. */
export function buildQaapHealthResponse(params: {
    readonly uptimeMs: number;
    readonly agentConfigured: boolean;
    readonly detectedAgentIds: readonly string[];
    readonly defaultAgent: string;
}): QaapHealthResponse {
    const agents = [...params.detectedAgentIds];
    return {
        ok: agents.length > 0,
        uptimeMs: params.uptimeMs,
        agentConfigured: params.agentConfigured,
        agents,
        defaultAgent: params.defaultAgent,
    };
}

/**
 * Default CDP endpoint AppTester's `chrome-devtools-mcp` MCP server connects to. Must point at a
 * Chrome running with `--remote-debugging-port=9222` on the *backend* host (same machine as the
 * MCP process), not the user's browser.
 */
export const QAAP_CDP_PROBE_URL = 'http://127.0.0.1:9222/json/version';

export interface QaapCdpStatusResponse {
    readonly reachable: boolean;
    readonly endpoint: string;
}

export type QaapCloudWorkspaceStatus = 'provisioning' | 'ready' | 'stopped' | 'error';

export interface QaapCloudWorkspaceSummary {
    readonly id: string;
    readonly repoKey: string;
    readonly status: QaapCloudWorkspaceStatus;
    readonly provider: 'local-sandbox' | 'docker' | 'remote';
    readonly workspaceUri?: string;
    readonly containerRef?: string;
    readonly previewPort?: number;
    readonly lastOpenedAt?: string;
    readonly error?: string;
}

export interface QaapDeployRunRequest {
    readonly provider: 'vercel' | 'cloudflare-pages';
    readonly workspaceKey: string;
    readonly workspaceRoot: string;
    readonly projectName?: string;
}

export interface QaapDeployRunResponse {
    readonly ok: boolean;
    readonly provider: string;
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly deployUrl?: string;
}

export interface QaapPushSubscriptionJson {
    readonly endpoint: string;
    readonly keys: {
        readonly p256dh: string;
        readonly auth: string;
    };
}

export interface QaapPushSubscribeRequest {
    readonly subscription: QaapPushSubscriptionJson;
    readonly userLogin?: string;
}

export interface QaapPushNotifyRequest {
    readonly title: string;
    readonly body: string;
    readonly tag?: string;
    readonly userLogin?: string;
    /** In-app destination to open when the notification is clicked (e.g. 'diff-review'). */
    readonly route?: string;
    /** Opens the matching agent conversation when `route` is `transcript`. */
    readonly conversationId?: string;
}

export interface QaapPushVapidResponse {
    readonly publicKey: string;
    readonly enabled: boolean;
}

export interface QaapCloudWorkspacesResponse {
    readonly workspaces: QaapCloudWorkspaceSummary[];
}

export interface QaapCloudWorkspaceEnsureRequest {
    readonly repoKey: string;
    readonly workspaceUri?: string;
    readonly githubFullName?: string;
}

export interface QaapPreviewShareCreateRequest {
    readonly port: number;
    readonly repoKey?: string;
}

export interface QaapPreviewShareSummary {
    readonly token: string;
    readonly port: number;
    readonly publicUrl: string;
    readonly createdAt: string;
}

export interface QaapTerminalSessionRecord {
    readonly id: string;
    readonly title: string;
    readonly cwd?: string;
    readonly lastCommand?: string;
}

export interface QaapTerminalSessionsResponse {
    readonly workspaceKey: string;
    readonly terminals: QaapTerminalSessionRecord[];
}

export interface QaapTerminalSessionsUpsertRequest {
    readonly workspaceKey: string;
    readonly terminals: QaapTerminalSessionRecord[];
}

export interface QaapDeployEnvVar {
    readonly key: string;
    readonly value: string;
}

export interface QaapDeployEnvResponse {
    readonly vars: QaapDeployEnvVar[];
}
