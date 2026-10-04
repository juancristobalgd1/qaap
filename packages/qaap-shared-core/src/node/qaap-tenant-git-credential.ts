// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';

/**
 * Where a tenant backend publishes the signed-in user's GitHub token for `git push` / `gh`.
 * `/tmp` is the tenant container's private tmpfs: the file never reaches the disk, the repository,
 * the image or a backup, and disappears with the container. Overridable for tests only.
 */
export const QAAP_GIT_CREDENTIAL_FILE_ENV = 'QAAP_GIT_CREDENTIAL_FILE';
export const QAAP_GIT_CREDENTIAL_DEFAULT_FILE = '/tmp/qaap-git-credential/github.json';
/** `off` disables publishing; otherwise the sliding lifetime in ms (default 1 h, 1 min – 12 h). */
export const QAAP_GIT_CREDENTIAL_TTL_ENV = 'QAAP_GIT_CREDENTIAL_TTL_MS';
export const QAAP_GIT_CREDENTIAL_DEFAULT_TTL_MS = 60 * 60 * 1000;
const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 12 * 60 * 60 * 1000;
/** Requests arrive every few seconds; rewrite the file at most once a minute for the same token. */
const REFRESH_INTERVAL_MS = 60 * 1000;

export interface QaapGitCredentialRecord {
    readonly login: string;
    readonly token: string;
    readonly expiresAt: number;
}

export type QaapGitCredentialLookup =
    | { readonly kind: 'valid'; readonly record: QaapGitCredentialRecord }
    | { readonly kind: 'expired' }
    | { readonly kind: 'missing' };

export namespace QaapGitCredentialFile {

    export function resolvePath(env: NodeJS.ProcessEnv = process.env): string {
        return env[QAAP_GIT_CREDENTIAL_FILE_ENV]?.trim() || QAAP_GIT_CREDENTIAL_DEFAULT_FILE;
    }

    /** `undefined` when publishing is disabled. */
    export function resolveTtlMs(env: NodeJS.ProcessEnv = process.env): number | undefined {
        const raw = env[QAAP_GIT_CREDENTIAL_TTL_ENV]?.trim();
        if (!raw) {
            return QAAP_GIT_CREDENTIAL_DEFAULT_TTL_MS;
        }
        if (/^(off|0|false)$/i.test(raw)) {
            return undefined;
        }
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
            return QAAP_GIT_CREDENTIAL_DEFAULT_TTL_MS;
        }
        return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.floor(parsed)));
    }

    export function read(file: string, now = Date.now()): QaapGitCredentialLookup {
        let parsed: Partial<QaapGitCredentialRecord>;
        try {
            parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            return { kind: 'missing' };
        }
        if (typeof parsed.token !== 'string' || !parsed.token || typeof parsed.expiresAt !== 'number' || typeof parsed.login !== 'string') {
            return { kind: 'missing' };
        }
        if (parsed.expiresAt <= now) {
            return { kind: 'expired' };
        }
        return { kind: 'valid', record: { login: parsed.login, token: parsed.token, expiresAt: parsed.expiresAt } };
    }
}

/** Owner applied to the credential when the backend runs as root and agents run as another uid. */
export interface QaapGitCredentialOwner {
    readonly uid: number;
    readonly gid: number;
}

/**
 * Publishes the GitHub OAuth token of the user a tenant backend serves, so `git push` and `gh` work
 * in that user's terminals and agent turns without pasting a token. Fed by the control-plane
 * assertion of every authenticated request (browser session or API token); the credential expires
 * a TTL after the last such request and is then deleted. Only the tenant backend calls `remember`.
 */
@injectable()
export class QaapTenantGitCredential {

    protected lastWrite: { readonly token: string; readonly writtenAt: number } | undefined;
    protected expiryTimer: ReturnType<typeof setTimeout> | undefined;

    remember(login: string, token: string | undefined, now = Date.now()): void {
        const ttl = QaapGitCredentialFile.resolveTtlMs();
        if (ttl === undefined || !token) {
            return;
        }
        if (this.lastWrite?.token === token && now - this.lastWrite.writtenAt < REFRESH_INTERVAL_MS) {
            return;
        }
        const file = QaapGitCredentialFile.resolvePath();
        try {
            this.write(file, { login, token, expiresAt: now + ttl });
            this.lastWrite = { token, writtenAt: now };
            this.scheduleExpiry(file, ttl);
        } catch (error) {
            // fs errors name the path, never the content.
            console.warn(`[qaap-security] could not publish the git credential: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected write(file: string, record: QaapGitCredentialRecord): void {
        const owner = this.resolveOwner();
        const directory = path.dirname(file);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        fs.chmodSync(directory, 0o700);
        const temporary = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
        if (owner) {
            fs.chownSync(directory, owner.uid, owner.gid);
            fs.chownSync(temporary, owner.uid, owner.gid);
        }
        fs.renameSync(temporary, file);
    }

    protected scheduleExpiry(file: string, ttl: number): void {
        if (this.expiryTimer) {
            clearTimeout(this.expiryTimer);
        }
        this.expiryTimer = setTimeout(() => {
            this.expiryTimer = undefined;
            this.lastWrite = undefined;
            fs.rmSync(file, { force: true });
        }, ttl);
        this.expiryTimer.unref?.();
    }

    /** Agents are dropped to `QAAP_AGENT_UID` only when the backend itself runs as root. */
    protected resolveOwner(): QaapGitCredentialOwner | undefined {
        if (process.getuid?.() !== 0) {
            return undefined;
        }
        const uid = Number.parseInt(process.env.QAAP_AGENT_UID?.trim() ?? '', 10);
        if (!Number.isInteger(uid) || uid <= 0) {
            return undefined;
        }
        const gid = Number.parseInt(process.env.QAAP_AGENT_GID?.trim() ?? '', 10);
        return { uid, gid: Number.isInteger(gid) && gid > 0 ? gid : uid };
    }
}
