// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
    QaapUsageLimitWindow,
    QaapUsageLimits,
    QaapUsageProviderLimits,
} from '@theia/qaap-shared-core/lib/common/qaap-usage-summary-protocol';
import type { QaapUsageRateLimitWindowReading } from './qaap-usage-record';
import { QaapUsageRoots } from './qaap-usage-roots';
import { QaapUsageScanner } from './qaap-usage-scanner';

/** Anthropic's OAuth usage endpoint, the same one Claude Code's `/usage` view reads. */
export const QAAP_USAGE_CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';
const CLAUDE_REQUEST_TIMEOUT_MS = 5_000;
const CLAUDE_CACHE_MS = 5 * 60_000;
const SESSION_WINDOW_MAX_MINUTES = 360;
const WEEKLY_WINDOW_MAX_MINUTES = 11_520;
const MONTHLY_WINDOW_MAX_MINUTES = 44_640;
const SESSION_WINDOW_MINUTES = 300;
const WEEKLY_WINDOW_MINUTES = 10_080;

/**
 * Current usage limits per provider. Codex limits come from the newest rate-limit record in its local logs.
 * Claude limits need the OAuth token that Claude Code keeps in `.credentials.json`; where that file is absent
 * (macOS keeps it in the Keychain) Claude reports itself as unavailable. The token is never logged or returned.
 */
@injectable()
export class QaapUsageLimitsService {

    @inject(QaapUsageScanner)
    protected readonly scanner: QaapUsageScanner;

    protected readonly credentialsFile = path.join(QaapUsageRoots.resolve(process.env, os.homedir()).claudeConfigDir, '.credentials.json');
    protected claudeCache: { expiresAt: number; value: QaapUsageProviderLimits } | undefined;
    protected claudeInFlight: Promise<QaapUsageProviderLimits> | undefined;

    /** Current time in epoch milliseconds; overridable in tests. */
    protected now(): number {
        return Date.now();
    }

    async getLimits(): Promise<QaapUsageLimits> {
        const claude = await this.claudeLimits();
        return {
            providers: [claude, this.codexLimits(), { provider: 'antigravity', status: 'unavailable', reason: 'Not available yet', windows: [] }],
        };
    }

    protected codexLimits(): QaapUsageProviderLimits {
        const observation = this.scanner.getLedger().latestRateLimits();
        if (!observation) {
            const reason = this.scanner.hasCompletedScan() ? 'No Codex rate-limit data in local logs' : 'Codex logs have not been scanned yet';
            return { provider: 'codex', status: 'unavailable', reason, windows: [] };
        }
        const windows: QaapUsageLimitWindow[] = [];
        if (observation.primary) {
            windows.push(toCodexWindow('primary', observation.primary));
        }
        if (observation.secondary) {
            windows.push(toCodexWindow('secondary', observation.secondary));
        }
        return {
            provider: 'codex',
            status: windows.length > 0 ? 'ok' : 'unavailable',
            reason: windows.length > 0 ? undefined : 'No Codex rate-limit windows in local logs',
            windows,
            observedAt: new Date(observation.observedAtMs).toISOString(),
        };
    }

    protected async claudeLimits(): Promise<QaapUsageProviderLimits> {
        if (this.claudeCache && this.claudeCache.expiresAt > this.now()) {
            return this.claudeCache.value;
        }
        if (!this.claudeInFlight) {
            this.claudeInFlight = this.fetchClaudeLimits().then(value => {
                this.claudeCache = { expiresAt: this.now() + CLAUDE_CACHE_MS, value };
                return value;
            }).finally(() => {
                this.claudeInFlight = undefined;
            });
        }
        return this.claudeInFlight;
    }

    protected async fetchClaudeLimits(): Promise<QaapUsageProviderLimits> {
        const token = await this.readClaudeAccessToken();
        if (typeof token !== 'string') {
            return { provider: 'claude', status: 'unavailable', reason: token.reason, windows: [] };
        }
        try {
            const response = await fetch(QAAP_USAGE_CLAUDE_USAGE_URL, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'anthropic-beta': CLAUDE_OAUTH_BETA,
                    'User-Agent': `qaap/${QaapUsageLimitsService.appVersion()}`,
                    Accept: 'application/json',
                },
                signal: AbortSignal.timeout(CLAUDE_REQUEST_TIMEOUT_MS),
            });
            if (!response.ok) {
                return { provider: 'claude', status: 'error', reason: `Claude usage request failed (HTTP ${response.status})`, windows: [] };
            }
            const windows = claudeWindows(await response.json() as unknown);
            return windows.length > 0
                ? { provider: 'claude', status: 'ok', windows, observedAt: new Date(this.now()).toISOString() }
                : { provider: 'claude', status: 'unavailable', reason: 'Claude usage response had no limit windows', windows: [] };
        } catch {
            return { provider: 'claude', status: 'error', reason: 'Claude usage request failed', windows: [] };
        }
    }

    /** The OAuth access token, or the reason it is unavailable. */
    protected async readClaudeAccessToken(): Promise<string | { reason: string }> {
        let text: string;
        try {
            text = await fs.promises.readFile(this.credentialsFile, 'utf8');
        } catch {
            return { reason: 'Sign in to Claude Code on this machine' };
        }
        try {
            const oauth = (JSON.parse(text) as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } }).claudeAiOauth;
            const token = oauth?.accessToken;
            if (typeof token !== 'string' || !token) {
                return { reason: 'Sign in to Claude Code on this machine' };
            }
            if (typeof oauth?.expiresAt === 'number' && oauth.expiresAt < this.now()) {
                return { reason: 'Claude Code sign-in has expired' };
            }
            return token;
        } catch {
            return { reason: 'Claude Code credentials could not be read' };
        }
    }

    protected static appVersion(): string {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8')) as { version?: unknown };
            return typeof pkg.version === 'string' ? pkg.version : 'unknown';
        } catch {
            return 'unknown';
        }
    }
}

/** Label for a Codex rate-limit window, from its length in minutes. */
export function codexWindowLabel(windowMinutes: number): string {
    if (windowMinutes <= SESSION_WINDOW_MAX_MINUTES) {
        return 'Session';
    }
    if (windowMinutes <= WEEKLY_WINDOW_MAX_MINUTES) {
        return 'Weekly';
    }
    if (windowMinutes <= MONTHLY_WINDOW_MAX_MINUTES) {
        return 'Monthly';
    }
    return `${Math.round(windowMinutes / 60)}h`;
}

function toCodexWindow(kind: 'primary' | 'secondary', reading: QaapUsageRateLimitWindowReading): QaapUsageLimitWindow {
    return {
        id: `codex-${kind}`,
        label: codexWindowLabel(reading.windowMinutes),
        usedPercent: clampPercent(reading.usedPercent),
        resetsAt: reading.resetsAtMs !== undefined ? new Date(reading.resetsAtMs).toISOString() : undefined,
        windowMinutes: reading.windowMinutes,
    };
}

/** The `five_hour` and `seven_day` windows of the Claude usage response; other fields are ignored. */
function claudeWindows(body: unknown): QaapUsageLimitWindow[] {
    if (typeof body !== 'object' || body === null) {
        return [];
    }
    const record = body as Record<string, unknown>;
    const windows: QaapUsageLimitWindow[] = [];
    const session = claudeWindow(record.five_hour, 'session', 'Session', SESSION_WINDOW_MINUTES);
    if (session) {
        windows.push(session);
    }
    const weekly = claudeWindow(record.seven_day, 'weekly', 'Weekly', WEEKLY_WINDOW_MINUTES);
    if (weekly) {
        windows.push(weekly);
    }
    return windows;
}

function claudeWindow(value: unknown, id: string, label: string, windowMinutes: number): QaapUsageLimitWindow | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const window = value as { utilization?: unknown; resets_at?: unknown };
    if (typeof window.utilization !== 'number' || !Number.isFinite(window.utilization)) {
        return undefined;
    }
    const resetsAt = typeof window.resets_at === 'string' && !Number.isNaN(Date.parse(window.resets_at))
        ? new Date(Date.parse(window.resets_at)).toISOString()
        : undefined;
    return { id, label, usedPercent: clampPercent(window.utilization), resetsAt, windowMinutes };
}

function clampPercent(value: number): number {
    return Math.min(100, Math.max(0, value));
}
