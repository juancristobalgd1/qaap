// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { detectAgentFailureKind } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import { extractAgentTurnError } from '@theia/qaap-shared-core/lib/common/qaap-research-agent-log';
import type { QaapAgentLastTurn, QaapAgentTask, QaapAgentTaskState } from '../common/qaap-agent-task';
import { resolveCompletedTurnAuthFailureReason } from './qaap-agent-conversation-store-helpers';

/** Failure causes sit at the end of a CLI's output; classify that part, not a long transcript. */
const LAST_TURN_LOG_TAIL = 12_000;

/**
 * Agent-health verdict for a finished task, or `undefined` when the outcome says nothing about the
 * agent: still running, cancelled by the user, or `interrupted` (the backend restarted under it).
 * A clean exit that the CLI itself declared a failure (signed out, quota — e.g. Copilot prints its
 * sign-in error and exits 0) counts as failed, using the same strict rule as the Work Hub chat.
 */
export function classifyAgentLastTurn(
    task: {
        readonly id: string; readonly state: QaapAgentTaskState; readonly exitCode?: number; readonly finishedAt?: number;
        readonly providerKeyVerdict?: QaapAgentTask['providerKeyVerdict'];
    },
    log: string,
    agentId: string,
    now = Date.now(),
): QaapAgentLastTurn | undefined {
    const at = task.finishedAt ?? now;
    switch (task.state) {
        case 'completed':
        case 'completed_with_warnings':
        case 'blocked': {
            // `completed_with_warnings`: the repository's checks were red, the agent itself worked.
            // `blocked`: the agent ran and asked the user for a decision.
            if (resolveCompletedTurnAuthFailureReason(log, agentId)) {
                const declared = extractAgentTurnError(log) ?? log.slice(-LAST_TURN_LOG_TAIL);
                return { outcome: 'failed', kind: detectAgentFailureKind(declared) ?? 'auth', at, taskId: task.id };
            }
            return { outcome: 'ok', at, taskId: task.id };
        }
        case 'failed': {
            const tail = lineAlignedLogTail(log, LAST_TURN_LOG_TAIL);
            // A key or sign-in the provider refused, as the runner established it (Pi's final error).
            const kind = (task.providerKeyVerdict === 'key_rejected' ? 'provider_key_rejected' : undefined)
                ?? detectAgentFailureKind(extractAgentTurnError(log) ?? tail) ?? detectAgentFailureKind(tail);
            return { outcome: 'failed', kind: kind ?? 'exit_code', at, taskId: task.id };
        }
        default:
            return undefined;
    }
}

/**
 * The last `maxChars` of `log`, starting at a line boundary. A cut through the middle of a long JSON
 * line (Pi repeats the whole prompt in its last records) read prompt text such as "shell tools time
 * out" as the failure.
 */
function lineAlignedLogTail(log: string, maxChars: number): string {
    if (log.length <= maxChars) {
        return log;
    }
    const tail = log.slice(-maxChars);
    const newline = tail.indexOf('\n');
    return newline >= 0 ? tail.slice(newline + 1) : tail;
}

/**
 * Each user's last finished turn per agent, one SQLite namespace per login, so the harness
 * settings can show "last turn OK / failed: signed out" next to each agent.
 */
@injectable()
export class QaapAgentLastTurnStore {

    protected readonly sqliteStores = new Map<string, QaapSqliteStore>();

    get(userLogin: string | undefined, agentId: string): QaapAgentLastTurn | undefined {
        try {
            return this.getSqliteStore(userLogin).get<QaapAgentLastTurn>(agentId);
        } catch (error) {
            console.warn('[qaap-agent-last-turn] read failed:', error instanceof Error ? error.message : String(error));
            return undefined;
        }
    }

    /** Records the turn unless an already recorded one finished later (results can arrive out of order). */
    record(userLogin: string | undefined, agentId: string, turn: QaapAgentLastTurn): void {
        try {
            const store = this.getSqliteStore(userLogin);
            const current = store.get<QaapAgentLastTurn>(agentId);
            if (current && current.at > turn.at) {
                return;
            }
            store.set(agentId, turn);
        } catch (error) {
            console.warn('[qaap-agent-last-turn] write failed:', error instanceof Error ? error.message : String(error));
        }
    }

    protected resolveDatabasePath(): string {
        return resolveQaapSqlitePath(path.join(os.homedir(), '.qaap', 'agent-last-turns.json'));
    }

    protected getSqliteStore(userLogin: string | undefined): QaapSqliteStore {
        const namespace = `agent-last-turns:${userLogin ?? ''}`;
        let store = this.sqliteStores.get(namespace);
        if (!store) {
            store = new QaapSqliteStore({ databasePath: this.resolveDatabasePath(), namespace });
            this.sqliteStores.set(namespace, store);
        }
        return store;
    }
}
