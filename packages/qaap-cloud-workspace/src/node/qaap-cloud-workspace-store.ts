// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { writeJsonAtomic } from './qaap-write-json-atomic';
import * as os from 'os';
import * as path from 'path';
import type {
    QaapCloudWorkspaceEnsureRequest,
    QaapCloudWorkspaceSummary,
} from '../common/qaap-cloud-api-types';

const STORE_PATH = path.join(os.homedir(), '.qaap', 'cloud-workspaces.json');

export function qaapCloudProviderMode(): QaapCloudWorkspaceSummary['provider'] {
    const mode = process.env.QAAP_CLOUD_MODE?.trim() || 'local';
    if (mode === 'docker') {
        return 'docker';
    }
    if (mode === 'remote') {
        return 'remote';
    }
    return 'local-sandbox';
}

@injectable()
export class QaapCloudWorkspaceStore {

    async list(ownerLogin?: string): Promise<QaapCloudWorkspaceSummary[]> {
        const all = await this.readAll();
        const values = Object.values(all);
        const filtered = ownerLogin
            ? values.filter(w => w.ownerLogin === ownerLogin)
            : values;
        return filtered.sort((a, b) =>
            (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''));
    }

    async ensure(request: QaapCloudWorkspaceEnsureRequest, ownerLogin?: string): Promise<QaapCloudWorkspaceSummary> {
        const all = await this.readAll();
        const existing = Object.values(all).find(w => w.repoKey === request.repoKey && w.ownerLogin === ownerLogin);
        if (existing) {
            const updated: QaapCloudWorkspaceSummary = {
                ...existing,
                workspaceUri: request.workspaceUri ?? existing.workspaceUri,
                lastOpenedAt: new Date().toISOString(),
                status: 'ready',
            };
            all[existing.id] = updated;
            await this.writeAll(all);
            return updated;
        }
        const row: QaapCloudWorkspaceSummary = {
            id: `cw_${crypto.randomBytes(8).toString('hex')}`,
            repoKey: request.repoKey,
            status: 'ready',
            provider: qaapCloudProviderMode(),
            workspaceUri: request.workspaceUri,
            lastOpenedAt: new Date().toISOString(),
            ...(ownerLogin ? { ownerLogin } : {}),
        };
        all[row.id] = row;
        await this.writeAll(all);
        return row;
    }

    async ensureWithContainer(
        request: QaapCloudWorkspaceEnsureRequest,
        patch: Partial<Pick<QaapCloudWorkspaceSummary, 'containerRef' | 'status' | 'provider' | 'error'>>,
        ownerLogin?: string,
    ): Promise<QaapCloudWorkspaceSummary> {
        const all = await this.readAll();
        const existing = Object.values(all).find(w => w.repoKey === request.repoKey && w.ownerLogin === ownerLogin);
        const base: QaapCloudWorkspaceSummary = existing ?? {
            id: `cw_${crypto.randomBytes(8).toString('hex')}`,
            repoKey: request.repoKey,
            status: 'provisioning',
            provider: qaapCloudProviderMode(),
            workspaceUri: request.workspaceUri,
            lastOpenedAt: new Date().toISOString(),
            ...(ownerLogin ? { ownerLogin } : {}),
        };
        const updated: QaapCloudWorkspaceSummary = {
            ...base,
            workspaceUri: request.workspaceUri ?? base.workspaceUri,
            lastOpenedAt: new Date().toISOString(),
            ...patch,
        };
        all[updated.id] = updated;
        await this.writeAll(all);
        return updated;
    }

    async updatePreviewPort(repoKey: string, port: number, ownerLogin?: string): Promise<boolean> {
        const all = await this.readAll();
        for (const [id, row] of Object.entries(all)) {
            if (row.repoKey === repoKey && row.ownerLogin === ownerLogin) {
                all[id] = { ...row, previewPort: port, lastOpenedAt: new Date().toISOString() };
                await this.writeAll(all);
                return true;
            }
        }
        return false;
    }

    protected async readAll(): Promise<Record<string, QaapCloudWorkspaceSummary>> {
        try {
            const raw = await fs.readFile(STORE_PATH, 'utf8');
            const parsed = JSON.parse(raw) as Record<string, QaapCloudWorkspaceSummary>;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    protected async writeAll(data: Record<string, QaapCloudWorkspaceSummary>): Promise<void> {
        await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
        await writeJsonAtomic(STORE_PATH, data);
    }
}
