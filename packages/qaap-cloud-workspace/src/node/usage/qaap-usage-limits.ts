// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import type {
    QaapUsageLimitWindow,
    QaapUsageLimits,
    QaapUsageProviderLimits,
} from '@theia/qaap-shared-core/lib/common/qaap-usage-summary-protocol';
import type { QaapUsageRateLimitWindowReading } from './qaap-usage-record';
import { isQaapHostedProductionRuntime } from '@theia/qaap-shared-core/lib/node/qaap-production-auth-readiness';
import { QaapUsageRoots } from './qaap-usage-roots';
import { QaapUsageScanner } from './qaap-usage-scanner';

/** Keychain item that Claude Code keeps its OAuth session in on macOS. */
export const QAAP_USAGE_CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials';
const KEYCHAIN_TIMEOUT_MS = 5_000;
const SIGN_IN_REASON = 'Sign in to Claude Code on this machine';
const EXPIRED_REASON = 'Claude Code session expired: open Claude Code to refresh it';

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
    protected loggedResponseShape = false;
    /** `execFile` without a shell, promisified once so that tests can replace it. */
    protected readonly execFileAsync = promisify(childProcess.execFile) as unknown as (
        file: string,
        args: string[],
        options: { timeout: number },
    ) => Promise<{ stdout: string }>;

    /** Current time in epoch milliseconds; overridable in tests. */
    protected now(): number {
        return Date.now();
    }

    /** Platform of this process; overridable in tests. */
    protected platform(): NodeJS.Platform {
        return process.platform;
    }

    /**
     * Runs `security` without a shell. Returns the item's secret, or `undefined` when the item is absent or the
     * call fails. The first call may show macOS's keychain access prompt.
     */
    protected async readKeychainSecret(): Promise<string | undefined> {
        try {
            const { stdout } = await this.execFileAsync(
                'security',
                ['find-generic-password', '-s', QAAP_USAGE_CLAUDE_KEYCHAIN_SERVICE, '-w'],
                { timeout: KEYCHAIN_TIMEOUT_MS },
            );
            return String(stdout);
        } catch {
            return undefined;
        }
    }

    async getLimits(): Promise<QaapUsageLimits> {
        const claude = await this.claudeLimits();
        return { providers: [claude, this.codexLimits()] };
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
            const body = await response.json() as unknown;
            this.logResponseShapeOnce(body);
            const windows = claudeWindows(body);
            return windows.length > 0
                ? { provider: 'claude', status: 'ok', windows, observedAt: new Date(this.now()).toISOString() }
                : { provider: 'claude', status: 'unavailable', reason: 'Claude usage response had no limit windows', windows: [] };
        } catch {
            return { provider: 'claude', status: 'error', reason: 'Claude usage request failed', windows: [] };
        }
    }

    /**
     * The OAuth access token, or the reason it is unavailable. The credentials file is read first; on macOS
     * the keychain item is tried next, and only on a hosted-free runtime. The token is never stored.
     */
    protected async readClaudeAccessToken(): Promise<string | { reason: string }> {
        const fromFile = await this.tokenFromCredentialsText(await this.readFileOrUndefined(this.credentialsFile));
        if (typeof fromFile === 'string' || fromFile.reason === EXPIRED_REASON) {
            return fromFile;
        }
        if (this.platform() === 'darwin' && !isQaapHostedProductionRuntime()) {
            const fromKeychain = await this.tokenFromCredentialsText(await this.readKeychainSecret());
            if (typeof fromKeychain === 'string' || fromKeychain.reason === EXPIRED_REASON) {
                return fromKeychain;
            }
        }
        return { reason: SIGN_IN_REASON };
    }

    protected async readFileOrUndefined(file: string): Promise<string | undefined> {
        try {
            return await fs.promises.readFile(file, 'utf8');
        } catch {
            return undefined;
        }
    }

    /** Parses one credentials document. An absent document or no token counts as signed out. */
    protected tokenFromCredentialsText(text: string | undefined): string | { reason: string } {
        if (text === undefined) {
            return { reason: SIGN_IN_REASON };
        }
        try {
            const oauth = (JSON.parse(text) as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } }).claudeAiOauth;
            const token = oauth?.accessToken;
            if (typeof token !== 'string' || !token) {
                return { reason: SIGN_IN_REASON };
            }
            if (typeof oauth?.expiresAt === 'number' && oauth.expiresAt < this.now()) {
                return { reason: EXPIRED_REASON };
            }
            return token;
        } catch {
            return { reason: 'Claude Code credentials could not be read' };
        }
    }

    /** Logs only the top-level keys and value types of the first usage response, never the values. */
    protected logResponseShapeOnce(body: unknown): void {
        if (this.loggedResponseShape) {
            return;
        }
        this.loggedResponseShape = true;
        const shape = typeof body === 'object' && body !== null && !Array.isArray(body)
            ? Object.fromEntries(Object.entries(body as Record<string, unknown>).map(([key, value]) => [key, value === null ? 'null' : typeof value]))
            : typeof body;
        console.debug('[qaap-usage] Claude usage response shape (keys and types only):', JSON.stringify(shape));
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

/**
 * The `five_hour` and `seven_day` windows of the Claude usage response; other fields are ignored.
 * When every utilization is a fraction (all ≤ 1, at least one above 0) the values are scaled to percent.
 */
function claudeWindows(body: unknown): QaapUsageLimitWindow[] {
    if (typeof body !== 'object' || body === null) {
        return [];
    }
    const record = body as Record<string, unknown>;
    const specs: { value: unknown; id: string; label: string; windowMinutes: number }[] = [
        { value: record.five_hour, id: 'session', label: 'Session', windowMinutes: SESSION_WINDOW_MINUTES },
        { value: record.seven_day, id: 'weekly', label: 'Weekly', windowMinutes: WEEKLY_WINDOW_MINUTES },
    ];
    const readings = specs.map(spec => ({ ...spec, utilization: utilizationOf(spec.value), resetsAt: resetsAtOf(spec.value) }))
        .filter((reading): reading is typeof reading & { utilization: number } => reading.utilization !== undefined);
    const fractional = readings.length > 0
        && readings.every(reading => reading.utilization <= 1)
        && readings.some(reading => reading.utilization > 0);
    return readings.map(reading => ({
        id: reading.id,
        label: reading.label,
        usedPercent: clampPercent(fractional ? reading.utilization * 100 : reading.utilization),
        resetsAt: reading.resetsAt,
        windowMinutes: reading.windowMinutes,
    }));
}

function utilizationOf(value: unknown): number | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const utilization = (value as { utilization?: unknown }).utilization;
    return typeof utilization === 'number' && Number.isFinite(utilization) ? utilization : undefined;
}

function resetsAtOf(value: unknown): string | undefined {
    const resetsAt = typeof value === 'object' && value !== null ? (value as { resets_at?: unknown }).resets_at : undefined;
    return typeof resetsAt === 'string' && !Number.isNaN(Date.parse(resetsAt)) ? new Date(Date.parse(resetsAt)).toISOString() : undefined;
}

function clampPercent(value: number): number {
    return Math.min(100, Math.max(0, value));
}
