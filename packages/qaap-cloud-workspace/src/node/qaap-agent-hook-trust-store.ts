// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { normalizeQaapAgentHookDeclaration, type QaapAgentHookDeclaration } from '../common/qaap-agent-hooks';

/** Decision recorded for one (owner, workspace, digest) triple. */
export type QaapAgentHookTrustDecision = 'trusted' | 'ignored';

export interface QaapAgentHookTrustRecord {
    readonly ownerLogin: string;
    readonly workspaceRoot: string;
    readonly digest: string;
    readonly decision: QaapAgentHookTrustDecision;
    readonly decidedAt: string;
}

/** sha256 (hex) of the normalized declaration — the trust review is bound to exactly this content. */
export function computeQaapAgentHookDigest(declaration: QaapAgentHookDeclaration): string {
    return crypto.createHash('sha256').update(normalizeQaapAgentHookDeclaration(declaration), 'utf8').digest('hex');
}

/**
 * Persists workspace hook trust decisions. Records are keyed by owner + workspace identity; a
 * record only applies while its digest equals the current declaration digest, so editing
 * `.qaap/hooks.json` in any meaningful way silently returns the workspace to "pending".
 */
@injectable()
export class QaapAgentHookTrustStore {

    protected sqliteStore: QaapSqliteStore | undefined;

    get(ownerLogin: string | undefined, workspaceRoot: string): QaapAgentHookTrustRecord | undefined {
        try {
            return this.getSqliteStore().get<QaapAgentHookTrustRecord>(this.key(ownerLogin, workspaceRoot));
        } catch (error) {
            console.warn('[qaap-agent-hooks] trust store read failed:', error instanceof Error ? error.message : String(error));
            return undefined;
        }
    }

    /** Decision for the current digest, or `undefined` when none applies (never reviewed, or stale). */
    decisionFor(ownerLogin: string | undefined, workspaceRoot: string, digest: string): QaapAgentHookTrustDecision | undefined {
        const record = this.get(ownerLogin, workspaceRoot);
        return record && record.digest === digest ? record.decision : undefined;
    }

    record(ownerLogin: string | undefined, workspaceRoot: string, digest: string, decision: QaapAgentHookTrustDecision): QaapAgentHookTrustRecord {
        const record: QaapAgentHookTrustRecord = {
            ownerLogin: ownerLogin ?? '',
            workspaceRoot,
            digest,
            decision,
            decidedAt: new Date().toISOString(),
        };
        this.getSqliteStore().set(this.key(ownerLogin, workspaceRoot), record);
        return record;
    }

    revoke(ownerLogin: string | undefined, workspaceRoot: string): boolean {
        return this.getSqliteStore().delete(this.key(ownerLogin, workspaceRoot));
    }

    protected key(ownerLogin: string | undefined, workspaceRoot: string): string {
        return crypto.createHash('sha256').update(`${ownerLogin ?? ''}\u0000${workspaceRoot}`, 'utf8').digest('hex');
    }

    protected resolveDatabasePath(): string {
        return resolveQaapSqlitePath(path.join(os.homedir(), '.qaap', 'agent-hook-trust.json'));
    }

    protected getSqliteStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: this.resolveDatabasePath(),
            namespace: 'agent-hook-trust',
        });
    }
}
