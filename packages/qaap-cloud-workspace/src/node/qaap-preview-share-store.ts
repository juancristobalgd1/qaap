// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { buildQaapPublicPreviewShareUrl } from '../common/qaap-preview-share';
import type { QaapPreviewShareSummary } from '../common/qaap-cloud-api-types';

export interface QaapPreviewShareEntry {
    readonly token: string;
    readonly port: number;
    readonly repoKey?: string;
    readonly ownerLogin?: string;
    readonly createdAt: string;
    /** ISO expiry; a share is only served before this instant. Absent on legacy entries. */
    readonly expiresAt?: string;
}

const STORE_PATH = path.join(os.homedir(), '.qaap', 'preview-shares.json');

/** Default public-share lifetime; override with QAAP_PREVIEW_SHARE_TTL_HOURS. */
const DEFAULT_SHARE_TTL_HOURS = 24;

function resolveShareTtlMs(): number {
    const raw = process.env.QAAP_PREVIEW_SHARE_TTL_HOURS?.trim();
    const hours = raw ? Number.parseFloat(raw) : NaN;
    const effective = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SHARE_TTL_HOURS;
    return effective * 60 * 60_000;
}

/** True when the entry has expired (legacy entries without expiresAt are treated as createdAt + TTL). */
export function isPreviewShareExpired(entry: QaapPreviewShareEntry, nowMs: number, ttlMs: number): boolean {
    const expiry = entry.expiresAt
        ? Date.parse(entry.expiresAt)
        : Date.parse(entry.createdAt) + ttlMs;
    return Number.isFinite(expiry) && nowMs >= expiry;
}

@injectable()
export class QaapPreviewShareStore {

    async create(port: number, repoKey: string | undefined, publicOrigin: string, ownerLogin?: string): Promise<QaapPreviewShareSummary> {
        const token = crypto.randomBytes(12).toString('base64url');
        const publicUrl = buildQaapPublicPreviewShareUrl(publicOrigin, token);
        const createdAt = new Date();
        const entry: QaapPreviewShareEntry = {
            token,
            port,
            repoKey,
            ...(ownerLogin ? { ownerLogin } : {}),
            createdAt: createdAt.toISOString(),
            expiresAt: new Date(createdAt.getTime() + resolveShareTtlMs()).toISOString(),
        };
        const all = await this.readAll();
        this.pruneExpired(all);
        all[token] = entry;
        await this.writeAll(all);
        return { token, port, publicUrl, createdAt: entry.createdAt };
    }

    async resolve(token: string): Promise<QaapPreviewShareEntry | undefined> {
        const all = await this.readAll();
        const entry = all[token];
        if (!entry) {
            return undefined;
        }
        if (isPreviewShareExpired(entry, Date.now(), resolveShareTtlMs())) {
            // Opportunistically drop the expired entry so the store does not grow unbounded.
            delete all[token];
            await this.writeAll(all);
            return undefined;
        }
        return entry;
    }

    /** Revoke a share. When ownerLogin is given, only revokes a share owned by that login. */
    async revoke(token: string, ownerLogin?: string): Promise<boolean> {
        const all = await this.readAll();
        const entry = all[token];
        if (!entry) {
            return false;
        }
        if (ownerLogin !== undefined && entry.ownerLogin !== ownerLogin) {
            return false;
        }
        delete all[token];
        await this.writeAll(all);
        return true;
    }

    /** Drops expired entries from an in-memory map (caller persists). */
    protected pruneExpired(all: Record<string, QaapPreviewShareEntry>): void {
        const now = Date.now();
        const ttl = resolveShareTtlMs();
        for (const [token, entry] of Object.entries(all)) {
            if (isPreviewShareExpired(entry, now, ttl)) {
                delete all[token];
            }
        }
    }

    protected async readAll(): Promise<Record<string, QaapPreviewShareEntry>> {
        try {
            const raw = await fs.readFile(STORE_PATH, 'utf8');
            const parsed = JSON.parse(raw) as Record<string, QaapPreviewShareEntry>;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    protected async writeAll(data: Record<string, QaapPreviewShareEntry>): Promise<void> {
        await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
        await fs.writeFile(STORE_PATH, JSON.stringify(data, undefined, 2), 'utf8');
    }
}
